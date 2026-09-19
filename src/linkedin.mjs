/* O post como o LinkedIn entende. Ele não lê markdown: negrito vira asterisco na
   tela e título vira cerquilha. O código tira a marcação e troca [f2] por (1), (2),
   na ordem em que as fontes aparecem no texto; os links vão no primeiro comentário. */
export function paraLinkedin(doc, fontes) {
  const semTitulo = String(doc).replace(/^\s*#\s+.+\n?/, '').trim();
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
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .replace(/ +([.,;:])/g, '$1')
    .trim();
  return { post, usadas };
}
