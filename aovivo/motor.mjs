// O trabalho ao vivo. Roda por um turno longo e, ao terminar, o próprio workflow
// chama o próximo: a bancada não depende da agenda do GitHub, que em 19/09 pulou
// quase todos os horários e deixou o escritório parado horas seguidas.
//
// Cada passo é publicado no instante em que acontece, com a hora de início e a
// velocidade da escrita. Quem abre o site no meio vê o texto no ponto exato em
// que ele está, porque a tela calcula quanto já foi "digitado" pelo relógio.
// O motor espera a escrita terminar antes do passo seguinte: é isso que faz o
// ritmo ser de gente trabalhando, e não de máquina despejando texto.
//
// A bancada pública trabalha das 7h à meia-noite. De madrugada ela descansa, o
// Diretor monta a pauta do dia e os pedidos do administrador são atendidos. Fora
// disso, só para quando a cota gratuita acaba ou num pedido "para hoje".
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gerar, liberaCotas } from '../src/llm.mjs';
import { pesquisar, empresasCitadas, veiculosCitados, manchetes, buscaFeeds } from '../src/pesquisa.mjs';
import { numerosSemFonte, semTravessao, pareceIngles } from '../src/fiscal.mjs';
import { paraLinkedin } from '../src/linkedin.mjs';
import { parecido } from '../src/memoria.mjs';
import { separa } from '../src/vault.mjs';
import { lerEquipe } from '../bancada/equipe.mjs';
import { destinoPadrao } from './destino.mjs';
import { novoDiario, anota, marcasDoFiscal } from './diario.mjs';

const RAIZ = join(import.meta.dirname, '..');
// data e hora em São Paulo, sem importar o publicar.mjs, que arrastaria o comitê
// junto para o repositório público do motor
const hoje = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
for (const l of (await readFile(join(RAIZ, '.env'), 'utf8').catch(() => '')).split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1').trim();
}
process.env.SO_GROQ = '1';

/* ---------- ritmo ----------
   20 letras por segundo: umas três a quatro vezes a velocidade de uma pessoa
   digitando, devagar o bastante para acompanhar lendo. */
const CPS = Number(process.env.CPS) || 20;
const DURACAO_MIN = Number(process.env.DURACAO_MIN) || 50;
// TESTE_RAPIDO encurta só as esperas, para conferir o fluxo; as chamadas são reais
const FATOR = process.env.TESTE_RAPIDO ? 0.03 : 1;
const RESPIROS = [7, 11, 13, 17];
// minutos entre o começo de um documento e o do próximo, para a cota de tokens do
// Groq durar o expediente inteiro
const INTERVALO_MIN = Number(process.env.INTERVALO_MIN) || 13;
let inicioDoDocumento = 0;
const LIMITE_POST = 2800;

const dorme = (s) => new Promise((ok) => setTimeout(ok, s * 1000 * FATOR));
const agora = () => new Date().toISOString();
const respiro = () => RESPIROS[Math.floor(Math.random() * RESPIROS.length)];
const log = (m) => console.log(`${agora().slice(11, 19)} ${m}`);

const destino = await destinoPadrao(RAIZ);

/* ---------- o diário do dia ----------
   Toda vez que o trabalho volta atrás, fica registrado. O turno carrega o diário
   do dia ao começar, para um turno novo (ou religado pelo vigia) continuar a
   lista em vez de apagá-la, e grava depois de cada anotação: se o processo cair,
   perde-se no máximo o episódio em curso.
   Dois turnos ao mesmo tempo se sobrescreveriam, mas o workflow só deixa um
   rodar por vez, e um episódio perdido não estraga a contagem da semana. */
let diario = (await destino.diario(hoje()).catch(() => null)) || novoDiario(hoje());
if (!Array.isArray(diario.episodios)) diario = novoDiario(hoje());

async function registra(tipo, dados = {}) {
  try {
    if (diario.data !== hoje()) diario = novoDiario(hoje());
    if (anota(diario, tipo, dados)) await destino.gravaDiario(diario);
  } catch (e) {
    // o diário é observação, não produção: se ele falhar, a bancada segue
    log(`diário não gravou (${tipo}): ${e.message}`);
  }
}

/* ---------- o elenco do dia ----------
   Em alguns dias da semana uma cadeira troca de dono: um estagiário, um
   plantonista, uma revisora convidada. O sorteio sai da data, então o turno que
   começa à tarde encontra o mesmo elenco que o da manhã. O substituto herda o
   papel inteiro da cadeira e só acrescenta o jeito dele de trabalhar. */
function sorteioDoDia(data) {
  let h = 2166136261;
  for (const c of data) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

async function elencoDoDia() {
  const { equipe, diretor } = await lerEquipe(join(RAIZ, 'aovivo', 'equipe'));
  const dir = join(RAIZ, 'aovivo', 'elenco');
  const subs = [];
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.md')).sort()) {
    const { meta, corpo } = separa(await readFile(join(dir, f), 'utf8'));
    if (meta.substitui && corpo) subs.push({ ...meta, corpo });
  }
  const s = sorteioDoDia(process.env.ELENCO_DIA || hoje());
  // 3 em cada 7 dias tem troca: "alguns por semana", sem dia fixo
  const troca = subs.length && s % 7 < 3 ? subs[(s >>> 3) % subs.length] : null;
  const cadeiras = equipe.map((a) => {
    if (!troca || troca.substitui !== a.id) return { ...a, titular: a.nome };
    return { ...a, titular: a.nome, nome: troca.nome, estagiario: !!troca.estagiario, substituto: true, papel: `${a.papel}\n\n## Hoje nesta cadeira\n\n${troca.corpo}` };
  });
  return { equipe: cadeiras, diretor, troca };
}

let elenco = await elencoDoDia();
let diaDoElenco = hoje();
let A = Object.fromEntries([...elenco.equipe, elenco.diretor].map((a) => [a.id, a]));
const elencoParaTela = () => [...elenco.equipe, elenco.diretor].map((a) => ({ id: a.id, nome: a.nome, titular: a.titular || a.nome, estagiario: !!a.estagiario, substituto: !!a.substituto }));

/* ---------- o palco ----------
   Público ou privado. No público, o que acontece vai para aovivo/estado e todo
   mundo vê. Num pedido do administrador, o trabalho vai para privado/estado e a
   tela pública só mostra o aviso. */
const turno = { inicio: agora(), fim_previsto: new Date(Date.now() + DURACAO_MIN * 60000).toISOString() };
const novoEstado = () => ({ turno, modo: 'publico', aviso: null, atual: null, trilha: [], peca: null, cps: CPS, elenco: elencoParaTela() });
let E = novoEstado();
let privado = false;
const publica = () => { E.atualizado = agora(); return privado ? destino.estadoPrivado(E) : destino.estado(E); };

// A tela pública parada com um aviso: cota, pauta do dia ou modo privado
async function avisoPublico(modo, aviso, acao) {
  await destino.estado({
    turno, modo, aviso, cps: CPS, elenco: elencoParaTela(), trilha: [], peca: null, atualizado: agora(),
    atual: { agente: 'Diretor', id: 'diretor', acao: acao || aviso, texto: '', pensando: true, inicio: agora() },
  });
}

/* ---------- interrupção ----------
   Pedido "para hoje" do administrador para a bancada na hora, no meio do que
   estiver fazendo. A conferência é um documento só no banco, lido no máximo a
   cada 20 segundos. */
class Interrompido extends Error {}
let ultimaConferencia = 0;
async function confereInterrupcao() {
  if (privado || Date.now() - ultimaConferencia < 20000 * FATOR) return;
  ultimaConferencia = Date.now();
  const u = await destino.urgente().catch(() => null);
  if (u?.id) throw new Interrompido(u.id);
}

// alguém pensando: a tela mostra o agente concentrado, sem texto ainda
async function pensa(agente, acao) {
  await confereInterrupcao();
  E.atual = { agente: agente.nome, id: agente.id, acao, texto: '', pensando: true, inicio: agora() };
  await publica();
  log(`${agente.nome}: ${acao}…`);
}

// alguém escrevendo: publica o texto inteiro com a hora de início, e espera o
// tempo que a escrita leva na tela antes de seguir
async function escreve(agente, acao, bruto) {
  await confereInterrupcao();
  // travessão sai por código antes de ir para a tela: o modelo ignora a regra
  const texto = semTravessao(bruto);
  E.atual = { agente: agente.nome, id: agente.id, acao, texto, pensando: false, inicio: agora() };
  await publica();
  log(`${agente.nome}: ${acao} (${texto.length} letras, ${Math.round(texto.length / CPS)}s de escrita)`);
  await dorme(texto.length / CPS + respiro());
  E.trilha.push({ agente: agente.nome, id: agente.id, acao, resumo: texto.replace(/\s+/g, ' ').slice(0, 180), fim: agora() });
  E.trilha = E.trilha.slice(-14);
}

const chama = (agente, prompt, schema = null) => gerar({ modelo: agente.modelo, sistema: agente.papel, prompt, temperatura: agente.temperatura, schema });
// quanto de cada fonte cabe no pedido: o Gemini lê o texto quase inteiro, o Groq
// tem 8 mil tokens por minuto e precisa do trecho curto
const letrasPara = (agente, curto) => (String(agente.modelo).trim().startsWith('gemini') ? curto * 3 : curto);
const FISCAL = { nome: 'Fiscal', id: 'fiscal' };

/* ---------- as quatro áreas ----------
   Escolhida pelo código, em rodízio pelo número do documento: deixada ao modelo,
   a bancada escreveu 14 de 15 documentos sobre IA. */
const AREAS = [
  { nome: 'Tecnologia', foco: 'infraestrutura, software, telecom, chips, dados, nuvem, segurança digital, energia e hardware' },
  { nome: 'Mundo corporativo', foco: 'gestão, trabalho, carreira, liderança, produtividade, governança, mercado e regulação que muda a vida das empresas, sempre com o ângulo de tecnologia ou transformação' },
  { nome: 'Inteligência artificial', foco: 'modelos, uso em setores, regulação, trabalho, custos, riscos e pesquisa em IA' },
  { nome: 'Inovação', foco: 'pesquisa aplicada, ciência, novos materiais, saúde, agro, indústria, cidades, startups (sem nome) e políticas de inovação' },
];

/* ---------- as etapas ---------- */
const SCHEMA_TEMA = {
  type: 'OBJECT',
  properties: {
    tema: { type: 'STRING', description: 'O tema em uma frase que alguém entende sem contexto. Sem nome de empresa.' },
    porque: { type: 'STRING', description: 'Duas frases: por que este tema importa agora para quem trabalha.' },
    consulta_pt: { type: 'STRING', description: 'De 2 a 4 palavras amplas em português, sem país, ano ou nome próprio.' },
    consulta_en: { type: 'STRING', description: 'De 2 a 4 palavras amplas em inglês, sem país, ano ou nome próprio.' },
  },
  required: ['tema', 'porque', 'consulta_pt', 'consulta_en'],
};
const REGRA_BUSCA = 'As buscas: de 2 a 4 palavras, amplas, SEM país, SEM ano e SEM nome próprio. Busca estreita volta vazia e o tema é recusado por falta de fonte. Exemplo bom: "consumo energia data centers" / "data center energy use". Exemplo ruim: "demanda profissionais IA Brasil 2024".';
const dataPorExtenso = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

async function escolheTema(area, recentes, recusados) {
  await pensa(A.diretor, `escolhendo o tema (${area.nome})`);
  const t = await chama(A.diretor, [
    `Hoje é ${dataPorExtenso()}. Escolha o tema do próximo documento.`,
    `Área da vez: **${area.nome}**, ou seja, ${area.foco}. Sem nome de empresa, com chance real de ter fonte pública e confiável.`,
    '',
    `${REGRA_BUSCA} Deixe o tema amplo também: o recorte (Brasil, um setor) só entra no texto se as fontes o cobrirem.`,
    // o prompt leva os 45 mais recentes; a conferência por código olha bem mais
    // fundo, porque a lista inteira num pedido só encarece cada chamada
    recentes.length ? `\nTemas dos últimos documentos, NÃO repita nem chegue perto:\n${recentes.slice(-45).map((r) => `- ${r}`).join('\n')}` : '',
    recusados.length ? `\nTemas que o Pesquisador acabou de recusar por falta de fonte:\n${recusados.map((r) => `- ${r}`).join('\n')}` : '',
  ].join('\n'), SCHEMA_TEMA);
  // repetição conferida por código: o modelo esquece a lista que acabou de ler
  const repetido = recentes.find((r) => parecido(r, t.tema) >= 0.45);
  if (repetido) { log(`tema parecido com "${repetido}", pedindo outro`); return { ...t, repetido }; }
  await escreve(A.diretor, 'escolheu o tema', `${t.tema}\n\n${t.porque}`);
  return t;
}

// Num pedido do administrador o tema já vem dado: o Diretor só traduz em busca
async function temaDoPedido(pedido, tentativa) {
  await pensa(A.diretor, 'lendo o pedido do administrador');
  const t = await chama(A.diretor, [
    `Hoje é ${dataPorExtenso()}. O administrador pediu um documento sobre este tema. Não troque de tema; escreva-o numa frase clara e gere as buscas.`,
    '', `Tema pedido: ${pedido.tema}`,
    pedido.contexto ? `\nContexto que veio com o pedido:\n${String(pedido.contexto).slice(0, 1500)}` : '',
    '', REGRA_BUSCA,
    tentativa ? `\nEsta é a tentativa ${tentativa + 1}: as buscas anteriores não acharam três fontes. Use palavras MAIS amplas e diferentes.` : '',
  ].join('\n'), SCHEMA_TEMA);
  await escreve(A.diretor, 'entendeu o pedido', `${t.tema}\n\n${t.porque}`);
  return t;
}

// O trecho de cada fonte vai no pedido duas vezes (apuração e auditoria), e é o
// que mais pesa na cota de tokens do dia. 1.100 letras ainda dão o miolo da
// notícia; a auditoria se vira com menos, porque confere afirmação, não contexto.
function blocoFontes(fontes, comTexto, letras = 1100) {
  return fontes.map((f) => `[${f.id}] ${f.titulo} (${f.dominio}, ${f.tipo}${f.data ? `, ${String(f.data).slice(0, 10)}` : ''})${comTexto ? `\n${f.texto.slice(0, letras)}` : ''}`).join('\n\n');
}

const SCHEMA_MANCHETE = {
  type: 'OBJECT',
  properties: {
    numero: { type: 'NUMBER', description: 'O número da manchete escolhida na lista.' },
    tema: { type: 'STRING', description: 'O tema do documento em uma frase, sem nome de empresa.' },
    porque: { type: 'STRING', description: 'Duas frases: por que este tema importa para quem trabalha.' },
    palavras: { type: 'STRING', description: 'De 3 a 5 palavras do assunto, para achar as outras notícias sobre ele.' },
  },
  required: ['numero', 'tema', 'porque', 'palavras'],
};

// O caminho de quando a busca falha: escolher entre o que os veículos publicaram
async function pelasManchetes(recentes) {
  await pensa(A.diretor, 'lendo as manchetes do dia');
  const lista = await manchetes({ dias: 2, max: 40 }).catch(() => []);
  if (lista.length < 5) { log('nem as manchetes vieram'); return null; }
  const t = await chama(A.diretor, [
    `Hoje é ${dataPorExtenso()}. A busca na internet está fora do ar, então o tema sai das manchetes que os veículos publicaram agora.`,
    'Escolha UMA manchete que dê um documento útil para quem trabalha, em tecnologia, inovação, mundo corporativo ou IA. Evite nota de consumo, lançamento de produto e política partidária.',
    '', ...lista.map((m, i) => `${i + 1}. ${m.titulo} (${m.veiculo})`),
    recentes.length ? `\nTemas recentes, NÃO repita:\n${recentes.slice(-30).map((r) => `- ${r}`).join('\n')}` : '',
  ].join('\n'), SCHEMA_MANCHETE);

  const escolhida = lista[Math.round(t.numero) - 1];
  if (!escolhida) return null;
  await escreve(A.diretor, 'escolheu o tema', `${t.tema}\n\n${t.porque}`);
  const peca = { tema: t.tema, area: 'Manchete do dia', fontes: [] };
  E.peca = peca;

  await pensa(A.pesquisador, 'lendo a manchete e o que mais saiu sobre ela');
  // a manchete escolhida mais as parecidas, achadas nos próprios feeds
  const relacionadas = await buscaFeeds({ pt: `${t.palavras} ${escolhida.titulo}`, en: t.palavras }).catch(() => []);
  const itens = [escolhida, ...relacionadas.filter((r) => r.url !== escolhida.url)].slice(0, 8);
  const p = await pesquisar({ pt: t.palavras, en: '' }, { maxFontes: 6, log, itens });
  const fontes = p.fontes;
  peca.fontes = fontes.map((f) => ({ id: f.id, titulo: f.titulo, url: f.url, dominio: f.dominio, tipo: f.tipo }));
  await escreve(A.pesquisador, 'separou as fontes', [
    `${fontes.length} fontes abertas e lidas, a partir das manchetes do dia.`,
    '', ...fontes.map((f) => `[${f.id}] ${f.dominio}: ${f.titulo}`),
  ].join('\n'));
  if (fontes.length < 3) {
    await escreve(A.pesquisador, 'recusou o tema', 'Nem pelas manchetes deu três fontes. Melhor esperar a busca voltar.');
    return null;
  }
  await pensa(A.pesquisador, `lendo ${fontes.length} fontes`);
  const apuracao = await chama(A.pesquisador, [`Tema: ${t.tema}`, '', '## Fontes (use só estas, pelo código)', blocoFontes(fontes, true, letrasPara(A.pesquisador, 1100))].join('\n'));
  if (/^\W*N[ÃA]O SUSTENTA/i.test(apuracao)) { await escreve(A.pesquisador, 'recusou o tema', apuracao); return null; }
  await escreve(A.pesquisador, 'apuração', apuracao);
  return { tema: { ...t, tema: t.tema }, fontes, apuracao, peca };
}

async function umDocumento({ pedido = null } = {}) {
  const qualidade = !!pedido;
  // 200 temas, uns quatro dias de trabalho: com 40, "detecção de fraudes em
  // pagamentos digitais" voltou no dia seguinte, porque a bancada passou a fazer
  // mais de 40 documentos por dia
  const recentes = pedido ? [] : await destino.temasRecentes(200);
  const numeroPrevisto = pedido ? 0 : await destino.proximoNumero();
  const area = pedido ? { nome: 'Pedido do administrador' } : AREAS[numeroPrevisto % AREAS.length];
  const recusados = [];
  let tema; let fontes = []; let apuracao = '';

  // o Diretor propõe, o Pesquisador confere se há fonte; até três tentativas
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    tema = pedido ? await temaDoPedido(pedido, tentativa) : await escolheTema(area, recentes, recusados);
    if (tema.repetido) {
      recusados.push(tema.tema);
      await registra('repetido', { tema: tema.tema, area: area.nome, parecido: tema.repetido, pedido: !!pedido });
      continue;
    }
    E.peca = { tema: tema.tema, area: area.nome, fontes: [] };

    await pensa(A.pesquisador, 'buscando fontes em notícias e artigos');
    // pedido do administrador: qualidade antes de velocidade, mais fontes lidas
    const p = await pesquisar({ pt: tema.consulta_pt, en: tema.consulta_en }, { maxFontes: qualidade ? 8 : 6, log });
    fontes = p.fontes;
    E.peca.fontes = fontes.map((f) => ({ id: f.id, titulo: f.titulo, url: f.url, dominio: f.dominio, tipo: f.tipo }));
    const r = p.recusadas;
    await escreve(A.pesquisador, 'separou as fontes', [
      `${fontes.length} fontes confiáveis abertas e lidas. Descartadas: ${r.naoConfiavel} fora da lista confiável, ${r.naoAbriu} que não abriram, ${r.semTexto} sem texto.`,
      '', ...fontes.map((f) => `[${f.id}] ${f.dominio}: ${f.titulo}`),
    ].join('\n'));

    if (fontes.length < 3) {
      await escreve(A.pesquisador, 'recusou o tema', 'Menos de três fontes confiáveis. Não dá para sustentar um documento com isso. Diretor, outro recorte.');
      recusados.push(tema.tema);
      await registra('sem_fonte', {
        tema: tema.tema, area: area.nome, consulta_pt: tema.consulta_pt, consulta_en: tema.consulta_en,
        achadas: fontes.length, descartadas: { fora_da_lista: r.naoConfiavel, nao_abriram: r.naoAbriu, sem_texto: r.semTexto }, pedido: !!pedido,
      });
      continue;
    }

    await pensa(A.pesquisador, `lendo ${fontes.length} fontes`);
    apuracao = await chama(A.pesquisador, [`Tema: ${tema.tema}`, '', '## Fontes (use só estas, pelo código)', blocoFontes(fontes, true)].join('\n'));
    if (/^\W*N[ÃA]O SUSTENTA/i.test(apuracao)) {
      await escreve(A.pesquisador, 'recusou o tema', apuracao);
      recusados.push(tema.tema);
      await registra('nao_sustenta', { tema: tema.tema, area: area.nome, consulta_pt: tema.consulta_pt, achadas: fontes.length, pedido: !!pedido });
      continue;
    }
    // fonte que o Pesquisador marcou como fora do tema sai antes de o Diretor
    // escrever: no primeiro documento, duas fontes sem relação foram forçadas no texto
    // só a linha que COMEÇA com a marca vale, e "nenhuma" não tira nada: no segundo
    // teste uma frase explicativa fez o leitor retirar as três fontes de uma vez
    const fora = new Set([...apuracao.matchAll(/^\s*[-*]?\s*\**FORA DO TEMA\**\s*:\s*([^\n]+)/gim)]
      .filter((m) => !/nenhum|nada|none|todas? (estão|est[aã]o) no tema/i.test(m[1]))
      .flatMap((m) => m[1].match(/\bf\d+\b/g) || []));
    if (fora.size) {
      fontes = fontes.filter((f) => !fora.has(f.id));
      E.peca.fontes = E.peca.fontes.filter((f) => !fora.has(f.id));
      log(`fora do tema, retiradas: ${[...fora].join(', ')}`);
    }
    await escreve(A.pesquisador, 'apuração', apuracao);
    if (fontes.length < 3) {
      await escreve(A.pesquisador, 'recusou o tema', 'Tirando as fontes fora do tema, sobraram menos de três. Diretor, outro recorte.');
      recusados.push(tema.tema);
      await registra('fora_do_tema', { tema: tema.tema, area: area.nome, consulta_pt: tema.consulta_pt, retiradas: [...fora], sobraram: fontes.length, pedido: !!pedido });
      apuracao = '';
      continue;
    }
    break;
  }
  /* Plano B: o buscador bloqueou o servidor e nenhum tema achou fonte. Em vez de
     desistir, o Diretor escolhe entre as manchetes que os veículos publicaram,
     lidas pelo RSS deles, que não depende de buscador nenhum. Foi o que salvou a
     tarde de 20/09, quando Bing e Google passaram a devolver zero. */
  if (!apuracao && !pedido) {
    const r = await pelasManchetes(recentes);
    if (r) { tema = r.tema; fontes = r.fontes; apuracao = r.apuracao; E.peca = r.peca; }
  }

  if (!apuracao || /^\W*N[ÃA]O SUSTENTA/i.test(apuracao)) {
    await escreve(A.diretor, 'pausa', pedido ? 'Três buscas sem fonte suficiente para o pedido. Aviso o administrador.' : 'Três temas sem fonte suficiente. Pausa curta e recomeço com outro recorte.');
    await registra('sem_tema', { area: area.nome, tentados: recusados, pedido: !!pedido });
    return { falhou: 'sem fonte suficiente em três buscas' };
  }

  const fontesTexto = fontes.map((f) => `${f.titulo}\n${f.texto}`).join('\n\n');
  const listaFontes = blocoFontes(fontes, false);

  await pensa(A.diretor, 'escrevendo o post');
  let doc = await chama(A.diretor, [
    `Tema: ${tema.tema}`, pedido?.contexto ? `\n## O que o administrador mandou junto\n${String(pedido.contexto).slice(0, 1500)}` : '',
    '', '## A apuração do Pesquisador', apuracao, '', '## As fontes', listaFontes, '',
    'Escreva o post para o LinkedIn, no formato do seu papel. Comece pelo título numa linha com #. Cite as fontes pelo código entre colchetes, como [f2], logo depois da informação que veio dela. Use pelo menos três fontes diferentes.',
    '',
    'Se as fontes não cobrem um recorte do tema (um país, um setor), NÃO recuse: ajuste o recorte do texto ao que as fontes cobrem. Você escreve um post, nunca uma mensagem pedindo mais fontes.',
  ].join('\n'));

  // Recusa ou texto curto demais não é documento. No segundo teste uma recusa do
  // Diretor ("não é possível elaborar") passou pelo Auditor, ganhou capa e foi
  // publicada como documento 2.
  if (doc.length < 700 || /n[ãa]o (é|e) poss[íi]vel (elaborar|escrever|produzir)|n[ãa]o h[áa] como|envie|envi[áa]-las|forne[çc]a (mais|outras)/i.test(doc.slice(0, 600))) {
    await escreve(A.diretor, 'desistiu do tema', 'As fontes não sustentam um post inteiro sobre isso. Troco de tema.');
    await registra('desistiu', { tema: tema.tema, area: area.nome, fontes: fontes.length, letras: doc.length, pedido: !!pedido });
    return { falhou: 'o Diretor não conseguiu escrever com essas fontes' };
  }
  await escreve(A.diretor, 'escreveu o post', doc);

  /* O fiscal por código. Até 19/09 ele só anotava alerta e o documento saía
     assim mesmo: o 10 foi publicado com uma fonte só, o 9 e o 10 com veículo
     citado. Agora ele barra: o que não passar depois das revisões não é publicado. */
  const confere = (texto) => {
    const validos = new Set(fontes.map((f) => f.id));
    const { post, usadas } = paraLinkedin(texto, fontes);
    return {
      empresas: empresasCitadas(texto, fontes),
      veiculos: veiculosCitados(texto, fontes),
      numeros: numerosSemFonte(texto, fontesTexto).map((n) => n.numero),
      codigos: [...new Set([...texto.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]).filter((id) => !validos.has(id)))],
      usadas: usadas.length,
      tamanho: post.length,
      ingles: pareceIngles(post),
    };
  };
  const problemas = (x) => [
    ...(x.empresas.length ? [`Empresa citada pelo nome, proibido: ${x.empresas.join(', ')}. Descreva em vez de nomear. Só pode ficar se for autora de um dado, escrito como "segundo relatório da X" com o código da fonte que traz esse nome na mesma frase.`] : []),
    ...(x.veiculos.length ? [`Veículo de imprensa citado pelo nome no texto: ${x.veiculos.join(', ')}. Tire o nome; a referência numerada já mostra de onde veio.`] : []),
    ...(x.numeros.length ? [`Número que não aparece em nenhuma fonte: ${x.numeros.join(', ')}. Corte ou troque pelo número exato da fonte.`] : []),
    ...(x.codigos.length ? [`Código de fonte que não existe: ${x.codigos.join(', ')}.`] : []),
    ...(x.ingles ? ['O post saiu em inglês. Escreva em português do Brasil, mesmo quando as fontes estiverem em inglês.'] : []),
    ...(x.usadas < 3 ? [`O post cita só ${x.usadas} fonte(s). Use pelo menos três fontes diferentes da lista, cada uma pelo código.`] : []),
    ...(x.tamanho > LIMITE_POST ? [`O post tem ${x.tamanho} caracteres e o limite é ${LIMITE_POST - 200}. Encurte sem perder as fontes.`] : []),
  ];

  let f = confere(doc);
  // o que o fiscal achou ANTES de qualquer correção: se o documento sair, é isto
  // que vira o episódio "corrigido", e é a contagem que mostra o que ele mais pega
  const marcasDeEntrada = marcasDoFiscal(f);
  // pedido do administrador ganha uma rodada de revisão a mais
  const rodadas = qualidade ? 2 : 1;
  for (let i = 0; i < rodadas && problemas(f).length; i++) {
    await escreve(FISCAL, 'conferiu por código', problemas(f).map((p) => `- ${p}`).join('\n'));
    await pensa(A.diretor, 'corrigindo o que o fiscal apontou');
    doc = await chama(A.diretor, ['Reescreva o post corrigindo exatamente isto, e mais nada:', ...problemas(f).map((p) => `- ${p}`), '', '## Fontes', listaFontes, '', '## O post', doc].join('\n'));
    await escreve(A.diretor, 'corrigiu', doc);
    f = confere(doc);
  }

  await pensa(A.auditor, 'conferindo com as fontes do lado');
  const parecer = await chama(A.auditor, ['## Fontes', blocoFontes(fontes, true, 700), '', '## O post', doc].join('\n'));
  await escreve(A.auditor, 'parecer', parecer);

  if (/CORRIGIR\s*\**\s*$/i.test(parecer.trim()) || /\*\*CORRIGIR\*\*/.test(parecer)) {
    await pensa(A.diretor, 'aplicando o parecer do Auditor');
    doc = await chama(A.diretor, ['Aplique as correções do Auditor. Mantenha todas as regras: sem empresa pelo nome (só como autora de dado, "segundo relatório da X [fN]"), sem veículo pelo nome, só números das fontes, pelo menos três fontes pelo código, no máximo 2.600 caracteres.', '', '## Parecer', parecer, '', '## Fontes', listaFontes, '', '## O post', doc].join('\n'));
    await escreve(A.diretor, 'versão final', doc);
    f = confere(doc);
  }

  // última chance: a correção do Auditor pode ter reaberto um problema do fiscal
  if (problemas(f).length) {
    await escreve(FISCAL, 'conferiu por código', problemas(f).map((p) => `- ${p}`).join('\n'));
    await pensa(A.diretor, 'última correção');
    doc = await chama(A.diretor, ['Reescreva o post corrigindo exatamente isto, e mais nada:', ...problemas(f).map((p) => `- ${p}`), '', '## Fontes', listaFontes, '', '## O post', doc].join('\n'));
    await escreve(A.diretor, 'corrigiu', doc);
    f = confere(doc);
  }
  if (problemas(f).length) {
    await escreve(FISCAL, 'barrou a publicação', ['O post não passou na conferência e não será publicado:', ...problemas(f).map((p) => `- ${p}`)].join('\n'));
    await registra('barrado', { tema: tema.tema, area: area.nome, marcas: marcasDoFiscal(f), entrou_com: marcasDeEntrada, pedido: !!pedido });
    return { falhou: `barrado pelo fiscal: ${problemas(f).join(' ')}` };
  }

  await pensa(A.designer, 'pensando na imagem');
  const imagem = await chama(A.designer, `Post:\n${doc.slice(0, 2600)}`);
  await escreve(A.designer, 'imagem', imagem);

  const pronto = await montaDocumento({ tema, area, doc, fontes, imagem, pedido });
  if (marcasDeEntrada.length) await registra('corrigido', { tema: tema.tema, area: area.nome, marcas: marcasDeEntrada, numero: pronto.numero, pedido: !!pedido });
  await registra('publicado', { tema: tema.tema, area: area.nome, numero: pronto.numero, titulo: pronto.titulo, fontes: fontes.length, pedido: !!pedido });
  return pronto;
}

/* ---------- o documento publicado ----------
   O post, o primeiro comentário com as referências e o prompt da imagem, num
   arquivo só, pronto para copiar. Os links são montados pelo código a partir da
   pesquisa: o modelo nunca escreve URL. */
async function montaDocumento({ tema, area, doc: bruto, fontes, imagem, pedido }) {
  const doc = semTravessao(bruto);
  const { post, usadas } = paraLinkedin(doc, fontes);
  const numero = pedido ? await destino.proximoNumeroPrivado() : await destino.proximoNumero();
  const titulo = semTravessao((doc.match(/^\s*#\s+(.+)$/m) || [, tema.tema])[1].trim());
  const data = hoje();
  const refs = usadas.map((id, i) => { const x = fontes.find((f) => f.id === id); return `(${i + 1}) ${x.titulo}\n${x.url}`; });
  const comentario = ['Fontes citadas no post:', '', ...refs].join('\n');
  const img = semTravessao(imagem).replace(/\*\*/g, '').trim();
  const linha = '='.repeat(56);
  const texto = [
    `${pedido ? 'Pedido' : 'Documento'} ${numero} · ${data.split('-').reverse().join('/')}`,
    `Tema: ${tema.tema}`,
    `Área: ${area.nome}`,
    '',
    linha, `POST PARA O LINKEDIN (${post.length} caracteres, copie e cole)`, linha, '',
    post, '',
    linha, 'PRIMEIRO COMENTÁRIO (as referências, link fora do post)', linha, '',
    comentario, '',
    linha, 'IMAGEM (prompt para o gerador de imagem)', linha, '',
    // o tema vai junto do prompt: é a referência de quem gera a imagem, e amarra
    // a cena ao texto em vez de virar foto genérica de tecnologia
    `Pauta ilustrada: ${tema.tema}`,
    `Área: ${area.nome}`, '',
    img, '',
  ].join('\n');
  const id = `${pedido ? 'p' : ''}${data}-${String(numero).padStart(4, '0')}`;
  const pronto = { id, numero, titulo, tema: tema.tema, categoria: area.nome, data, post, comentario, imagem: img, texto, markdown: texto, alertas: [], pedido: pedido?.id || null };
  // O arquivo só é gravado DEPOIS de o anúncio terminar de aparecer na tela. Ele
  // já está pronto antes, mas liberar o download enquanto a cena ainda corre faria
  // a lista encher sozinha, sem relação com o que se vê acontecendo.
  await escreve(A.diretor, 'publicou', `${pedido ? 'Pedido' : 'Documento'} ${numero}: ${titulo}\n\n${post}`);
  if (pedido) await destino.documentoPrivado(pronto);
  else await destino.documento(pronto);
  // a tela avisa que saiu documento novo, para a lista não esperar a próxima leitura
  E.publicou = { numero, titulo, em: agora() };
  await publica();
  return pronto;
}

/* ---------- o expediente do dia (horário de São Paulo) ----------
   Pedido do Rubens em 19/09:
     00h às 05h  folga: a bancada pública para
     05h às 06h  o Diretor monta a pauta do dia (comitê, no repositório privado)
     06h às 07h  pedidos "pode esperar" do administrador; se não der tempo, tudo bem
     07h         volta o ao vivo, em ponto
   Pedido do Rubens em 22/09:
     sábado e domingo a bancada não escreve pauta. No sábado, às 7h, ela se reúne
     para organizar o backlog da semana e avaliar a própria ferramenta; o resto do
     fim de semana é descanso. Pedido do administrador continua rodando.
   Pedido "para hoje" roda a qualquer hora: é urgente por definição.
   Documento público novo não começa depois das 23h40, para a bancada não entrar
   na folga no meio de um texto. */
const minutoSP = () => { const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number); return (h % 24) * 60 + m; };
// 0 domingo … 6 sábado, no fuso de São Paulo
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const diaSP = () => DIAS[new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date())];
const fimDeSemana = () => diaSP() === 0 || diaSP() === 6;
// O sábado deste fim de semana, que é o nome da reunião: no sábado é hoje, no
// domingo é ontem. Meio-dia UTC para subtrair dias sem esbarrar em fuso.
function sabadoDaSemana() {
  const d = new Date(`${hoje()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((diaSP() + 1) % 7));
  return d.toISOString().slice(0, 10);
}
const noExpediente = () => { const m = minutoSP(); return m >= 7 * 60 && m < 23 * 60 + 40; };
const horaDosPedidos = () => { const m = minutoSP(); return m >= 6 * 60 && m < 7 * 60; };
const segundosAteAs7 = () => { const m = minutoSP(); return m < 7 * 60 ? (7 * 60 - m) * 60 : Infinity; };

// O que a tela pública mostra fora do expediente
function avisoForaDoExpediente() {
  const m = minutoSP();
  if (m >= 5 * 60 && m < 6 * 60) return { modo: 'pauta', aviso: 'O Diretor está montando a pauta do dia', acao: 'montando a pauta do dia' };
  return { modo: 'folga', aviso: 'A bancada volta às 7h', acao: 'folga' };
}

/* ---------- pedidos do administrador ---------- */

// O próximo pedido a fazer agora: o urgente sempre; os de "pode esperar" só entre
// 6h e 7h, depois que o Diretor fechou a pauta do dia.
async function proximoPedido() {
  const u = await destino.urgente().catch(() => null);
  const fila = (await destino.pedidos().catch(() => [])).filter((p) => p.status === 'fila').sort((a, b) => a.numero - b.numero);
  if (u?.id) {
    const p = fila.find((x) => x.id === u.id);
    if (p) return p;
    await destino.limpaUrgente();
  }
  const urgente = fila.find((p) => p.urgencia === 'hoje');
  if (urgente) return urgente;
  return horaDosPedidos() ? fila[0] || null : null;
}

async function fazPedido(p, tela = { modo: 'privado', aviso: 'Rodando no modo privado pelo Admin', acao: 'modo privado' }) {
  log(`pedido ${p.numero} do administrador: ${p.tema}`);
  await destino.atualizaPedido({ ...p, status: 'em produção', inicio: agora() });
  await avisoPublico(tela.modo, tela.aviso, tela.acao);
  privado = true;
  E = novoEstado();
  E.modo = 'privado';
  // é por esta marca que o admin sabe que tem trabalho privado para mostrar,
  // qualquer que seja o aviso da tela pública
  E.ativo = true;
  E.pedido = { id: p.id, numero: p.numero, tema: p.tema, urgencia: p.urgencia };
  let r;
  try {
    r = await umDocumento({ pedido: p });
  } catch (e) {
    r = { falhou: e.message };
    if (e.semCota) r.semCota = true;
  } finally {
    privado = false;
  }
  if (r?.id) await destino.atualizaPedido({ ...p, status: 'pronto', fim: agora(), documento: r.id, titulo: r.titulo });
  else if (r?.semCota) await destino.atualizaPedido({ ...p, status: 'fila', obs: 'cota do dia acabou no meio; volta para a fila' });
  else await destino.atualizaPedido({ ...p, status: 'falhou', fim: agora(), motivo: r?.falhou || 'erro' });
  const u = await destino.urgente().catch(() => null);
  if (u?.id === p.id) await destino.limpaUrgente();
  await destino.estadoPrivado({ ...E, ativo: false, atualizado: agora() }).catch(() => {});
  E = novoEstado();
  E.atual = { agente: 'Diretor', id: 'diretor', acao: 'pedido encerrado, voltando ao ao vivo', texto: '', pensando: true, inicio: agora() };
  await publica();
  if (r?.semCota) throw Object.assign(new Error('sem cota'), { semCota: true });
}

/* ---------- o turno ---------- */
const fim = Date.now() + DURACAO_MIN * 60000;
log(`turno de ${DURACAO_MIN} min, ${CPS} letras/s, destino ${destino.nome}`);
if (elenco.troca) log(`elenco de hoje: ${elenco.troca.nome} no lugar do titular de ${elenco.troca.substitui}`);
let feitos = 0;

while (Date.now() < fim - 20 * 60000 * FATOR) {
  // virou o dia: o elenco pode ter mudado
  if (hoje() !== diaDoElenco) {
    elenco = await elencoDoDia(); diaDoElenco = hoje();
    A = Object.fromEntries([...elenco.equipe, elenco.diretor].map((a) => [a.id, a]));
  }
  try {
    // pausa do administrador: termina o documento em curso (esta conferência só
    // acontece entre documentos) e a bancada vai lanchar até ele liberar
    const pausa = await destino.pausa().catch(() => null);
    if (pausa?.ativa) {
      const avisoLanche = pausa.aviso || 'Rodando um pedido do Rubens no modo privado';
      // no lanche a tela pública fica parada, mas pedido do administrador roda:
      // só ele vê o trabalho, pelo admin
      const pedidoNoLanche = await proximoPedido();
      if (pedidoNoLanche) { await fazPedido(pedidoNoLanche, { modo: 'lanche', aviso: avisoLanche, acao: 'hora do lanche' }); feitos++; continue; }
      await avisoPublico('lanche', avisoLanche, 'hora do lanche');
      log('pausa do administrador, bancada no lanche');
      await dorme(60);
      continue;
    }

    /* Fim de semana: a produção de pauta para. O que continua é o pedido do
       administrador, porque ele é trabalho dele, não da bancada. */
    if (fimDeSemana()) {
      const aviso = { modo: 'fimdesemana', aviso: 'A bancada descansa no fim de semana. Volta segunda às 7h.', acao: 'fim de semana' };
      const pedidoFds = await proximoPedido();
      if (pedidoFds) { await fazPedido(pedidoFds, aviso); feitos++; continue; }
      await avisoPublico(aviso.modo, aviso.aviso, aviso.acao);
      await dorme(5 * 60);
      continue;
    }

    // fora do expediente a tela pública descansa; pedido do administrador roda
    // por trás (o urgente a qualquer hora, o "pode esperar" entre 6h e 7h)
    if (!noExpediente()) {
      const fora = avisoForaDoExpediente();
      const pedidoFora = await proximoPedido();
      if (pedidoFora) { await fazPedido(pedidoFora, fora); feitos++; continue; }
      await avisoPublico(fora.modo, fora.aviso, fora.acao);
      // acorda em ponto às 7h, sem esperar o minuto inteiro
      await dorme(Math.max(5, Math.min(60, segundosAteAs7())));
      continue;
    }

    // o Diretor montando a pauta do dia (comitê da madrugada): a bancada para e espera
    const d = await destino.diretor().catch(() => null);
    if (d?.rodando && Date.now() - Date.parse(d.desde || 0) < 3 * 3600000) {
      await avisoPublico('pauta', 'O Diretor está montando a pauta do dia', 'montando a pauta do dia');
      log('Diretor montando a pauta do dia, bancada em espera');
      await dorme(90);
      continue;
    }

    const pedido = await proximoPedido();
    if (pedido) { await fazPedido(pedido); feitos++; }
    else {
      E = novoEstado();
      inicioDoDocumento = Date.now();
      const doc = await umDocumento();
      if (doc?.id) feitos++;
    }
  } catch (e) {
    privado = false;
    if (e instanceof Interrompido) {
      log(`interrompido por pedido urgente do administrador (${e.message})`);
      continue;
    }
    if (e.semCota) {
      // a cota volta sozinha: fica esperando dentro do turno, tentando de tempos em tempos
      log('cota gratuita do dia esgotada, esperando');
      await registra('sem_cota', {});
      await avisoPublico('cota', 'A cota gratuita de IA acabou por agora. A bancada volta sozinha quando ela renovar.', 'esperando a cota renovar');
      await dorme(20 * 60);
      liberaCotas();
      continue;
    }
    log(`erro no documento: ${e.message}`);
    await escreve(A.diretor, 'pausa', 'Um passo falhou. Pausa curta e recomeço.').catch(() => {});
  }
  E = novoEstado();
  E.atual = { agente: 'Diretor', id: 'diretor', acao: 'pensando no próximo tema', texto: '', pensando: true, inicio: agora() };
  /* O compasso do dia. O freio do Groq não é o número de chamadas: são 200 mil
     tokens por dia POR MODELO, 600 mil no total. Cada documento gasta uns 11 mil
     depois do corte dos trechos de fonte, então a cota dá umas 50 peças. Espaçando
     um documento a cada 20 minutos, as 17 horas de expediente cabem na cota; sem
     isso, em 20/09 a bancada fez 36 documentos em 7 horas e ficou parada até a noite. */
  const faltaDoCompasso = Math.max(0, INTERVALO_MIN * 60 - (Date.now() - inicioDoDocumento) / 1000);
  if (faltaDoCompasso > 0) log(`compasso: ${Math.round(faltaDoCompasso / 60)} min até o próximo documento`);
  // a tela mostra a hora do próximo, para a pausa do compasso não parecer travamento
  E.proximo = new Date(Date.now() + faltaDoCompasso * 1000).toISOString();
  await publica();
  // a espera entre documentos também para na hora se chegar pedido urgente
  for (let s = 0, total = Math.max(40 + Math.random() * 40, faltaDoCompasso); s < total; s += 20) {
    await dorme(Math.min(20, total - s));
    if ((await destino.urgente().catch(() => null))?.id) break;
  }
  if (process.env.UM_DOCUMENTO) break;
}
E = novoEstado();
E.atual = { agente: 'Diretor', id: 'diretor', acao: 'troca de turno', texto: '', pensando: true, inicio: agora() };
await publica();
log(`turno encerrado: ${feitos} documento(s)`);
