// O que o sistema lembra de um dia para o outro. Sem isto, todo expediente
// recomeça do zero: o comitê repete pauta, o "falta apurar" de ontem morre na
// nota, e discordar do julgamento de um agente não muda nada.
//
// Tudo entra por markdown que você edita à mão. É o único motivo honesto de isto
// ser um vault Obsidian e não uma tabela: uma nota você corrige no sofá.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const MARCA_RECADO = '## Recado para a mesa';

// Datas excluídas da leitura. Preenchido por carregar(): a nota do próprio dia,
// numa segunda rodada, não pode contar como coisa já publicada.
let ignorar = new Set();

async function notasRecentes(raiz, pastas, limite) {
  const achados = [];
  for (const pasta of pastas) {
    const dir = join(raiz, pasta);
    const arquivos = (await readdir(dir).catch(() => []))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && !ignorar.has(f.slice(0, 10))).sort().reverse().slice(0, limite);
    for (const f of arquivos) {
      achados.push({ pasta, data: f.replace('.md', ''), texto: await readFile(join(dir, f), 'utf8').catch(() => '') });
    }
  }
  return achados.sort((a, b) => b.data.localeCompare(a.data));
}

function secao(texto, titulo) {
  const i = texto.indexOf(titulo);
  if (i < 0) return '';
  const resto = texto.slice(i + titulo.length);
  const fim = resto.search(/\n##\s|\n---\s*\n/);
  return (fim < 0 ? resto : resto.slice(0, fim)).trim();
}

// O que a nota em branco traz não é recado: a instrução em itálico e os exemplos
// comentados existem para você ler, não para o agente obedecer. Só o que você
// digitou por cima conta, e a regra é esta: fora comentário HTML e fora linha que
// é puro itálico, o resto é seu.
function limpaRecado(corpo) {
  return corpo
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*_.*_\s*$/.test(l))
    .join('\n')
    .trim();
}

// Extrai a seção de recado de uma nota já gravada. Usado na hora de reescrever a
// nota do dia: rodar duas vezes no mesmo dia não pode apagar o que você escreveu.
export function extraiRecado(texto) {
  return limpaRecado(secao(texto, MARCA_RECADO));
}

/* ---------- 1. o que você mandou dizer ---------- */
export async function lerRecados(raiz, diasDeNota = 7) {
  const porAgente = new Map();
  const todos = [];

  const guarda = (alvo, linha, origem) => {
    const limpo = linha.replace(/^[-*+]\s*/, '').trim();
    if (!limpo || limpo.startsWith('<!--')) return;
    const item = { texto: limpo, origem };
    if (!alvo || /^(todos|todas|mesa|geral|equipe)$/i.test(alvo)) todos.push(item);
    else {
      const chave = alvo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (!porAgente.has(chave)) porAgente.set(chave, []);
      porAgente.get(chave).push(item);
    }
  };

  // recados permanentes, organizados por "## Nome do agente"
  // Só vale o que está debaixo de um "## Nome". O preâmbulo do arquivo explica
  // como usar e não pode chegar ao agente como se fosse ordem.
  const bruto = await readFile(join(raiz, 'agentes', '_recados.md'), 'utf8').catch(() => '');
  const fixo = limpaRecado(bruto.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''));
  let alvoAtual;
  for (const linha of fixo.split(/\r?\n/)) {
    const cab = linha.match(/^##\s+(.+?)\s*$/);
    if (cab) { alvoAtual = cab[1]; continue; }
    if (alvoAtual === undefined || /^#\s/.test(linha) || /^---/.test(linha)) continue;
    if (linha.trim()) guarda(alvoAtual, linha, '_recados.md');
  }

  // recados escritos na nota do dia, onde você estava quando teve a opinião
  for (const nota of await notasRecentes(raiz, ['pauta', 'producao'], diasDeNota)) {
    const corpo = extraiRecado(nota.texto);
    if (!corpo) continue;
    let alvo = null;
    for (const linha of corpo.split(/\r?\n/)) {
      const cab = linha.match(/^###?\s+(.+?)\s*$/);
      if (cab) { alvo = cab[1]; continue; }
      // "Cético: não precisa de segunda fonte" também endereça
      const inline = linha.match(/^[-*+]?\s*([A-Za-zÀ-ÿ]{4,14}):\s+(.+)$/);
      if (inline) { guarda(inline[1], inline[2], nota.data); continue; }
      if (linha.trim()) guarda(alvo, linha, nota.data);
    }
  }

  return { porAgente, todos };
}

export function recadosDe(recados, agente) {
  const chave = String(agente.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const meus = recados.porAgente.get(chave) || recados.porAgente.get(agente.id) || [];
  return [...meus, ...recados.todos];
}

export function blocoRecados(lista) {
  if (!lista.length) return '';
  return ['', '## Recados do Rubens',
    'Ele escreveu isto lendo o trabalho de dias anteriores. Não é sugestão: é correção de rumo de quem responde pelo que sai publicado. Siga, e se discordar de algum, diga por quê no seu argumento em vez de ignorar em silêncio.',
    '',
    ...lista.map((r) => `- ${r.texto}  _(${r.origem})_`)].join('\n');
}

/* ---------- 2. o que já foi coberto ---------- */
// O editorial é o trecho antes do recado; depois dele vêm a ata e as divergências,
// que também usam ### e não são pautas. Número no título é opcional: o Editor
// numerou num dia e não no outro, e exigir o número apagava o histórico.
function editorialDe(texto) {
  const i = texto.indexOf(MARCA_RECADO);
  return i >= 0 ? texto.slice(0, i) : texto.split(/^## Divergências apuradas/m)[0];
}

export async function lerHistorico(raiz, dias = 21) {
  const pautas = [];
  for (const nota of await notasRecentes(raiz, ['pauta'], dias)) {
    for (const m of editorialDe(nota.texto).matchAll(/^###\s+(?:\d+\.\s*)?(.+?)\s*$/gm)) {
      pautas.push({ data: nota.data, titulo: m[1].trim() });
    }
  }
  return pautas;
}

// URLs que já sustentaram pauta publicada. É o sinal de repetição que não
// depende de o modelo escrever o título do mesmo jeito.
// Só entra o que foi citado DENTRO de uma pauta. A seção de fontes da nota também
// lista os descartados, e um descartado de hoje pode virar pauta legítima amanhã.
export async function lerFontesPublicadas(raiz, dias = 21) {
  const fontes = [];
  for (const nota of await notasRecentes(raiz, ['pauta'], dias)) {
    const i = nota.texto.indexOf('## Fontes dos itens citados');
    if (i < 0) continue;
    const urlDe = new Map();
    for (const m of nota.texto.slice(i).split(/\n---/)[0].matchAll(/`(n\d{2})`\s*\[[^\]]*\]\((https?:[^)\s]+)\)/g)) urlDe.set(m[1], m[2]);

    for (const bloco of blocosDePauta(editorialDe(nota.texto))) {
      for (const m of bloco.corpo.matchAll(/\[(n\d{2})\]/g)) {
        const url = urlDe.get(m[1]);
        if (url && !fontes.some((f) => f.url === url)) fontes.push({ data: nota.data, url });
      }
    }
  }
  return fontes;
}

// Cada ### do editorial até o próximo ### ou ##. Sem cortar no ##, a última pauta
// engoliria as seções de divergências e descartados que vêm depois dela.
function blocosDePauta(editorial) {
  return String(editorial).split(/^###\s+/m).slice(1).map((b) => {
    const corpo = b.split(/\n##\s/)[0];
    return { titulo: corpo.split('\n')[0].replace(/^\d+\.\s*/, '').trim(), corpo };
  });
}

export function blocoHistorico(pautas) {
  if (!pautas.length) return '';
  return ['', '## Pautas que esta coluna já publicou',
    'Repetir assunto recente queima a confiança de quem lê todo dia. Um desdobramento novo de algo daqui é válido, e nesse caso diga explicitamente o que mudou desde então. Recauchutagem não é.',
    '',
    ...pautas.slice(0, 40).map((p) => `- ${p.data}: ${p.titulo}`)].join('\n');
}

/* ---------- 3. o buraco de ontem ---------- */
export async function lerPendencias(raiz, dias = 14) {
  const abertas = [];
  for (const nota of await notasRecentes(raiz, ['pauta', 'producao'], dias)) {
    const blocos = nota.texto.split(/^###\s+/m).slice(1);
    for (const b of blocos) {
      const titulo = b.split('\n')[0].replace(/^\d+\.\s*/, '').trim();
      const m = b.match(/\*\*O que ainda falta apurar\*\*:?\s*([\s\S]*?)(?:\n\n|\n###|\n##|$)/);
      if (m && m[1].trim().length > 20) {
        const falta = m[1].trim().replace(/\s+/g, ' ');
        // a mesma pergunta carregada de um dia para o outro entra uma vez só,
        // com a data mais antiga: é há quanto tempo ela está sem resposta
        const ja = abertas.find((a) => parecido(a.falta, falta) >= 0.8);
        if (ja) { if (nota.data < ja.data) ja.data = nota.data; continue; }
        abertas.push({ data: nota.data, pauta: titulo, falta });
      }
    }
  }
  return abertas;
}

function palavras(s) {
  return new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((p) => p.length > 3));
}

// Jaccard sobre palavras de mais de três letras. Grosseiro de propósito: serve
// para pegar a mesma frase reescrita, não para julgar se dois assuntos se tocam.
export function parecido(a, b) {
  const A = palavras(a), B = palavras(b);
  if (!A.size || !B.size) return 0;
  let comum = 0;
  for (const p of A) if (B.has(p)) comum++;
  return comum / (A.size + B.size - comum);
}

/* ---------- 4. o fiscal da memória ---------- */
// Instrução o modelo finge seguir: no primeiro teste real ele disse "esta pauta
// responde à pergunta de ontem" e deixou a mesma pergunta, palavra por palavra,
// como pendência de novo. Então a verificação é feita aqui, por comparação, e o
// resultado vai para a nota como alerta, não como sugestão ao modelo.
export function alertasDeRepeticao(editorial, memoria, itens = []) {
  const alertas = [];
  const urlDe = new Map(itens.map((i) => [i.id, i.url]));

  for (const { titulo: t, corpo: b } of blocosDePauta(editorial)) {
    const titulo = t.length > 90 ? `${t.slice(0, 90).replace(/\s+\S*$/, '')}…` : t;

    const ids = [...b.matchAll(/\[(n\d{2})\]/g)].map((m) => m[1]);
    for (const id of new Set(ids)) {
      const url = urlDe.get(id);
      const antes = url && (memoria.fontesPublicadas || []).find((f) => f.url === url);
      if (antes) alertas.push(`"${titulo}" usa a mesma fonte [${id}] de uma pauta já publicada em ${antes.data}. É repetição, a menos que o texto traga fato novo.`);
    }

    const falta = (b.match(/\*\*O que ainda falta apurar\*\*:?\s*([\s\S]*?)(?:\n\n|\n\*\s|$)/) || [])[1];
    if (falta) {
      const igual = (memoria.pendencias || []).find((p) => parecido(p.falta, falta) >= 0.8);
      if (igual) alertas.push(`"${titulo}" deixa em aberto a mesma pergunta já pendente desde ${igual.data}. Se a pauta diz que responde a pendência, não respondeu.`);
    }
  }
  return [...new Set(alertas)];
}

export function blocoPendencias(lista) {
  if (!lista.length) return '';
  return ['', '## O que ficou em aberto nos dias anteriores',
    'Cada linha é uma pergunta que esta coluna levantou e não respondeu. Responder uma delas hoje vale mais que uma pauta nova, mas SÓ se um item do dossiê de hoje trouxer o fato que responde, e você tem que citar o id dele. Voltar ao assunto repetindo a mesma pergunta em aberto e chamar isso de continuidade é pior do que ignorar a pendência. O sistema compara e vai marcar.',
    '',
    ...lista.slice(0, 12).map((p) => `- (${p.data}, sobre "${p.pauta}") ${p.falta}`)].join('\n');
}

/* ---------- 5. o planejamento do Diretor ---------- */
// O de HOJE, escrito às 6h07. Ao contrário do resto da memória, não é excluído
// pela data do dia: é exatamente o dia de hoje que ele planeja.
export async function lerPlano(raiz, data) {
  const md = await readFile(join(raiz, 'planejamento', `${data}.md`), 'utf8').catch(() => '');
  const i = md.indexOf('## Onde olhar hoje');
  if (i < 0) return '';
  const fim = md.indexOf(MARCA_RECADO, i);
  return md.slice(i, fim > i ? fim : undefined).replace(/\n---\s*$/, '').trim();
}

export function blocoPlano(plano) {
  if (!plano) return '';
  return ['', '## O planejamento do Diretor para hoje',
    'Ele leu a semana antes de você chegar. É contexto, não ordem: se o dossiê de hoje trouxer algo mais forte que os temas dele, defenda o mais forte. Mas se uma pauta sua conversa com um tema dele, diga isso no argumento.',
    '', plano].join('\n');
}

/* ---------- tudo junto ---------- */
export async function carregar(raiz, { exceto = null } = {}) {
  ignorar = new Set(exceto ? [exceto] : []);
  const [recados, historico, pendencias, fontesPublicadas, plano] = await Promise.all([
    lerRecados(raiz), lerHistorico(raiz), lerPendencias(raiz), lerFontesPublicadas(raiz),
    exceto ? lerPlano(raiz, exceto) : '',
  ]);
  return { recados, historico, pendencias, fontesPublicadas, plano };
}
