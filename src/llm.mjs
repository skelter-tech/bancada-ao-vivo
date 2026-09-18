const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Free tier do Gemini: o limite é de requisições por minuto, não de dinheiro.
// Serializar com folga custa segundos e evita a rodada inteira morrer em 429.
const ESPACO_MS = 2500;
let ultima = 0;

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function respeitaRitmo() {
  const desde = Date.now() - ultima;
  if (desde < ESPACO_MS) await dorme(ESPACO_MS - desde);
  ultima = Date.now();
}

export class SemChave extends Error {}

// O Google aposenta nome de modelo sem aviso: o 2.5-flash virou 404 para contas
// novas de um dia para o outro. Se o modelo do papel morrer ou ficar em 503 de
// demanda, a cadeira cai para o próximo em vez de sumir da mesa.
// O lite fica por último: responde pior, mas tem menos fila em horário de pico,
// e numa manhã de 503 generalizado é ele que salva a cadeira.
const RESERVA = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];

const esgotados = new Set();

async function chama({ chave, modelo, sistema, prompt, temperatura, schema }) {
  const corpo = {
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperatura,
      maxOutputTokens: 8192,
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
    },
  };

  await respeitaRitmo();
  const r = await fetch(`${BASE}/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
    body: JSON.stringify(corpo),
  });

  if (!r.ok) {
    const txt = (await r.text()).replace(/\s+/g, ' ').slice(0, 300);
    const erro = new Error(`HTTP ${r.status}: ${txt}`);
    // 404 significa modelo aposentado e 400 costuma ser schema inválido: repetir
    // não resolve nenhum dos dois, mas trocar de modelo resolve o primeiro.
    if (r.status === 404) erro.trocaModelo = true;
    // 429 com "PerDay" é a cota diária do modelo zerada: o free tier dá 20
    // chamadas por dia POR MODELO. Insistir só perde tempo até a meia-noite do
    // Pacífico; o modelo sai da fila para o resto desta execução.
    if (r.status === 429 && /PerDay/i.test(txt)) { erro.trocaModelo = true; esgotados.add(modelo); }
    else if (r.status !== 429 && r.status < 500) erro.fatal = true;
    // 503 é pico de demanda no modelo e passa sozinho: vale esperar mais que o
    // dobro a cada tentativa, porque desistir cedo perde a cadeira à toa.
    if (r.status === 503) erro.demanda = true;
    throw erro;
  }

  const json = await r.json();
  const cand = json.candidates?.[0];
  const texto = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
  if (!texto) throw new Error(`Modelo não devolveu texto (${cand?.finishReason || json.promptFeedback?.blockReason || 'resposta vazia'})`);

  return schema ? JSON.parse(texto) : texto.trim();
}

/* ---------- Groq ----------
   Outro fornecedor, com cota própria: 1.000 chamadas por dia por modelo contra 20
   do Gemini (medido em 18/09/2026 pelos cabeçalhos da resposta). O freio é outro:
   8.000 tokens por minuto, somando pergunta e resposta. Pedido maior que isso nem
   é tentado, porque o Groq recusa inteiro. No papel, o modelo se escreve com o
   prefixo, assim: "groq:openai/gpt-oss-120b". */
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TETO_TOKENS = 7600;
export const GROQ_RESERVA = 'groq:openai/gpt-oss-120b';

// Estimativa grosseira, no lado seguro: português dá perto de 3,5 caracteres por token.
export const tokensEstimados = (...partes) => Math.ceil(partes.join('').length / 3.4);

// O Gemini recebe o schema nativo. O Groq recebe modo JSON e um molde do formato
// no próprio pedido, e a resposta é validada do mesmo jeito que a do Gemini.
function molde(s) {
  if (!s) return null;
  if (s.type === 'OBJECT') return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, molde(v)]));
  if (s.type === 'ARRAY') return [molde(s.items)];
  if (s.enum) return s.enum.join(' | ');
  const tipo = { STRING: 'texto', NUMBER: 'número', BOOLEAN: 'true ou false' }[s.type] || 'valor';
  return s.description ? `${tipo}: ${s.description}` : tipo;
}

async function chamaGroq({ modelo, sistema, prompt, temperatura, schema }) {
  const chave = process.env.GROQ_API_KEY;
  if (!chave) throw Object.assign(new Error('GROQ_API_KEY ausente'), { trocaModelo: true });

  const sis = schema
    ? `${sistema}\n\nResponda APENAS com um objeto JSON válido, sem texto antes ou depois, neste formato:\n${JSON.stringify(molde(schema), null, 1)}`
    : sistema;
  const saidaMax = schema ? 2500 : 3000;
  if (tokensEstimados(sis, prompt) + saidaMax > GROQ_TETO_TOKENS) {
    throw Object.assign(new Error('pedido grande demais para os 8 mil tokens por minuto do Groq'), { trocaModelo: true });
  }

  await respeitaRitmo();
  const r = await fetch(GROQ, {
    method: 'POST',
    headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelo.replace(/^groq:/, ''),
      messages: [{ role: 'system', content: sis }, { role: 'user', content: prompt }],
      temperature: temperatura,
      max_tokens: saidaMax,
      ...(schema ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!r.ok) {
    const txt = (await r.text()).replace(/gsk_\S+/g, '***').replace(/\s+/g, ' ').slice(0, 300);
    const erro = new Error(`Groq HTTP ${r.status}: ${txt}`);
    // 413 é pedido grande demais; 400 no Groq costuma ser JSON mal formado pelo
    // modelo. Nos dois casos, quem resolve é o próximo da fila, não a repetição.
    if (r.status === 413 || r.status === 400 || r.status === 404) erro.trocaModelo = true;
    if (r.status === 429 && /per day|RPD|TPD/i.test(txt)) { erro.trocaModelo = true; esgotados.add(modelo); }
    throw erro;
  }

  const j = await r.json();
  const texto = String(j.choices?.[0]?.message?.content || '').trim();
  if (!texto) throw new Error('Groq não devolveu texto');
  if (!schema) return texto;
  const bruto = texto.match(/\{[\s\S]*\}/);
  if (!bruto) throw Object.assign(new Error('Groq não devolveu JSON'), { trocaModelo: true });
  return JSON.parse(bruto[0]);
}

export async function gerar({ modelo, sistema, prompt, temperatura = 0.9, schema = null, tentativas = 3, aviso = () => {} }) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave && !process.env.GROQ_API_KEY) throw new SemChave('GEMINI_API_KEY não está definida no ambiente.');

  // MODELO_TESTE força um modelo em tudo: serve para testar o fluxo num dia em
  // que os outros já gastaram a cota, sem mexer nos papéis.
  const principal = process.env.MODELO_TESTE || modelo;
  // O Groq entra no fim de toda fila: quando o Google inteiro cai em 503 ou zera a
  // cota, ele é outro fornecedor e não cai junto.
  // SO_GROQ=1 é o trabalho ao vivo: roda o dia inteiro e não pode encostar nas 20
  // chamadas diárias do Gemini, que são do expediente da manhã. As reservas passam
  // a ser os outros modelos do Groq, cada um com a sua cota de 1.000.
  const reserva = process.env.SO_GROQ
    ? ['groq:openai/gpt-oss-120b', 'groq:qwen/qwen3.8-27b', 'groq:openai/gpt-oss-20b']
    : [...RESERVA, ...(process.env.GROQ_API_KEY ? [GROQ_RESERVA] : [])];
  const fila = [principal, ...reserva.filter((m) => m !== principal)].filter((m) => !esgotados.has(m));
  if (!fila.length) throw Object.assign(new Error('Todos os modelos estão sem cota diária. Ela volta à meia-noite do Pacífico.'), { fatal: true });
  let ultimoErro;

  for (let i = 0; i < fila.length; i++) {
    const atual = fila[i];
    // Só o modelo do papel ganha insistência total. As reservas existem para
    // salvar a rodada, não para gastar cota varrendo um catálogo fora do ar.
    const max = i === 0 ? tentativas : 2;

    for (let t = 0; t < max; t++) {
      try {
        const saida = atual.startsWith('groq:')
          ? await chamaGroq({ modelo: atual, sistema, prompt, temperatura, schema })
          : await chama({ chave, modelo: atual, sistema, prompt, temperatura, schema });
        if (i > 0) aviso(`modelo ${modelo} indisponível, respondido por ${atual}`);
        return saida;
      } catch (e) {
        ultimoErro = e;
        if (e.fatal) throw e;
        if (e.trocaModelo) break;
        if (t < max - 1) await dorme((e.demanda ? 9000 : 4000) * 2 ** t);
      }
    }
  }
  throw ultimoErro;
}
