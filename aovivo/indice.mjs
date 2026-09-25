// O índice dos documentos publicados: um documento só, com a lista enxuta.
//
// Por que existe, achado em 24/09 com a taxa de erro da Vercel em 10,9%: a lista
// pública lia os 300 documentos INTEIROS para montar uma lista de títulos.
//
//   const lista = (await db.listaPorNumero('documentos', 300)).map(...)
//
// Cada documento guarda o texto do post, o comentário, o prompt da imagem, e até
// então guardava tudo isso DUAS vezes (em "texto" e em "markdown", idênticos).
// Com 180 documentos isso dá uns 2 MB de JSON para abrir dentro de uma função de
// borda, que tem memória curta. E cresce todo dia: na semana passada eram 120 e
// não dava erro, que é a cara de um problema que aparece "do nada".
//
// A divisão certa de trabalho: quem tem memória (o motor, no Node do Actions)
// monta o índice; quem não tem (a função de borda) lê um documento só.
//   antes: 180 leituras e ~2 MB por chamada
//   agora:   1 leitura e ~30 KB

/* O teto. Cada entrada dá uns 150 bytes, e o limite do Firestore é 1 MiB por
   documento. Mil e quinhentas entradas ficam em ~220 KB, com folga de sobra, e
   a ~29 documentos por dia isso é mais de um ano. Passando disso, os mais
   antigos saem do índice (os documentos em si continuam lá, inteiros). */
export const TETO = 1500;

/* A versão do FORMATO da entrada. Suba quando mudar o que uma entrada guarda ou
   como ela é limpa: o motor remonta o índice do zero ao ver versão diferente, e
   assim uma correção alcança também os documentos já indexados. Sem isto, o
   conserto do título de 25/09 valeria só para os documentos novos e os 181
   antigos continuariam torto na lista para sempre. */
export const VERSAO = 2;

import { tituloLimpo } from '../src/fiscal.mjs';

// Só o que a lista precisa para desenhar uma linha. Nada de texto.
export const entrada = (doc) => ({
  id: doc.id,
  numero: doc.numero,
  titulo: tituloLimpo(doc.titulo),
  tema: doc.tema,
  categoria: doc.categoria,
  data: doc.data,
  alertas: doc.alertas || [],
});

/* Acrescenta um documento ao índice, do mais novo para o mais antigo, que é a
   ordem em que a lista é lida. Republicar o mesmo id substitui em vez de
   duplicar: o motor pode repetir a gravação num turno que reiniciou. */
export function acrescenta(indice, doc, teto = TETO) {
  const nova = entrada(doc);
  const resto = (indice?.itens || []).filter((x) => x.id !== nova.id);
  return { versao: VERSAO, itens: [nova, ...resto].sort((a, b) => b.numero - a.numero).slice(0, teto) };
}

// O índice inteiro a partir dos documentos crus, para a primeira montagem e para
// o conserto quando ele sumir.
export const monta = (documentos, teto = TETO) => ({
  versao: VERSAO,
  itens: (documentos || []).filter((d) => d?.id && d?.numero).map(entrada).sort((a, b) => b.numero - a.numero).slice(0, teto),
});
