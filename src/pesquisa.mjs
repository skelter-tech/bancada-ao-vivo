// A pesquisa de verdade do trabalho ao vivo. O Pesquisador não inventa link: ele
// só pode citar o que esta rotina encontrou, abriu e leu.
//
// Três fontes gratuitas, sem chave: busca do Bing Notícias (RSS), o arXiv para
// artigo científico, e a leitura da própria página de cada resultado. Depois, a
// peneira: só passa o que abre (HTTP 200) e está num domínio confiável.
import { coletar } from './feeds.mjs';

const UA = 'Mozilla/5.0 (compatible; comite-pauta/1.0; +pesquisa de pauta)';

/* ---------- o que é fonte confiável ----------
   Lista fechada de propósito. Um domínio fora daqui não entra no texto, por melhor
   que pareça. A lista comentada, com o resultado do teste, está em
   aovivo/fontes-confiaveis.md.

   Cada veículo abaixo passou num teste em 19/09/2026: o Bing achou notícia recente
   dele e a página abriu com texto legível, sem paywall. Saíram os que bloqueiam
   leitura automática (Reuters, AP, Axios, Ars Technica, NYT, FT, Bloomberg, WSJ,
   Economist, Politico, Nature, Science): estavam na lista, nunca abriam e só
   ocupavam vaga de fonte que abre. */
const VEICULOS = [
  // Brasil: Globo, UOL, CNN, InfoMoney e a imprensa de referência
  'g1.globo.com', 'oglobo.globo.com', 'valor.globo.com', 'epocanegocios.globo.com', 'revistapegn.globo.com', 'techtudo.com.br',
  'uol.com.br', 'folha.uol.com.br', 'estadao.com.br', 'cnnbrasil.com.br', 'infomoney.com.br', 'exame.com', 'agenciabrasil.ebc.com.br',
  'poder360.com.br', 'correiobraziliense.com.br', 'gazetadopovo.com.br', 'istoedinheiro.com.br', 'neofeed.com.br', 'braziljournal.com', 'veja.abril.com.br',
  // Brasil: tecnologia, telecom e inovação
  'canaltech.com.br', 'tecmundo.com.br', 'olhardigital.com.br', 'tecnoblog.net', 'telesintese.com.br', 'teletime.com.br', 'convergenciadigital.com.br',
  'mobiletime.com.br', 'baguete.com.br', 'startse.com', 'agencia.fapesp.br', 'jornal.usp.br',
  // internacional: imprensa geral e negócios
  'bbc.com', 'bbc.co.uk', 'theguardian.com', 'cnn.com', 'cnbc.com', 'npr.org', 'time.com', 'fortune.com', 'semafor.com', 'dw.com', 'france24.com', 'euronews.com', 'hbr.org', 'restofworld.org',
  // internacional: tecnologia e ciência
  'techcrunch.com', 'theverge.com', 'wired.com', 'technologyreview.com', 'zdnet.com', 'theregister.com', 'datacenterdynamics.com', 'infoq.com', 'spectrum.ieee.org',
  'siliconangle.com', 'computerworld.com', 'informationweek.com', 'cio.com', '404media.co', 'theconversation.com', 'scientificamerican.com', 'sciencedaily.com', 'phys.org', 'techxplore.com',
];
const CONFIAVEIS = [
  // governo e organismos
  /\.gov(\.br)?$/, /\.leg\.br$/, /\.jus\.br$/, /(^|\.)europa\.eu$/, /(^|\.)oecd\.org$/, /(^|\.)un\.org$/, /(^|\.)who\.int$/, /(^|\.)worldbank\.org$/, /(^|\.)imf\.org$/, /(^|\.)itu\.int$/,
  // academia e ciência
  /\.edu(\.br)?$/, /(^|\.)usp\.br$/, /(^|\.)unicamp\.br$/, /(^|\.)ufrj\.br$/, /(^|\.)fgv\.br$/, /(^|\.)arxiv\.org$/, /(^|\.)acm\.org$/, /(^|\.)springer\.com$/, /(^|\.)pnas\.org$/,
  ...VEICULOS.map((d) => new RegExp(`(^|\\.)${d.replace(/\./g, '\\.')}$`)),
];
export const TOTAL_VEICULOS = VEICULOS.length;

export function dominio(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Conteúdo pago dentro de veículo confiável: é release com a marca do jornal. No
// primeiro teste da área Mundo corporativo, um texto de valor.globo.com/patrocinado/dino
// entrou como fonte.
const PATROCINADO = /\/(patrocinado|conteudo-patrocinado|publieditorial|informe-publicitario|branded|dino|parceiros?|estudio-[a-z]+|conteudo-de-marca|sponsored|partner-content|paid-post)(\/|$)/i;

export function confiavel(url) {
  const d = dominio(url);
  if (!d || PATROCINADO.test(String(url).replace(/^https?:\/\/[^/]+/, ''))) return false;
  return CONFIAVEIS.some((re) => re.test(d));
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
  // Consultorias e institutos de pesquisa privados: são a fonte favorita de número
  // em notícia de negócio ("segundo relatório da KPMG"), e no primeiro pedido do
  // administrador a apuração citou a KPMG sem o fiscal ter o nome na lista.
  'KPMG', 'Deloitte', 'PwC', 'PricewaterhouseCoopers', 'Ernst & Young', 'Accenture', 'McKinsey', 'BCG', 'Boston Consulting Group', 'Bain', 'Gartner', 'IDC', 'Forrester', 'Capgemini', 'Kearney', 'Oliver Wyman', 'Roland Berger', 'Nielsen', 'NielsenIQ', 'Kantar', 'Ipsos', 'Euromonitor', 'Statista', 'Datafolha', 'Serasa',
  // varejo e logística, que aparecem em todo tema de supply chain
  'Walmart', 'Carrefour', 'Assaí', 'Atacadão', 'GPA', 'Pão de Açúcar', 'Americanas', 'Casas Bahia', 'Via Varejo', 'Shein', 'Shopee', 'Temu', 'AliExpress', 'Unilever', 'Nestlé', 'Procter & Gamble', 'Coca-Cola', 'PepsiCo', 'SAP', 'Oracle', 'Blue Yonder', 'Manhattan Associates', 'Kinaxis', 'o9 Solutions', 'DHL', 'FedEx', 'UPS', 'Maersk', 'Loggi', 'Rappi', 'Stellantis', 'Volkswagen', 'Toyota', 'BYD', 'Vale S.A.',
];
const RE_EMPRESAS = new RegExp(`\\b(${EMPRESAS.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

/* A exceção, pedida pelo Rubens em 19/09: empresa pode ser nomeada como AUTORA de
   um dado ("segundo relatório da KPMG [f1]"), nunca como protagonista ("a Nvidia
   lançou"). O código só aceita quando confere as duas coisas na mesma frase:
   1. a frase é de atribuição (segundo, de acordo com, relatório, pesquisa...) e o
      nome vem logo depois dessa palavra;
   2. a frase cita uma fonte da pesquisa cujo texto contém o mesmo nome. Isso impede
      o modelo de atribuir a uma empresa um dado que a fonte não atribui. */
const ATRIBUICAO = /(segundo|conforme|de acordo com|relat[óo]rio|pesquisa|estudo|levantamento|sondagem|dados|[íi]ndice|ranking|report|survey|study|according to|research)\b[^.;:!?\n]{0,45}$/i;

function frases(texto) {
  // o código da fonte às vezes vem depois do ponto ("...Report. [f1]"): ele fica
  // com a frase de antes, que é a que ele sustenta
  return String(texto).split(/(?<=[.!?](?:\s*\[f\d+\])*)\s+(?!\[f\d+\])|\n+/);
}

export function empresasCitadas(texto, fontes = null) {
  const achadas = new Set();
  const porId = new Map((fontes || []).map((f) => [f.id, f]));
  for (const frase of frases(texto)) {
    // links não contam: o domínio de uma fonte pode ter nome de empresa e isso é referência, não citação
    const semLinks = frase.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '');
    const codigos = [...frase.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]);
    for (const m of semLinks.matchAll(RE_EMPRESAS)) {
      const nome = m[1];
      const antes = semLinks.slice(0, m.index);
      const atribuida = fontes && ATRIBUICAO.test(antes)
        && codigos.some((id) => porId.get(id) && new RegExp(`\\b${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(`${porId.get(id).titulo} ${porId.get(id).texto}`));
      if (!atribuida) achadas.add(nome);
    }
  }
  return [...achadas];
}

/* ---------- veículo citado pelo nome ----------
   Veículo de imprensa também é empresa. "Segundo o NeoFeed" apareceu no primeiro
   documento real; a referência numerada já diz de onde veio. O nome sai do domínio
   de cada fonte usada, então a checagem acompanha a pesquisa, sem lista fixa.
   Repositório científico e órgão público podem ser citados. */
const PODE_CITAR = /^(arxiv|gov|edu|usp|unicamp|ufrj|fgv|ibge|mit|stanford|nature|science|ieee|acm|oecd|europa|un|who|worldbank|imf|itu|nist|agenciabrasil|fapesp)$/i;
// Pedaço de domínio que é palavra comum em português: "jornal.usp.br" não pode
// acusar todo texto que diga "jornal"
const NAO_E_NOME = /^(com|br|org|net|co|uk|www|news|noticias|mercados|blog|jornal|agencia|abril|revista|spectrum|cio)$/i;
// Veículo com nome de palavra comum só conta com maiúscula no meio da frase: "o
// Valor informou" é o jornal, "o valor do contrato" não é. No documento 9, "valor"
// minúsculo foi acusado como veículo citado.
const NOME_AMBIGUO = new Set(['valor', 'exame', 'veja', 'time', 'fortune', 'terra']);

export function veiculosCitados(texto, fontes) {
  const semLinks = String(texto).replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '');
  const nomes = new Set();
  const escapa = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const f of fontes) {
    const partes = String(f.dominio || dominio(f.url)).split('.');
    // g1.globo.com -> g1 e globo; neofeed.com.br -> neofeed
    for (const p of partes) {
      if (p.length < 2 || NAO_E_NOME.test(p) || PODE_CITAR.test(p)) continue;
      const re = NOME_AMBIGUO.has(p.toLowerCase())
        ? new RegExp(`(?<=[a-zà-ú,] )${escapa(p[0].toUpperCase() + p.slice(1))}\\b`)
        : new RegExp(`\\b${escapa(p)}\\b`, 'i');
      if (re.test(semLinks)) nomes.add(p);
    }
  }
  return [...nomes];
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

/* ---------- Google Notícias ----------
   O segundo canal de busca. O link do RSS é codificado, e desde 2024 só se resolve
   em duas etapas: a página do artigo no Google traz uma assinatura e um carimbo, e
   o batchexecute troca isso pela URL real (testado em 19/09/2026, 5 de 5). Custa
   duas requisições por notícia, então só resolve o que já vem de veículo da lista:
   o RSS diz o domínio do veículo antes de qualquer resolução. */
const UA_NAV = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function buscaGoogle(consultas, dias = 30) {
  const pedidos = [];
  if (consultas.pt) pedidos.push(`https://news.google.com/rss/search?q=${encodeURIComponent(`${consultas.pt} when:${dias}d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`);
  if (consultas.en) pedidos.push(`https://news.google.com/rss/search?q=${encodeURIComponent(`${consultas.en} when:${dias}d`)}&hl=en-US&gl=US&ceid=US:en`);
  const listas = await Promise.all(pedidos.map(async (u) => {
    try {
      const xml = await (await fetch(u, { headers: { 'user-agent': UA_NAV } })).text();
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20).map((m) => {
        const pega = (re) => (m[1].match(re) || [])[1] || '';
        const fonte = pega(/<source url="([^"]+)"/);
        // o título do Google vem com " - Veículo" no fim
        const titulo = pega(/<title>([\s\S]*?)<\/title>/).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+-\s+[^-]+$/, '').trim();
        return { tipo: 'notícia', titulo, url: pega(/<link>([^<]+)<\/link>/), dominioPrevio: dominio(fonte), veiculo: dominio(fonte), data: new Date(pega(/<pubDate>([^<]+)<\/pubDate>/)).toISOString?.() || null, google: true };
      });
    } catch { return []; }
  }));
  return listas.flat().filter((n) => n.url && n.dominioPrevio);
}

/* ---------- o terceiro canal: o RSS dos próprios veículos ----------
   Buscador não é confiável para quem roda o dia inteiro do mesmo servidor: em
   20/09, depois de horas de turnos, o Bing e o Google passaram a devolver zero e
   o Pesquisador recusou três temas seguidos por falta de fonte. O RSS de cada
   veículo não depende de buscador nenhum. Ele entra só quando a busca vem fraca,
   porque traz o noticiário do dia e não o tema procurado: o casamento com o tema
   é feito aqui, por palavra. */
const FEEDS = [
  // 'tec' entra inteiro nas manchetes; 'geral' só quando a notícia é do assunto
  ['g1 Tecnologia', 'https://g1.globo.com/rss/g1/tecnologia/', 'tec'], ['Canaltech', 'https://canaltech.com.br/rss/', 'tec'],
  ['Olhar Digital', 'https://olhardigital.com.br/feed/', 'tec'], ['Tecnoblog', 'https://tecnoblog.net/feed/', 'tec'],
  ['Telesíntese', 'https://telesintese.com.br/feed/', 'tec'], ['Mobile Time', 'https://www.mobiletime.com.br/feed/', 'tec'],
  ['The Verge', 'https://www.theverge.com/rss/index.xml', 'tec'], ['TechCrunch', 'https://techcrunch.com/feed/', 'tec'],
  ['ZDNet', 'https://www.zdnet.com/news/rss.xml', 'tec'], ['The Register', 'https://www.theregister.com/headlines.atom', 'tec'],
  ['MIT Tech Review', 'https://www.technologyreview.com/feed/', 'tec'], ['Phys.org', 'https://phys.org/rss-feed/technology-news/', 'tec'],
  ['InfoQ', 'https://feed.infoq.com/', 'tec'], ['DatacenterDynamics', 'https://www.datacenterdynamics.com/en/rss/', 'tec'],
  ['g1 Economia', 'https://g1.globo.com/rss/g1/economia/', 'geral'], ['Exame', 'https://exame.com/feed/', 'geral'],
  ['InfoMoney', 'https://www.infomoney.com.br/feed/', 'geral'], ['Poder360', 'https://www.poder360.com.br/feed/', 'geral'],
  ['Brazil Journal', 'https://braziljournal.com/feed/', 'geral'], ['CNN Brasil', 'https://www.cnnbrasil.com.br/feed/', 'geral'],
  ['Estadão', 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/', 'geral'],
];

// promoção, jogo e entretenimento entram nos feeds de tecnologia e não são pauta
const NAO_SERVE = /\b(promo[cç][aã]o|promo[cç][oõ]es|desconto|cupom|black friday|melhores (jogos|filmes|s[eé]ries)|gameplay|jogos?|console|playstation|ps5|xbox|nintendo|filmes?|s[eé]ries?|novela|netflix|trailer|futebol|campeonato|hor[oó]scopo|celebridade|unboxing|coupon|guerra|ataque|bombardeio|mata|matou|morte|morreu|assassin|crime|tiroteio|acidente|reality|bbb|a fazenda|paredao|eliminad)\b/i;

// o que é assunto da bancada, para separar notícia de tecnologia e negócio do
// resto do noticiário geral (novela, futebol, política partidária)
const DO_TEMA = /\b(ia|inteligencia artificial|algoritm|machine learning|modelo de linguagem|software|hardware|aplicativo|plataforma|nuvem|cloud|data ?center|servidor|chip|semicondutor|processador|telecom|5g|banda larga|fibra optica|satelite|drone|rob[oô]|automacao|automatiza|digitaliza|transformacao digital|cyber|ciberseguran|seguranca digital|privacidade|dados pessoais|lgpd|startup|fintech|venture|e-?commerce|varejo digital|industria 4|manufatura|logistica|cadeia de suprimentos|energia|renovav|bateria|eletrific|produtividade|gestao|lideranca|governanca|regulacao|regulament|inovacao|patente|pesquisa cientifica|universidade|quantum|quantic|blockchain|criptomoeda|biotec|agritech|healthtech|edtech|technology|artificial intelligence|cybersecurity|chips?|semiconductor|innovation|productivity|supply chain|regulation)\b/i;

const semAcento = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const RUIDO = /^(de|da|do|para|com|sem|por|the|and|for|of|in|on|to|e|a|o|as|os|um|uma)$/;

export async function buscaFeeds(consultas, dias = 21) {
  const termos = [...new Set(`${consultas.pt || ''} ${consultas.en || ''}`.split(/\s+/).map(semAcento).filter((w) => w.length > 3 && !RUIDO.test(w)))];
  if (!termos.length) return [];
  const { itens } = await coletar({
    fontes: FEEDS.map(([nome, url]) => ({ nome, url })),
    janelaHoras: dias * 24, maxItens: 900, maxPorFonte: 60,
  });
  // palavra que aparece em quase toda notícia de tecnologia casa com tudo e não
  // diz nada sobre o tema: vale meio ponto
  const GENERICA = /^(inteligencia|artificial|tecnologia|tecnologica|digital|digitais|dados|empresa|empresas|mercado|sistema|sistemas|intelligence|technology|digitally|data|company|companies|market|system|systems)$/;
  const peso = (t) => (GENERICA.test(t) ? 0.5 : 1) + (t.length > 7 && !GENERICA.test(t) ? 1 : 0);
  const especificos = termos.filter((t) => !GENERICA.test(t));
  return itens.map((i) => {
    const titulo = semAcento(i.titulo);
    const texto = `${titulo} ${semAcento(i.resumo || '')}`;
    const casou = termos.filter((t) => texto.includes(t));
    // uma palavra específica do tema tem que estar no TÍTULO: sem isso, "segurança
    // edge computing" casava com notícia de segurança pública
    const noTitulo = especificos.some((t) => titulo.includes(t));
    // e duas palavras específicas ao todo: com uma só, "segurança edge computing"
    // trazia câmera de segurança em promoção
    const duasEspecificas = especificos.filter((t) => texto.includes(t)).length >= 2;
    return { i, peso: noTitulo && duasEspecificas ? casou.reduce((s, t) => s + peso(t), 0) : 0 };
  }).filter((x) => x.peso >= 2)
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 12)
    .map(({ i }) => ({ tipo: 'notícia', titulo: i.titulo, url: i.url, veiculo: i.veiculo, data: i.data?.toISOString?.() || null }));
}

/* ---------- DuckDuckGo e GDELT ----------
   Dois canais que não dependem de Bing nem de Google, para o dia em que os dois
   bloqueiam o servidor. O DuckDuckGo devolve HTML e o link vem no href; o GDELT é
   uma base pública de notícias do mundo inteiro, com API aberta e sem chave. */
export async function buscaDuckDuckGo(consultas) {
  const saida = [];
  for (const q of [consultas.pt, consultas.en].filter(Boolean)) {
    try {
      const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA_NAV, accept: 'text/html' } });
      if (!r.ok) continue;
      const html = await r.text();
      for (const m of html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        let url = m[1].replace(/&amp;/g, '&');
        // o DuckDuckGo embrulha o link em /l/?uddg=
        const dentro = url.match(/[?&]uddg=([^&]+)/);
        if (dentro) url = decodeURIComponent(dentro[1]);
        const titulo = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
        if (/^https?:/.test(url) && titulo) saida.push({ tipo: 'notícia', titulo, url, veiculo: dominio(url), data: null });
      }
    } catch { /* segue para o próximo canal */ }
  }
  return saida.slice(0, 20);
}

export async function buscaGdelt(consultas, dias = 21) {
  const q = consultas.en || consultas.pt;
  if (!q) return [];
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=25&timespan=${dias}d&sort=hybridrel`;
    const r = await fetch(url, { headers: { 'user-agent': UA_NAV } });
    if (!r.ok) return [];
    const j = JSON.parse(await r.text());
    return (j.articles || []).map((a) => ({ tipo: 'notícia', titulo: a.title, url: a.url, veiculo: dominio(a.url), data: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : null }));
  } catch { return []; }
}

export async function resolveGoogle(link) {
  try {
    const id = new URL(link).pathname.split('/').pop();
    const pg = await (await fetch(`https://news.google.com/rss/articles/${id}`, { headers: { 'user-agent': UA_NAV } })).text();
    const sg = (pg.match(/data-n-a-sg="([^"]+)"/) || [])[1];
    const ts = (pg.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sg || !ts) return null;
    const req = [[['Fbv4je', `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`, null, 'generic']]];
    const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': UA_NAV },
      body: `f.req=${encodeURIComponent(JSON.stringify(req))}`,
    });
    return ((await r.text()).match(/garturlres\\",\\"(https?:[^\\"]+)/) || [])[1] || null;
  } catch { return null; }
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
    // só os últimos 3 anos: por relevância, o arXiv trazia estudo de 2018, e numa
    // bancada de novidades um artigo de oito anos atrás enfraquece o texto
    const limite = Date.now() - 3 * 365 * 24 * 3600 * 1000;
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const e = m[1];
      const pega = (t) => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
      return { tipo: 'artigo', titulo: pega('title'), url: pega('id').replace('http://', 'https://'), veiculo: 'arXiv', data: pega('published'), resumo: pega('summary').slice(0, 900) };
    }).filter((a) => !a.data || Date.parse(a.data) >= limite);
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
// As manchetes que os veículos publicaram, sem passar por buscador nenhum. É
// com elas que o Diretor escolhe o tema nos dias em que a busca está bloqueada.
export async function manchetes({ dias = 2, max = 45 } = {}) {

  const { itens } = await coletar({
    fontes: FEEDS.map(([nome, url]) => ({ nome, url })),
    janelaHoras: dias * 24, maxItens: 600, maxPorFonte: 25,
  });
  return itens
    .filter((i) => confiavel(i.url))
    // sem acento dos dois lados: a manchete vem com "logística" e a lista tem "logistica"
    .filter((i) => {
      const t = semAcento(`${i.titulo} ${i.resumo || ''}`);
      return DO_TEMA.test(t) && !NAO_SERVE.test(semAcento(i.titulo));
    })
    .slice(0, max)
    .map((i) => ({ tipo: 'notícia', titulo: i.titulo, url: i.url, veiculo: i.veiculo, data: i.data?.toISOString?.() || null }));
}

export async function pesquisar(consultas, { maxFontes = 8, log = () => {}, itens = null } = {}) {
  const c = typeof consultas === 'string' ? { pt: consultas, en: consultas } : (consultas || { pt: '', en: '' });
  // com a lista pronta (as manchetes escolhidas pelo Diretor), não há o que buscar
  if (itens) {
    const [bing, google, artigos] = [itens, [], c.en ? await buscaArxiv(c.en, 3) : []];
    log(`sem busca: ${itens.length} manchetes escolhidas, ${artigos.length} artigos`);
    return peneira(c, bing, google, artigos, [], { maxFontes, log });
  }
  // SEM_BUSCADOR=1 finge que Bing e Google estão bloqueados: é como se testa o
  // caminho alternativo num dia em que eles estão respondendo normalmente
  const semBuscador = process.env.SEM_BUSCADOR === '1';
  const [bing, google, artigos] = semBuscador
    ? [[], [], c.en ? await buscaArxiv(c.en) : []]
    : await Promise.all([buscaNoticias(c), buscaGoogle(c), c.en ? buscaArxiv(c.en) : []]);
  log(`busca pt "${c.pt || ''}" / en "${c.en || ''}": ${bing.length} do Bing, ${google.length} do Google, ${artigos.length} artigos`);
  // buscador fraco (bloqueio de IP, quase sempre) não pode virar "tema sem fonte":
  // o RSS dos veículos entra como terceiro canal
  let feeds = [];
  if (bing.length + google.length < 6) {
    // primeiro os outros buscadores, depois o RSS dos veículos
    const [ddg, gdelt] = await Promise.all([buscaDuckDuckGo(c).catch(() => []), buscaGdelt(c).catch(() => [])]);
    feeds = [...ddg, ...gdelt];
    log(`busca fraca: ${ddg.length} do DuckDuckGo, ${gdelt.length} do GDELT`);
    if (feeds.length + bing.length + google.length < 6) {
      const rss = await buscaFeeds(c).catch(() => []);
      feeds = [...feeds, ...rss];
      log(`ainda fraca, fui aos feeds dos veículos: ${rss.length} notícias`);
    }
  }
  return peneira(c, bing, google, artigos, feeds, { maxFontes, log });
}

/* A peneira, igual para qualquer canal: abre cada candidato, confere o domínio na
   lista confiável e guarda só o que tem texto legível. */
async function peneira(c, bing, google, artigos, feeds, { maxFontes, log }) {
  // Bing e Google intercalados, sem repetir a mesma notícia (mesmo título) e com no
  // máximo duas por veículo: um veículo só sustentando o texto não é apuração
  const noticias = [];
  const vistos = new Set();
  const porVeiculo = new Map();
  const chaveTitulo = (t) => String(t).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70);
  for (let i = 0; i < Math.max(bing.length, google.length, feeds.length); i++) {
    for (const n of [bing[i], google[i], feeds[i]]) {
      if (!n) continue;
      const d = n.dominioPrevio || dominio(n.url);
      const k = chaveTitulo(n.titulo);
      if (vistos.has(k)) continue;
      vistos.add(k);
      noticias.push({ ...n, _dom: d });
    }
  }
  const limitaVeiculo = (n) => { const q = porVeiculo.get(n._dom) || 0; if (q >= 2) return false; porVeiculo.set(n._dom, q + 1); return true; };

  // pré-peneira pelo domínio que o link já mostra: não gasta tempo abrindo o que
  // seria recusado de qualquer jeito
  // intercala notícia e artigo, com no máximo 3 artigos: no primeiro teste o arXiv
  // ocupou 6 das 7 vagas e metade nem era do tema
  const confiaveis = noticias.filter((n) => confiavel(`https://${n._dom}/`)).filter(limitaVeiculo);
  const candidatos = [];
  for (let i = 0; i < Math.max(confiaveis.length, 3); i++) {
    if (confiaveis[i]) candidatos.push(confiaveis[i]);
    if (i < 3 && artigos[i]) candidatos.push(artigos[i]);
  }
  const consulta = `${c.pt || ''} | ${c.en || ''}`;
  const aprovadas = [];
  const recusadas = { naoAbriu: 0, naoConfiavel: 0, semTexto: 0 };

  recusadas.naoConfiavel = noticias.length - noticias.filter((n) => confiavel(`https://${n._dom}/`)).length;
  const urlsAprovadas = new Set();
  for (const f of candidatos) {
    if (aprovadas.length >= maxFontes) break;
    if (f.google) {
      const real = await resolveGoogle(f.url);
      if (!real) { recusadas.naoAbriu++; continue; }
      f.url = real;
    }
    if (urlsAprovadas.has(f.url)) continue;
    const p = await abre(f.url);
    if (!p.ok) { recusadas.naoAbriu++; continue; }
    if (!confiavel(p.url)) { recusadas.naoConfiavel++; continue; }
    const texto = f.tipo === 'artigo' ? `${f.titulo}. ${f.resumo}` : textoDaPagina(p.html);
    if (texto.length < 400) { recusadas.semTexto++; continue; }
    urlsAprovadas.add(f.url);
    const { google, dominioPrevio, _dom, ...limpa } = f;
    aprovadas.push({ ...limpa, url: p.url, dominio: dominio(p.url), texto: texto.slice(0, 5000) });
  }

  const fontes = aprovadas.map((f, i) => ({ id: `f${i + 1}`, ...f }));
  // quem foi barrado pela lista: é com isto que se decide, com critério, se a
  // lista está curta demais ou fazendo o trabalho dela
  const barrados = [...new Set(noticias.filter((n) => !confiavel(`https://${n._dom}/`)).map((n) => n._dom).filter(Boolean))];
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
