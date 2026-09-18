// Coleta RSS/Atom sem dependência. São quatro campos por item e um parser de
// XML completo não pagaria o node_modules.

const UA = 'comite-pauta/1.0 (+https://github.com/)';

function tag(bloco, nome) {
  const re = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i');
  const m = bloco.match(re);
  return m ? m[1] : '';
}

function entidades(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&');
}

// Google News escapa o HTML do resumo em entidades dentro do CDATA. Decodificar
// antes de tirar tag e repetir depois e o que impede o markup de vazar como texto.
function limpa(bruto) {
  return entidades(entidades(bruto.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function link(bloco) {
  const atom = bloco.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    || bloco.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  const rss = limpa(tag(bloco, 'link'));
  return rss.startsWith('http') ? rss : (atom ? atom[1] : '');
}

function quando(bloco) {
  for (const campo of ['pubDate', 'published', 'updated', 'dc:date']) {
    const v = limpa(tag(bloco, campo));
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function itens(xml) {
  const blocos = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  return blocos.map((b) => ({
    titulo: limpa(tag(b, 'title')),
    url: limpa(link(b)),
    data: quando(b),
    origem: limpa(tag(b, 'source')),
    resumo: limpa(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 420),
  }));
}

async function busca(fonte, timeoutMs = 20000) {
  const ctl = AbortController ? new AbortController() : null;
  const t = ctl && setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(fonte.url, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      signal: ctl?.signal,
      redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return itens(await r.text());
  } finally {
    if (t) clearTimeout(t);
  }
}

// Google News entrega o veículo real na tag <source> e repete ele no fim do
// título. Separar os dois é o que deixa o Cético distinguir quem apurou de quem
// replicou, que é metade do trabalho dele.
function veiculo(it, fonte) {
  if (it.origem) {
    const limpo = it.titulo.replace(new RegExp(`\\s[–—-]\\s${it.origem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '');
    return { titulo: limpo.trim() || it.titulo, veiculo: it.origem };
  }
  return { titulo: it.titulo, veiculo: fonte };
}

function chave(titulo) {
  return titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((p) => p.length > 3).slice(0, 8).join(' ');
}

export async function coletar({ fontes, janelaHoras, maxItens, maxPorFonte }) {
  const corte = Date.now() - janelaHoras * 3600 * 1000;
  const falhas = [];
  const brutos = [];

  const lotes = await Promise.allSettled(fontes.map((f) => busca(f)));

  lotes.forEach((lote, i) => {
    const fonte = fontes[i];
    if (lote.status === 'rejected') {
      falhas.push({ fonte: fonte.nome, erro: String(lote.reason?.message || lote.reason) });
      return;
    }
    const recentes = lote.value
      .filter((it) => it.titulo && it.url)
      .filter((it) => !it.data || it.data.getTime() >= corte)
      .slice(0, maxPorFonte);

    if (!recentes.length) falhas.push({ fonte: fonte.nome, erro: 'nenhum item dentro da janela' });

    for (const it of recentes) {
      const { titulo, veiculo: v } = veiculo(it, fonte.nome);
      brutos.push({ ...it, titulo, fonte: fonte.nome, veiculo: v });
    }
  });

  // Dedupe por assinatura do título: a mesma notícia chega por cinco feeds. O
  // número de repetições é sinal para o comitê, então guardamos a contagem em
  // vez de descartar em silêncio.
  const mapa = new Map();
  for (const it of brutos) {
    const k = chave(it.titulo);
    if (!k) continue;
    const ja = mapa.get(k);
    if (ja) {
      ja.repetido += 1;
      if (!ja.tambemEm.includes(it.fonte)) ja.tambemEm.push(it.fonte);
      if (it.resumo.length > ja.resumo.length) ja.resumo = it.resumo;
    } else {
      mapa.set(k, { ...it, repetido: 1, tambemEm: [it.fonte] });
    }
  }

  const ordenados = [...mapa.values()]
    .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0))
    .slice(0, maxItens)
    .map((it, i) => ({ id: `n${String(i + 1).padStart(2, '0')}`, ...it }));

  return { itens: ordenados, falhas, coletadoEm: new Date().toISOString() };
}

// Versão para quem roda no Groq, que aceita só 8 mil tokens por minuto: título,
// veículo e eco, sem o resumo. Para julgar se uma notícia é marketing, origem e
// replicação pesam mais que o resumo, e o dossiê cai para um terço do tamanho.
export function dossieCompacto(itens) {
  return itens.map((it) => `[${it.id}] ${it.titulo} | ${it.veiculo}${it.repetido > 1 ? ` | replicado em ${it.repetido} fontes` : ''}`).join('\n');
}

export function dossie(itens) {
  return itens.map((it) => {
    const quandoTxt = it.data
      ? `${Math.max(0, Math.round((Date.now() - it.data.getTime()) / 3600000))}h atrás`
      : 'sem data';
    const eco = it.repetido > 1 ? ` | replicado em ${it.repetido} fontes: ${it.tambemEm.join(', ')}` : ' | fonte única';
    return `[${it.id}] ${it.titulo}\n    ${it.veiculo} | ${quandoTxt}${eco}\n    ${it.resumo || 'sem resumo no feed'}\n    ${it.url}`;
  }).join('\n\n');
}
