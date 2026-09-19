// O trabalho ao vivo. Roda por um turno (50 minutos por padrão) e para; a agenda
// chama o próximo turno, e assim a bancada nunca fica vazia.
//
// Cada passo é publicado no instante em que acontece, com a hora de início e a
// velocidade da escrita. Quem abre o site no meio vê o texto no ponto exato em
// que ele está, porque a tela calcula quanto já foi "digitado" pelo relógio.
// O motor espera a escrita terminar antes do passo seguinte: é isso que faz o
// ritmo ser de gente trabalhando, e não de máquina despejando texto.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gerar } from '../src/llm.mjs';
import { pesquisar, empresasCitadas, veiculosCitados } from '../src/pesquisa.mjs';
import { numerosSemFonte, semTravessao } from '../src/fiscal.mjs';
import { parecido } from '../src/memoria.mjs';
import { lerEquipe } from '../bancada/equipe.mjs';
import { destinoPadrao } from './destino.mjs';

const RAIZ = join(import.meta.dirname, '..');
// data em São Paulo, sem importar o publicar.mjs, que arrastaria o comitê junto
// para o repositório público do motor
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

const dorme = (s) => new Promise((ok) => setTimeout(ok, s * 1000 * FATOR));
const agora = () => new Date().toISOString();
const respiro = () => RESPIROS[Math.floor(Math.random() * RESPIROS.length)];

const destino = await destinoPadrao(RAIZ);
const { equipe, diretor } = await lerEquipe(join(RAIZ, 'aovivo', 'equipe'));
const A = Object.fromEntries([...equipe, diretor].map((a) => [a.id, a]));

const E = { turno: { inicio: agora(), fim_previsto: new Date(Date.now() + DURACAO_MIN * 60000).toISOString() }, atual: null, trilha: [], peca: null, cps: CPS };
const publica = () => { E.atualizado = agora(); return destino.estado(E); };
const log = (m) => console.log(`${agora().slice(11, 19)} ${m}`);

// alguém pensando: a tela mostra o agente concentrado, sem texto ainda
async function pensa(agente, acao) {
  E.atual = { agente: agente.nome, id: agente.id, acao, texto: '', pensando: true, inicio: agora() };
  await publica();
  log(`${agente.nome}: ${acao}…`);
}

// alguém escrevendo: publica o texto inteiro com a hora de início, e espera o
// tempo que a escrita leva na tela antes de seguir
async function escreve(agente, acao, bruto) {
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

async function escolheTema(recentes, recusados) {
  await pensa(A.diretor, 'escolhendo o tema');
  const hojeBr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const t = await chama(A.diretor, [
    `Hoje é ${hojeBr}. Escolha o tema do próximo documento. Tecnologia ou inteligência artificial, sem nome de empresa, com chance real de ter fonte pública e confiável.`,
    '',
    'As buscas: de 2 a 4 palavras, amplas, SEM país, SEM ano e SEM nome próprio. Busca estreita volta vazia e o tema é recusado por falta de fonte. Deixe o tema amplo também: o recorte (Brasil, um setor) só entra no texto se as fontes o cobrirem. Exemplo bom: "consumo energia data centers" / "data center energy use". Exemplo ruim: "demanda profissionais IA Brasil 2024".',
    recentes.length ? `\nTemas dos últimos documentos, NÃO repita nem chegue perto:\n${recentes.map((r) => `- ${r}`).join('\n')}` : '',
    recusados.length ? `\nTemas que o Pesquisador acabou de recusar por falta de fonte:\n${recusados.map((r) => `- ${r}`).join('\n')}` : '',
  ].join('\n'), SCHEMA_TEMA);
  // repetição conferida por código: o modelo esquece a lista que acabou de ler
  const repetido = recentes.find((r) => parecido(r, t.tema) >= 0.45);
  if (repetido) { log(`tema parecido com "${repetido}", pedindo outro`); return { ...t, repetido }; }
  await escreve(A.diretor, 'escolheu o tema', `${t.tema}\n\n${t.porque}`);
  return t;
}

function blocoFontes(fontes, comTexto) {
  return fontes.map((f) => `[${f.id}] ${f.titulo} (${f.dominio}, ${f.tipo}${f.data ? `, ${String(f.data).slice(0, 10)}` : ''})${comTexto ? `\n${f.texto.slice(0, 1400)}` : ''}`).join('\n\n');
}

async function umDocumento() {
  const recentes = await destino.temasRecentes();
  const recusados = [];
  let tema; let fontes = []; let apuracao = '';

  // o Diretor propõe, o Pesquisador confere se há fonte; até três tentativas
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    tema = await escolheTema(recentes, recusados);
    if (tema.repetido) { recusados.push(tema.tema); continue; }
    E.peca = { tema: tema.tema, fontes: [] };

    await pensa(A.pesquisador, 'buscando fontes em notícias e artigos');
    const p = await pesquisar({ pt: tema.consulta_pt, en: tema.consulta_en }, { maxFontes: 6, log });
    fontes = p.fontes;
    E.peca.fontes = fontes.map((f) => ({ id: f.id, titulo: f.titulo, url: f.url, dominio: f.dominio, tipo: f.tipo }));
    const r = p.recusadas;
    await escreve(A.pesquisador, 'separou as fontes', [
      `${fontes.length} fontes confiáveis abertas e lidas. Descartadas: ${r.naoConfiavel} fora da lista confiável, ${r.naoAbriu} que não abriram, ${r.semTexto} sem texto.`,
      '', ...fontes.map((f) => `[${f.id}] ${f.dominio}: ${f.titulo}`),
    ].join('\n'));

    if (fontes.length < 3) {
      await escreve(A.pesquisador, 'recusou o tema', 'Menos de três fontes confiáveis. Não dá para sustentar um documento com isso. Diretor, outro tema.');
      recusados.push(tema.tema);
      continue;
    }

    await pensa(A.pesquisador, `lendo ${fontes.length} fontes`);
    apuracao = await chama(A.pesquisador, [`Tema: ${tema.tema}`, '', '## Fontes (use só estas, pelo código)', blocoFontes(fontes, true)].join('\n'));
    if (/^\W*N[ÃA]O SUSTENTA/i.test(apuracao)) {
      await escreve(A.pesquisador, 'recusou o tema', apuracao);
      recusados.push(tema.tema);
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
      await escreve(A.pesquisador, 'recusou o tema', 'Tirando as fontes fora do tema, sobraram menos de três. Diretor, outro tema.');
      recusados.push(tema.tema);
      apuracao = '';
      continue;
    }
    break;
  }
  if (!apuracao || /^\W*N[ÃA]O SUSTENTA/i.test(apuracao)) {
    await escreve(A.diretor, 'pausa', 'Três temas sem fonte suficiente. Pausa curta e recomeço com outro recorte.');
    return null;
  }

  const fontesTexto = fontes.map((f) => `${f.titulo}\n${f.texto}`).join('\n\n');
  const listaFontes = blocoFontes(fontes, false);

  await pensa(A.diretor, 'escrevendo o documento');
  let doc = await chama(A.diretor, [
    `Tema: ${tema.tema}`, '', '## A apuração do Pesquisador', apuracao, '', '## As fontes', listaFontes, '',
    'Escreva o documento. Comece pelo título numa linha com #. Cite as fontes pelo código entre colchetes, como [f2], logo depois da informação que veio dela.',
    '',
    'Se as fontes não cobrem um recorte do tema (um país, um setor), NÃO recuse: ajuste o recorte do texto ao que as fontes cobrem e diga isso em uma frase. Você escreve um documento, nunca uma mensagem pedindo mais fontes.',
  ].join('\n'));

  // Recusa ou texto curto demais não é documento. No segundo teste uma recusa do
  // Diretor ("não é possível elaborar") passou pelo Auditor, ganhou capa e foi
  // publicada como documento 2.
  if (doc.length < 1200 || /n[ãa]o (é|e) poss[íi]vel (elaborar|escrever|produzir)|n[ãa]o h[áa] como|envie|envi[áa]-las|forne[çc]a (mais|outras)/i.test(doc.slice(0, 600))) {
    await escreve(A.diretor, 'desistiu do tema', 'As fontes não sustentam um documento inteiro sobre isso. Troco de tema.');
    return null;
  }
  await escreve(A.diretor, 'escreveu o documento', doc);

  /* o fiscal por código, e uma revisão se ele achar algo */
  const confere = (texto) => {
    const validos = new Set(fontes.map((f) => f.id));
    return {
      empresas: empresasCitadas(texto),
      veiculos: veiculosCitados(texto, fontes),
      numeros: numerosSemFonte(texto, fontesTexto).map((n) => n.numero),
      codigos: [...new Set([...texto.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]).filter((id) => !validos.has(id)))],
    };
  };
  let f = confere(doc);
  const problemas = (x) => [
    ...(x.empresas.length ? [`Empresa citada pelo nome, proibido: ${x.empresas.join(', ')}. Descreva em vez de nomear.`] : []),
    ...(x.veiculos.length ? [`Veículo de imprensa citado pelo nome no texto: ${x.veiculos.join(', ')}. Tire o nome; a referência numerada já mostra de onde veio.`] : []),
    ...(x.numeros.length ? [`Número que não aparece em nenhuma fonte: ${x.numeros.join(', ')}. Corte ou troque pelo número exato da fonte.`] : []),
    ...(x.codigos.length ? [`Código de fonte que não existe: ${x.codigos.join(', ')}.`] : []),
  ];

  if (problemas(f).length) {
    await escreve({ nome: 'Fiscal', id: 'fiscal' }, 'conferiu por código', problemas(f).map((p) => `- ${p}`).join('\n'));
    await pensa(A.diretor, 'corrigindo o que o fiscal apontou');
    doc = await chama(A.diretor, ['Reescreva o documento corrigindo exatamente isto, e mais nada:', ...problemas(f).map((p) => `- ${p}`), '', '## Fontes', listaFontes, '', '## O documento', doc].join('\n'));
    await escreve(A.diretor, 'corrigiu', doc);
    f = confere(doc);
  }

  await pensa(A.auditor, 'conferindo com as fontes do lado');
  const parecer = await chama(A.auditor, ['## Fontes', blocoFontes(fontes, true), '', '## O documento', doc].join('\n'));
  await escreve(A.auditor, 'parecer', parecer);

  if (/CORRIGIR\s*\**\s*$/i.test(parecer.trim()) || /\*\*CORRIGIR\*\*/.test(parecer)) {
    await pensa(A.diretor, 'aplicando o parecer do Auditor');
    doc = await chama(A.diretor, ['Aplique as correções do Auditor. Mantenha todas as regras: sem empresa pelo nome, só números das fontes, fontes pelo código.', '', '## Parecer', parecer, '', '## Fontes', listaFontes, '', '## O documento', doc].join('\n'));
    await escreve(A.diretor, 'versão final', doc);
    f = confere(doc);
  }

  await pensa(A.designer, 'pensando na capa');
  const capa = await chama(A.designer, `Documento:\n${doc.slice(0, 2500)}`);
  await escreve(A.designer, 'capa', capa);

  return montaDocumento({ tema, doc, fontes, capa, parecer, fiscal: f });
}

/* ---------- o documento publicado ----------
   [f2] no texto vira o número da referência com link, e a lista de referências
   no fim é montada pelo código a partir da pesquisa: o modelo não escreve URL. */
async function montaDocumento({ tema, doc: bruto, fontes, capa, fiscal }) {
  const doc = semTravessao(bruto);
  const numero = await destino.proximoNumero();
  const usadas = [...new Set([...doc.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]))].filter((id) => fontes.some((f) => f.id === id));
  const n = (id) => usadas.indexOf(id) + 1;
  const corpo = doc.replace(/\[(f\d+)\]/g, (m, id) => { const x = fontes.find((f) => f.id === id); return x ? `[[${n(id)}]](${x.url})` : ''; });
  const titulo = (corpo.match(/^#\s+(.+)$/m) || [, tema.tema])[1].trim();
  const alertas = [
    ...(fiscal.empresas.length ? [`empresa citada: ${fiscal.empresas.join(', ')}`] : []),
    ...(fiscal.veiculos?.length ? [`veículo citado: ${fiscal.veiculos.join(', ')}`] : []),
    ...(fiscal.numeros.length ? [`número sem fonte: ${fiscal.numeros.join(', ')}`] : []),
  ];
  const data = hoje();
  const markdown = [
    '---', `documento: ${numero}`, `data: ${data}`, `tema: "${tema.tema.replace(/"/g, "'")}"`, `fontes: ${usadas.length}`, `alertas: ${alertas.length}`, '---', '',
    ...(alertas.length ? [`> [!caution] Conferido por código depois da revisão: ${alertas.join('; ')}.`, ''] : []),
    corpo.trim(), '',
    '## Referências', '',
    ...usadas.map((id) => { const x = fontes.find((f) => f.id === id); return `${n(id)}. [${x.titulo}](${x.url}) (${x.dominio})`; }), '',
    '## Capa', '', capa.trim(), '',
  ].join('\n');
  const doc2 = { id: `${data}-${String(numero).padStart(4, '0')}`, numero, titulo, tema: tema.tema, data, markdown, alertas };
  await destino.documento(doc2);
  await escreve(A.diretor, 'publicou', `Documento ${numero}: ${titulo}`);
  return doc2;
}

/* ---------- o turno ---------- */
const fim = Date.now() + DURACAO_MIN * 60000;
log(`turno de ${DURACAO_MIN} min, ${CPS} letras/s, destino ${destino.nome}`);
let feitos = 0;
while (Date.now() < fim - 12 * 60000 * FATOR) {
  try {
    const d = await umDocumento();
    if (d) feitos++;
  } catch (e) {
    log(`erro no documento: ${e.message}`);
    await escreve(A.diretor, 'pausa', 'Um passo falhou. Pausa curta e recomeço.').catch(() => {});
  }
  E.trilha = [];
  E.peca = null;
  E.atual = { agente: 'Diretor', id: 'diretor', acao: 'pensando no próximo tema', texto: '', pensando: true, inicio: agora() };
  await publica();
  await dorme(40 + Math.random() * 40);
  if (process.env.UM_DOCUMENTO) break;
}
E.atual = { agente: 'Diretor', id: 'diretor', acao: 'troca de turno', texto: '', pensando: true, inicio: agora() };
await publica();
log(`turno encerrado: ${feitos} documento(s)`);
