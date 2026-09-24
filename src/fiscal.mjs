// O fiscal da peça final. No primeiro expediente completo, o Analista inventou
// "12% de falsos negativos", o Auditor não pegou, e o Diretor publicou o número
// com mais dois que também não existiam em fonte nenhuma. O Auditor é um modelo,
// e modelo deixa passar. Então a última checagem é por código.
//
// A bancada não tem acesso à internet: só vê a pauta e os títulos das fontes. Todo
// número do texto que não aparece nesse material veio da memória do modelo ou foi
// inventado. Nos dois casos, alguém precisa conferir antes de publicar.

const NUMERO = /(?:R\$|US\$|€|\$)\s?\d[\d.,]*(?:\s?(?:bilh|milh|mil|bi\b|mi\b)\w*)?|\d+(?:[.,]\d+)?\s?(?:%|por cento|pontos percentuais|p\.p\.)|\d+(?:[.,]\d+)?\s?(?:vezes|x\b)|\b(?:duas|três|quatro|cinco|seis|sete|oito|nove|dez)\s+vezes\b/gi;

const EXTENSO = { duas: 2, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

// "12,5%" e "12.5 %" viram "12.5"; "US$ 3,9 bilhões" vira "3.9"; "quatro vezes" vira "4"
function valor(trecho) {
  const t = trecho.toLowerCase();
  const ext = t.match(/^(duas|três|quatro|cinco|seis|sete|oito|nove|dez)\s+vezes/);
  if (ext) return String(EXTENSO[ext[1]]);
  const d = t.match(/\d[\d.,]*/);
  if (!d) return null;
  let n = d[0].replace(/[.,]$/, '');
  // separador de milhar brasileiro (1.500) contra decimal (3.9): só é milhar se
  // vier seguido de exatamente três dígitos
  if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, '');
  return n.replace(',', '.');
}

function valoresDe(bruto) {
  // Os códigos dos itens ([n04]) e as URLs estão cheios de dígitos que não são
  // dado: com eles, "n04" validava "quatro vezes" no primeiro teste real.
  const texto = String(bruto).replace(/https?:\/\/\S+/g, ' ').replace(/\bn\d{2}\b/g, ' ');
  const achados = new Set();
  for (const m of texto.matchAll(/\d[\d.,]*/g)) {
    const v = valor(m[0]);
    if (v) { achados.add(v); achados.add(String(Number(v))); }
  }
  for (const [p, n] of Object.entries(EXTENSO)) if (new RegExp(`\\b${p}\\b`, 'i').test(texto)) achados.add(String(n));
  return achados;
}

// Devolve os números da peça que não aparecem em nenhuma fonte, com o trecho em volta.
export function numerosSemFonte(peca, fontes) {
  const conhecidos = valoresDe(fontes);
  const vistos = new Map();
  for (const m of String(peca).matchAll(NUMERO)) {
    const v = valor(m[0]);
    if (!v || conhecidos.has(v) || conhecidos.has(String(Number(v)))) continue;
    if (vistos.has(m[0].trim())) continue;
    const ini = Math.max(0, m.index - 60);
    const trecho = String(peca).slice(ini, m.index + m[0].length + 40).replace(/\s+/g, ' ').trim();
    vistos.set(m[0].trim(), trecho);
  }
  return [...vistos].map(([numero, trecho]) => ({ numero, trecho }));
}

export function travessoes(texto) {
  return (String(texto).match(/[—–]/g) || []).length;
}

// O modelo ignora a regra do travessão mesmo quando o fiscal pede a correção: no
// teste do ao vivo ele devolveu o texto igual, com oito. Então troca por código.
//   "**Rótulo** – texto"          ->  "**Rótulo**: texto"
//   "a análise — que compara — por" ->  "a análise, que compara, por"
//   qualquer outro                 ->  vírgula
// Hífen de palavra composta (pré-operatório) não é travessão e não é tocado.
export function semTravessao(texto) {
  return String(texto)
    .replace(/(\*\*[^*\n]+\*\*)\s*[—–]\s*/g, '$1: ')
    .replace(/\s+[—–]\s+([^—–\n]{1,160}?)\s+[—–]\s+/g, ', $1, ')
    // rótulo sem negrito só em item de lista: numa frase comum, virava dois pontos errado
    .replace(/^(\s*(?:[-*]|\d+[.)])\s+[^\n—–]{1,60}?)\s+[—–]\s+/gm, '$1: ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.;:!?])/g, '$1');
}

/* ---------- o post saiu em inglês ----------
   Aconteceu no documento 51: fontes em inglês e o modelo respondeu na língua
   delas. Como quase todo post tem termo técnico em inglês ("machine learning",
   "forecast"), a conta é por palavra funcional, que só aparece em frase inglesa
   de verdade. */
const FUNCIONAIS = /\b(the|and|of|with|that|for|from|this|these|are|is|was|were|have|has|had|will|would|can|could|their|which|been|than|about|into|through)\b/gi;

export function pareceIngles(texto) {
  const limpo = String(texto).replace(/https?:\/\/\S+/g, ' ').replace(/#\S+/g, ' ');
  const palavras = limpo.split(/\s+/).filter(Boolean).length;
  if (palavras < 25) return false;
  const achadas = (limpo.match(FUNCIONAIS) || []).length;
  return achadas / palavras > 0.06;
}

/* ---------- a cena da imagem ----------
   Pedido do Rubens em 24/09: "todo prompt tem alguma coisa de data center, está
   ficando repetitivo". A causa era o Designer receber só o texto do post, sem a
   área e sem saber o que a casa já tinha gerado: sobre um texto de tecnologia
   ele cai no cenário padrão de tecnologia.

   O conserto de verdade é o Designer passar a receber o tema, o cenário da área
   e as cenas recentes. Isto aqui é a trava que confere se ele obedeceu.

   Tentei antes medir repetição por semelhança entre as cenas, como a trava de
   tema faz. Medido no mesmo dia: duas cenas de data center escritas de formas
   diferentes deram 0.00, porque o que se repete é o MOTIVO e não as palavras. O
   vão entre repetido e diferente ficou estreito demais para um limiar, então a
   trava virou lista fechada, que é o que a casa usa quando a medida não separa. */

// A cena é a primeira coisa que o prompt nomeia. Serve para mostrar ao Designer
// o que já foi feito, sem despejar o prompt inteiro (que é quase todo igual de
// propósito: o filme e o grão são a identidade visual da casa).
const PREAMBULO = /\b(documentary|editorial|photograph|photography|photo|image|shot|taken|candid|realistic)\b/gi;

export function cenaDe(prompt) {
  const linha = String(prompt || '')
    .replace(/\*\*/g, '')
    .split('\n').map((l) => l.trim())
    .find((l) => /^(imagem|image)\s*:/i.test(l) || l.length > 40) || '';
  return linha.replace(/^(imagem|image)\s*:/i, '').replace(PREAMBULO, ' ')
    // o trim vem ANTES de tirar "of a": o preâmbulo removido deixa espaço na
    // frente, e com ele o ^ da expressão nunca casava
    .replace(/\s+/g, ' ').trim().replace(/^(?:(?:of|a|an|the)\s+)+/i, '')
    // corta no primeiro marcador de câmera, filme ou luz: dali em diante o prompt
    // é a identidade visual da casa, igual em todos, e não diz nada da cena
    .split(/\b(?:\d{2}mm|kodak|portra|fuji|ilford|natural grain|available light|golden hour|overcast)\b/i)[0]
    .split(/[.;]/)[0]
    .replace(/[\s,]+(?:on|in|with|at|under)?[\s,]*$/i, '')
    .trim().slice(0, 120);
}

/* O cenário genérico de tecnologia: lista fechada, como a de conteúdo
   patrocinado. Ele só pode aparecer quando o assunto for LITERALMENTE aquilo,
   e quem decide isso é o texto do post, não o Designer. */
const CENA_GENERICA = /\b(data ?cent(er|re)s?|server (rack|room|farm|aisle)s?|rows of (servers|racks)|blinking (led|leds|lights)|network operations cent(er|re)|wall of (monitors|screens)|glowing screens?)\b/i;

export function cenaGenerica(prompt, contexto) {
  const achado = String(prompt || '').match(CENA_GENERICA);
  if (!achado) return null;
  return CENA_GENERICA.test(String(contexto || '')) ? null : achado[0];
}
