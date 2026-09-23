// A pauta da semana. Domingo de manhã, antes de a bancada voltar, o cabeça de
// cada tema deixa temas prontos para a semana que começa.
//
// Por que isto existe: até 27/09 o tema de cada documento nascia no instante de
// escrever. O Diretor recebia a área da vez e a lista do que não podia repetir,
// e tinha que inventar ali, entre uma etapa e outra. Era a escolha mais apressada
// do dia, e o diário mostra onde isso doía: "repetido" e "sem_fonte" são as duas
// recusas mais comuns da semana, e as duas nascem da mesma pressa.
//
// A fila NÃO é obrigação. Fila vazia, fila acabada, ou tema que ficou parecido
// com algo publicado no meio da semana: em todos esses casos o Diretor escolhe
// na hora, como sempre fez. Ela é vantagem, não dependência — senão um domingo
// que falhe deixaria a semana inteira sem bancada.
import { parecido } from '../src/memoria.mjs';

// Quantos temas cada cabeça deixa pronto. Seis é cerca de um dia de trabalho da
// área: o suficiente para a semana começar pensada, pouco o bastante para não
// encher a semana de tema envelhecido no domingo.
export const POR_AREA = 6;

export const SCHEMA_PAUTAS = {
  type: 'OBJECT',
  properties: {
    pautas: {
      type: 'ARRAY',
      description: `No máximo ${POR_AREA} temas. Menos e bons é melhor que encher a lista.`,
      items: {
        type: 'OBJECT',
        properties: {
          tema: { type: 'STRING', description: 'O tema em uma frase que alguém entende sem contexto. Sem nome de empresa.' },
          porque: { type: 'STRING', description: 'Duas frases: por que este tema importa agora para quem trabalha.' },
          consulta_pt: { type: 'STRING', description: 'De 2 a 4 palavras amplas em português, sem país, ano ou nome próprio.' },
          consulta_en: { type: 'STRING', description: 'De 2 a 4 palavras amplas em inglês, sem país, ano ou nome próprio.' },
        },
        required: ['tema', 'porque', 'consulta_pt', 'consulta_en'],
      },
    },
  },
  required: ['pautas'],
};

/* ---------- a busca ----------
   A regra da busca ampla está no prompt desde o começo e o modelo escorrega nela
   toda semana: volta com ano, com país, com nome próprio. Busca estreita volta
   vazia, e o tema morre em "sem_fonte" na quarta-feira sem ninguém entender por
   quê — longe da causa, que foi um domingo de manhã.

   Aqui o conserto vem antes do descarte: ano e país saem da consulta por código,
   e só cai o item cuja busca não sobreviver à limpeza com duas palavras. Perder
   um tema bom por causa de uma palavra consertável seria trocar um defeito por
   outro. */
const ANO = /\b(19|20)\d{2}\b/g;
const LUGARES = /\b(no brasil|do brasil|brasil|brazil|brasileiros?|brasileiras?|eua|usa|estados unidos|china|chin[eê]s(?:a|es|as)?|europa|europeu|europeia|[ií]ndia|jap[ãa]o|reino unido|am[ée]rica latina|latam|global|mundial)\b/gi;

export function limpaConsulta(q) {
  const limpa = String(q || '').replace(ANO, ' ').replace(LUGARES, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const palavras = limpa.split(' ').filter(Boolean);
  if (palavras.length < 2) return null;
  return palavras.slice(0, 4).join(' ');
}

/* ---------- a trava ----------
   Mesmo limiar do escolheTema (0.45), pelo mesmo motivo: é o número que a casa já
   usa para dizer que dois temas são o mesmo tema. A diferença é o que entra na
   comparação. Aqui um item recém-aceito também barra o próximo, porque cinco
   cabeças montando pauta no mesmo domingo chegam em "IA no trabalho" por cinco
   caminhos diferentes, e na segunda-feira isso vira cinco documentos iguais. */
export const LIMIAR = 0.45;

/* O parecido() da casa compara palavras inteiras e não sabe de plural: medido em
   27/09, "detecção de fraudes em pagamentos digitais" contra "detecção de fraude
   em pagamento digital" dá 0.143 e passa limpo por uma trava de 0.45. São o mesmo
   post.

   O conserto mora aqui e não no parecido() porque aquele número sustenta também a
   trava de eco da mesa, calibrada em 0.18 contra textos escritos à mão: tirar o
   plural sobe TODAS as notas e passaria a calar contribuição de verdade. Aqui o
   risco não existe, e o estrago do buraco é maior: a fila é montada uma vez no
   domingo e um item repetido só cobra a vaga na quinta-feira.

   Cru de propósito, como o original: tira o "s" do fim de palavra com mais de
   quatro letras. Com isso o par acima vai de 0.143 para 0.600. */
const semPlural = (t) => String(t).replace(/(\p{L}{4,})s\b/gu, '$1');
export const parecidoNaFila = (a, b) => parecido(semPlural(a), semPlural(b));

export function filtraPautas(itens, { recentes = [], jaAceitos = [], area = '', bancada = '', cabeca = '' } = {}) {
  const passaram = []; const caidas = [];
  const comparar = [...recentes, ...jaAceitos.map((x) => x.tema)];
  for (const i of itens || []) {
    const tema = String(i.tema || '').trim();
    if (tema.length < 15) { caidas.push({ ...i, motivo: 'tema vazio ou curto demais' }); continue; }

    const repetido = comparar.find((r) => parecidoNaFila(r, tema) >= LIMIAR);
    if (repetido) { caidas.push({ ...i, motivo: `parecido demais com "${repetido}"` }); continue; }

    const pt = limpaConsulta(i.consulta_pt);
    const en = limpaConsulta(i.consulta_en);
    if (!pt || !en) { caidas.push({ ...i, motivo: 'a busca não sobrou com duas palavras depois de tirar ano e país' }); continue; }

    if (passaram.length >= POR_AREA) { caidas.push({ ...i, motivo: `passou de ${POR_AREA} temas na área` }); continue; }

    passaram.push({
      id: `${bancada || 'area'}-${passaram.length + 1}`,
      area, bancada, cabeca,
      tema,
      porque: String(i.porque || '').trim(),
      consulta_pt: pt, consulta_en: en,
      usado: false,
    });
    comparar.push(tema);
  }
  return { passaram, caidas };
}

/* ---------- o que a semana consome ---------- */

/* O domingo que abre a semana, que é o nome da fila: no próprio domingo é hoje,
   de segunda a sexta é o domingo que acabou de passar. Função pura porque a
   conta é a parte que erra calada: uma fila com o nome errado não estoura, ela
   só devolve vazio, e a semana inteira passa escolhendo tema na hora sem
   ninguém entender por quê. Meio-dia UTC para subtrair dia sem esbarrar em
   fuso. */
export function domingoDaSemana(hoje, dia) {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

// O próximo tema pronto desta área. Null quando a fila acabou, e aí a segunda
// -feira funciona como funcionava antes de existir fila.
export function proximaPauta(fila, area) {
  return (fila?.itens || []).find((i) => i.area === area && !i.usado) || null;
}

// Marcado ANTES de virar documento, de propósito: um turno que morra no meio
// perde um tema, e isso é barato. A ordem contrária devolveria o mesmo tema a
// cada turno que falhasse no mesmo ponto, para sempre.
export function marcaUsada(fila, id, quando = new Date().toISOString()) {
  const i = (fila?.itens || []).find((x) => x.id === id);
  if (i) { i.usado = true; i.quando_usado = quando; }
  return fila;
}

export const quantoSobrou = (fila, area) => (fila?.itens || []).filter((i) => i.area === area && !i.usado).length;

/* ---------- o que o domingo lê ----------
   Os temas que a bancada quis escrever na semana e não conseguiu, já separados
   pela reunião de sábado como "vale outra tentativa". É o que liga as duas
   pontas do fim de semana: sem isto o backlog de sábado ficava parado no /admin/
   esperando alguém lembrar dele. */
export function backlogDaArea(reuniao, area) {
  return (reuniao?.backlog || []).filter((b) => b.area === area);
}
