/* O post como o LinkedIn entende. Ele não lê markdown: negrito vira asterisco na
   tela e título vira cerquilha. O código tira a marcação e troca [f2] por (1), (2),
   na ordem em que as fontes aparecem no texto; os links vão no primeiro comentário. */
export function paraLinkedin(doc, fontes) {
  const semTitulo = String(doc).replace(/^\s*#\s+.+\n?/, '').trim()
    // "[f2, f5]" vira "[f2][f5]": agrupado, o código escapava da troca e aparecia
    // cru no post (visto no teste de 20/09)
    .replace(/\[\s*(f\d+(?:\s*[,;/e]+\s*f\d+)+)\s*\]/g, (m, g) => (g.match(/f\d+/g) || []).map((x) => `[${x}]`).join(''));
  const usadas = [...new Set([...semTitulo.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]))].filter((id) => fontes.some((f) => f.id === id));
  const post = semTitulo
    .replace(/\[(f\d+)\]/g, (m, id) => (usadas.includes(id) ? `(${usadas.indexOf(id) + 1})` : ''))
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    // lista colada no parágrafo de cima (ou de baixo) fica embolada no feed; entre
    // os itens, uma quebra só
    .replace(/([^\n])\n(?=• )/g, '$1\n\n')
    .replace(/(• [^\n]+)\n\n(?=• )/g, '$1\n')
    .replace(/(• [^\n]+)\n(?=[^•\n])/g, '$1\n\n')
    // a linha de hashtags fica separada do fecho
    .replace(/([^\n])\n(?=#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*\s*$)/u, '$1\n\n')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .replace(/ +([.,;:])/g, '$1')
    // tipografia: em português é "90%", e o hífen inseparável (U+2011) que o modelo
    // gosta de usar quebra a busca do LinkedIn e às vezes vira quadradinho
    .replace(/(\d)[   ]+%/g, '$1%')
    .replace(/[‐‑]/g, '-')
    .replace(/[  ]/g, ' ')
    .trim();
  return { post, usadas };
}
