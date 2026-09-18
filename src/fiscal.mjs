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
