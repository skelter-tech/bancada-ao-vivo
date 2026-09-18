// A pesquisa de verdade do trabalho ao vivo. O Pesquisador não inventa link: ele
// só pode citar o que esta rotina encontrou, abriu e leu.
//
// Três fontes gratuitas, sem chave: busca do Bing Notícias (RSS), o arXiv para
// artigo científico, e a leitura da própria página de cada resultado. Depois, a
// peneira: só passa o que abre (HTTP 200) e está num domínio confiável.
import { coletar } from './feeds.mjs';

const UA = 'Mozilla/5.0 (compatible; comite-pauta/1.0; +pesquisa de pauta)';

/* ---------- o que é fonte confiável ----------
   Lista fechada de propósito. Órgão público, universidade, periódico científico,
   agência de notícia e os veículos de tecnologia que o comitê já usa. Um domínio
   fora daqui não entra no texto, por melhor que pareça. */
const CONFIAVEIS = [
  // governo e organismos
  /\.gov(\.br)?$/, /\.leg\.br$/, /\.jus\.br$/, /(^|\.)ibge\.gov\.br$/, /(^|\.)europa\.eu$/, /(^|\.)oecd\.org$/, /(^|\.)un\.org$/, /(^|\.)who\.int$/, /(^|\.)worldbank\.org$/, /(^|\.)imf\.org$/, /(^|\.)itu\.int$/, /(^|\.)nist\.gov$/,
  // academia e ciência
  /\.edu(\.br)?$/, /(^|\.)usp\.br$/, /(^|\.)unicamp\.br$/, /(^|\.)ufrj\.br$/, /(^|\.)fgv\.br$/, /(^|\.)arxiv\.org$/, /(^|\.)nature\.com$/, /(^|\.)science\.org$/, /(^|\.)acm\.org$/, /(^|\.)ieee\.org$/, /(^|\.)springer\.com$/, /(^|\.)sciencedirect\.com$/, /(^|\.)pnas\.org$/, /(^|\.)cell\.com$/, /(^|\.)mit\.edu$/, /(^|\.)stanford\.edu$/,
  // agências e imprensa de referência
  /(^|\.)reuters\.com$/, /(^|\.)apnews\.com$/, /(^|\.)bbc\.(com|co\.uk)$/, /(^|\.)ft\.com$/, /(^|\.)economist\.com$/, /(^|\.)nytimes\.com$/, /(^|\.)theguardian\.com$/, /(^|\.)wsj\.com$/, /(^|\.)bloomberg\.com$/,
  /(^|\.)folha\.uol\.com\.br$/, /(^|\.)estadao\.com\.br$/, /(^|\.)valor\.globo\.com$/, /(^|\.)g1\.globo\.com$/, /(^|\.)oglobo\.globo\.com$/, /(^|\.)exame\.com$/, /(^|\.)agenciabrasil\.ebc\.com\.br$/, /(^|\.)nexojornal\.com\.br$/,
  /(^|\.)poder360\.com\.br$/, /(^|\.)correiobraziliense\.com\.br$/, /(^|\.)gazetadopovo\.com\.br$/, /(^|\.)istoedinheiro\.com\.br$/, /(^|\.)infomoney\.com\.br$/, /(^|\.)cnnbrasil\.com\.br$/, /(^|\.)neofeed\.com\.br$/, /(^|\.)epocanegocios\.globo\.com$/,
  /(^|\.)cnbc\.com$/, /(^|\.)axios\.com$/, /(^|\.)politico\.(com|eu)$/, /(^|\.)semafor\.com$/,
  // imprensa especializada em tecnologia e telecom
  /(^|\.)canaltech\.com\.br$/, /(^|\.)telesintese\.com\.br$/, /(^|\.)teletime\.com\.br$/, /(^|\.)convergenciadigital\.com\.br$/, /(^|\.)crn\.com$/, /(^|\.)trendforce\.com$/, /(^|\.)theregister\.com$/, /(^|\.)zdnet\.com$/, /(^|\.)venturebeat\.com$/, /(^|\.)datacenterdynamics\.com$/,
  // tecnologia, os mesmos veículos que o comitê lê
  /(^|\.)arstechnica\.com$/, /(^|\.)technologyreview\.com$/, /(^|\.)wired\.com$/, /(^|\.)theverge\.com$/, /(^|\.)techcrunch\.com$/, /(^|\.)infoq\.com$/, /(^|\.)ieee\.org$/, /(^|\.)simonwillison\.net$/,
];

export function dominio(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

export function confiavel(url) {
  const d = dominio(url);
  return !!d && CONFIAVEIS.some((re) => re.test(d));
}

/* ---------- nome de empresa ----------
   A regra do ao vivo: nenhuma empresa citada pelo nome. O modelo escorrega, então
   o texto final passa por esta lista. Não precisa ser completa: são os nomes que
   aparecem em 9 de cada 10 notícias de tecnologia e IA. */
// Fora da lista de propósito: Vale, Stone, Arm e Meta, que em português também
// são palavra comum ("Vale a pena", "Meta do trimestre") e gerariam alarme falso.
// A Meta aparece pelos produtos dela, que não têm esse problema.
const EMPRESAS = [
  'OpenAI', 'Anthropic', 'Google', 'Alphabet', 'DeepMind', 'Microsoft', 'Facebook', 'Instagram', 'WhatsApp', 'Apple', 'Amazon', 'AWS', 'Nvidia', 'NVIDIA', 'Intel', 'AMD', 'Qualcomm', 'Samsung', 'Huawei', 'Tesla', 'xAI', 'SpaceX', 'IBM', 'Oracle', 'Salesforce', 'Adobe', 'Netflix', 'Uber', 'Mistral', 'Cohere', 'Hugging Face', 'Perplexity', 'Stability AI', 'Midjourney', 'ByteDance', 'TikTok', 'Alibaba', 'Tencent', 'Baidu', 'DeepSeek', 'Moonshot', 'Groq', 'Cerebras', 'TSMC', 'ASML', 'Broadcom', 'Cisco', 'Dell', 'HP', 'Lenovo', 'Palantir', 'Snowflake', 'Databricks', 'GitHub', 'Crusoe', 'CoreWeave', 'Magazine Luiza', 'Mercado Livre', 'iFood', 'Nubank', 'Itaú', 'Bradesco', 'Petrobras', 'Ambev', 'Totvs', 'PicPay', 'ChatGPT', 'Gemini', 'Claude', 'Copilot', 'Llama', 'Grok',
];
const RE_EMPRESAS = new RegExp(`\\b(${EMPRESAS.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

export function empresasCitadas(texto) {
  const achadas = new Set();
  // links não contam: o domínio de uma fonte pode ter nome de empresa e isso é referência, não citação
  const semLinks = String(texto).replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '');
  for (const m of semLinks.matchAll(RE_EMPRESAS)) achadas.add(m[1]);
  return [...achadas];
}

/* ---------- busca ----------
   Bing Notícias em RSS, e não Google Notícias: o Google esconde o link real atrás
   de um redirecionamento que só se resolve por script, e no primeiro teste as 18
   notícias ficaram com endereço do Google e foram recusadas. O Bing traz o link
   real dentro do parâmetro url= do próprio link dele. */
function linkReal(url) {
  try {
    const u = new URL(url);
    if (/bing\.com$/.test(u.hostname) && u.searchParams.get('url')) return u.searchParams.get('url');
  } catch { /* segue com o original */ }
  return url;
}

async function buscaNoticias(consultas, dias = 30) {
  const fontes = [];
  if (consultas.pt) fontes.push({ nome: 'Bing Notícias pt', url: `https://www.bing.com/news/search?q=${encodeURIComponent(consultas.pt)}&format=rss&setlang=pt-BR&cc=BR` });
  if (consultas.en) fontes.push({ nome: 'Bing News en', url: `https://www.bing.com/news/search?q=${encodeURIComponent(consultas.en)}&format=rss&setlang=en-US&cc=US` });
  const { itens } = await coletar({ fontes, janelaHoras: dias * 24, maxItens: 40, maxPorFonte: 20 });
  return itens.map((i) => ({ tipo: 'notícia', titulo: i.titulo, url: linkReal(i.url), veiculo: i.veiculo, data: i.data?.toISOString?.() || null }));
}

async function buscaArxiv(consulta, max = 6) {
  // só as três palavras mais longas: exigir todas junto (inclusive "Brazil" e o
  // ano) zerava a busca no primeiro teste do ao vivo
  const chave = consulta.split(/\s+/).filter((w) => w.length > 3 && !/^\d+$/.test(w) && !/^(brazil|brasil)$/i.test(w))
    .sort((a, b) => b.length - a.length).slice(0, 3);
  if (!chave.length) return [];
  const q = encodeURIComponent(chave.map((w) => `all:${w}`).join(' AND '));
  try {
    const r = await fetch(`https://export.arxiv.org/api/query?search_query=${q}&sortBy=relevance&sortOrder=descending&max_results=${max}`, { headers: { 'user-agent': UA } });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const e = m[1];
      const pega = (t) => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
      return { tipo: 'artigo', titulo: pega('title'), url: pega('id').replace('http://', 'https://'), veiculo: 'arXiv', data: pega('published'), resumo: pega('summary').slice(0, 900) };
    });
  } catch { return []; }
}

// O Google Notícias entrega um endereço de redirecionamento dele. Seguir o
// redirecionamento é o que revela o veículo real, e é o domínio real que decide
// se a fonte é confiável.
async function abre(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    const html = r.ok ? await r.text() : '';
    let final = r.url;
    // o Google Notícias às vezes responde com uma página que redireciona por script
    const js = html.match(/data-n-au="([^"]+)"|window\.location\.replace\("([^"]+)"\)/);
    if (dominio(final) === 'news.google.com' && js) final = (js[1] || js[2]).replace(/\\u0026/g, '&');
    return { ok: r.ok, status: r.status, url: final, html };
  } catch (e) {
    return { ok: false, status: 0, url, html: '', erro: e.name };
  } finally { clearTimeout(t); }
}

function textoDaPagina(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>|<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/* Pesquisa um tema e devolve só o que sobreviveu à peneira: abriu, é de fonte
   confiável, e tem texto legível. Cada fonte recebe um id [f1], [f2]... que é o
   único jeito de o texto citá-la. */
// consultas: { pt: 'termo em português', en: 'term in english' }. O arXiv só
// entende inglês; as notícias vêm das duas línguas.
export async function pesquisar(consultas, { maxFontes = 8, log = () => {} } = {}) {
  const c = typeof consultas === 'string' ? { pt: consultas, en: consultas } : consultas;
  const [noticias, artigos] = await Promise.all([buscaNoticias(c), c.en ? buscaArxiv(c.en) : []]);
  log(`busca pt "${c.pt || ''}" / en "${c.en || ''}": ${noticias.length} notícias, ${artigos.length} artigos`);

  // pré-peneira pelo domínio que o link já mostra: não gasta tempo abrindo o que
  // seria recusado de qualquer jeito
  // intercala notícia e artigo, com no máximo 3 artigos: no primeiro teste o arXiv
  // ocupou 6 das 7 vagas e metade nem era do tema
  const confiaveis = noticias.filter((n) => confiavel(n.url));
  const candidatos = [];
  for (let i = 0; i < Math.max(confiaveis.length, 3); i++) {
    if (confiaveis[i]) candidatos.push(confiaveis[i]);
    if (i < 3 && artigos[i]) candidatos.push(artigos[i]);
  }
  const consulta = `${c.pt || ''} | ${c.en || ''}`;
  const aprovadas = [];
  const recusadas = { naoAbriu: 0, naoConfiavel: 0, semTexto: 0 };

  recusadas.naoConfiavel = noticias.length - noticias.filter((n) => confiavel(n.url)).length;
  for (const f of candidatos) {
    if (aprovadas.length >= maxFontes) break;
    const p = await abre(f.url);
    if (!p.ok) { recusadas.naoAbriu++; continue; }
    if (!confiavel(p.url)) { recusadas.naoConfiavel++; continue; }
    const texto = f.tipo === 'artigo' ? `${f.titulo}. ${f.resumo}` : textoDaPagina(p.html);
    if (texto.length < 400) { recusadas.semTexto++; continue; }
    aprovadas.push({ ...f, url: p.url, dominio: dominio(p.url), texto: texto.slice(0, 5000) });
  }

  const fontes = aprovadas.map((f, i) => ({ id: `f${i + 1}`, ...f }));
  // quem foi barrado pela lista: é com isto que se decide, com critério, se a
  // lista está curta demais ou fazendo o trabalho dela
  const barrados = [...new Set(noticias.filter((n) => !confiavel(n.url)).map((n) => dominio(n.url)).filter(Boolean))];
  log(`peneira: ${fontes.length} aprovadas, recusadas ${recusadas.naoAbriu} que não abriram, ${recusadas.naoConfiavel} fora da lista confiável, ${recusadas.semTexto} sem texto`);
  if (barrados.length) log(`  fora da lista: ${barrados.join(', ')}`);
  return { consulta, fontes, recusadas, barrados };
}

// Links citados no texto que NÃO vieram da pesquisa: são inventados ou da memória do modelo.
export function linksForaDaPesquisa(texto, fontes) {
  const permitidos = new Set(fontes.map((f) => f.url));
  return [...String(texto).matchAll(/\]\((https?:[^)\s]+)\)|(?<!\()\bhttps?:\/\/[^\s)>\]]+/g)]
    .map((m) => m[1] || m[0])
    .filter((u) => !permitidos.has(u));
}
