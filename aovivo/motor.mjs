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
// A bancada só para em três casos: a cota gratuita do dia acabou, o Diretor está
// montando a pauta do dia (madrugada), ou o administrador pediu algo para hoje.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gerar, liberaCotas } from '../src/llm.mjs';
import { pesquisar, empresasCitadas, veiculosCitados } from '../src/pesquisa.mjs';
import { numerosSemFonte, semTravessao } from '../src/fiscal.mjs';
import { paraLinkedin } from '../src/linkedin.mjs';
import { parecido } from '../src/memoria.mjs';
import { separa } from '../src/vault.mjs';
import { lerEquipe } from '../bancada/equipe.mjs';
import { destinoPadrao } from './destino.mjs';

const RAIZ = join(import.meta.dirname, '..');
// data e hora em São Paulo, sem importar o publicar.mjs, que arrastaria o comitê
// junto para o repositório público do motor
const hoje = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const horaSP = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date())) % 24;
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
const LIMITE_POST = 2800;

const dorme = (s) => new Promise((ok) => setTimeout(ok, s * 1000 * FATOR));
const agora = () => new Date().toISOString();
const respiro = () => RESPIROS[Math.floor(Math.random() * RESPIROS.length)];
const log = (m) => console.log(`${agora().slice(11, 19)} ${m}`);

const destino = await destinoPadrao(RAIZ);

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
    recentes.length ? `\nTemas dos últimos documentos, NÃO repita nem chegue perto:\n${recentes.map((r) => `- ${r}`).join('\n')}` : '',
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

function blocoFontes(fontes, comTexto) {
  return fontes.map((f) => `[${f.id}] ${f.titulo} (${f.dominio}, ${f.tipo}${f.data ? `, ${String(f.data).slice(0, 10)}` : ''})${comTexto ? `\n${f.texto.slice(0, 1400)}` : ''}`).join('\n\n');
}

async function umDocumento({ pedido = null } = {}) {
  const qualidade = !!pedido;
  const recentes = pedido ? [] : await destino.temasRecentes();
  const numeroPrevisto = pedido ? 0 : await destino.proximoNumero();
  const area = pedido ? { nome: 'Pedido do administrador' } : AREAS[numeroPrevisto % AREAS.length];
  const recusados = [];
  let tema; let fontes = []; let apuracao = '';

  // o Diretor propõe, o Pesquisador confere se há fonte; até três tentativas
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    tema = pedido ? await temaDoPedido(pedido, tentativa) : await escolheTema(area, recentes, recusados);
    if (tema.repetido) { recusados.push(tema.tema); continue; }
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
      await escreve(A.pesquisador, 'recusou o tema', 'Tirando as fontes fora do tema, sobraram menos de três. Diretor, outro recorte.');
      recusados.push(tema.tema);
      apuracao = '';
      continue;
    }
    break;
  }
  if (!apuracao || /^\W*N[ÃA]O SUSTENTA/i.test(apuracao)) {
    await escreve(A.diretor, 'pausa', pedido ? 'Três buscas sem fonte suficiente para o pedido. Aviso o administrador.' : 'Três temas sem fonte suficiente. Pausa curta e recomeço com outro recorte.');
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
      empresas: empresasCitadas(texto),
      veiculos: veiculosCitados(texto, fontes),
      numeros: numerosSemFonte(texto, fontesTexto).map((n) => n.numero),
      codigos: [...new Set([...texto.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]).filter((id) => !validos.has(id)))],
      usadas: usadas.length,
      tamanho: post.length,
    };
  };
  const problemas = (x) => [
    ...(x.empresas.length ? [`Empresa citada pelo nome, proibido: ${x.empresas.join(', ')}. Descreva em vez de nomear.`] : []),
    ...(x.veiculos.length ? [`Veículo de imprensa citado pelo nome no texto: ${x.veiculos.join(', ')}. Tire o nome; a referência numerada já mostra de onde veio.`] : []),
    ...(x.numeros.length ? [`Número que não aparece em nenhuma fonte: ${x.numeros.join(', ')}. Corte ou troque pelo número exato da fonte.`] : []),
    ...(x.codigos.length ? [`Código de fonte que não existe: ${x.codigos.join(', ')}.`] : []),
    ...(x.usadas < 3 ? [`O post cita só ${x.usadas} fonte(s). Use pelo menos três fontes diferentes da lista, cada uma pelo código.`] : []),
    ...(x.tamanho > LIMITE_POST ? [`O post tem ${x.tamanho} caracteres e o limite é ${LIMITE_POST - 200}. Encurte sem perder as fontes.`] : []),
  ];

  let f = confere(doc);
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
  const parecer = await chama(A.auditor, ['## Fontes', blocoFontes(fontes, true), '', '## O post', doc].join('\n'));
  await escreve(A.auditor, 'parecer', parecer);

  if (/CORRIGIR\s*\**\s*$/i.test(parecer.trim()) || /\*\*CORRIGIR\*\*/.test(parecer)) {
    await pensa(A.diretor, 'aplicando o parecer do Auditor');
    doc = await chama(A.diretor, ['Aplique as correções do Auditor. Mantenha todas as regras: sem empresa pelo nome, sem veículo pelo nome, só números das fontes, pelo menos três fontes pelo código, no máximo 2.600 caracteres.', '', '## Parecer', parecer, '', '## Fontes', listaFontes, '', '## O post', doc].join('\n'));
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
    return { falhou: `barrado pelo fiscal: ${problemas(f).join(' ')}` };
  }

  await pensa(A.designer, 'pensando na imagem');
  const imagem = await chama(A.designer, `Post:\n${doc.slice(0, 2600)}`);
  await escreve(A.designer, 'imagem', imagem);

  return montaDocumento({ tema, area, doc, fontes, imagem, pedido });
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
    img, '',
  ].join('\n');
  const id = `${pedido ? 'p' : ''}${data}-${String(numero).padStart(4, '0')}`;
  const pronto = { id, numero, titulo, tema: tema.tema, categoria: area.nome, data, post, comentario, imagem: img, texto, markdown: texto, alertas: [], pedido: pedido?.id || null };
  if (pedido) await destino.documentoPrivado(pronto);
  else await destino.documento(pronto);
  await escreve(A.diretor, 'publicou', `${pedido ? 'Pedido' : 'Documento'} ${numero}: ${titulo}\n\n${post}`);
  return pronto;
}

/* ---------- pedidos do administrador ---------- */
function madrugada() { const h = horaSP(); return h >= 1 && h < 5; }

// O próximo pedido a fazer agora: o urgente sempre; os de "pode esperar" só de
// madrugada, depois que o Diretor fechou a pauta do dia (ou a partir das 4h, se o
// comitê não rodou, para a fila não travar).
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
  if (!madrugada()) return null;
  const d = await destino.diretor().catch(() => null);
  if (d?.pautaDoDia === hoje() || horaSP() >= 4) return fila[0] || null;
  return null;
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
  await publica();
  // a espera entre documentos também para na hora se chegar pedido urgente
  for (let s = 0, total = 40 + Math.random() * 40; s < total; s += 20) {
    await dorme(Math.min(20, total - s));
    if ((await destino.urgente().catch(() => null))?.id) break;
  }
  if (process.env.UM_DOCUMENTO) break;
}
E = novoEstado();
E.atual = { agente: 'Diretor', id: 'diretor', acao: 'troca de turno', texto: '', pensando: true, inicio: agora() };
await publica();
log(`turno encerrado: ${feitos} documento(s)`);
