import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PASTA = 'agentes';

// Frontmatter mínimo: chave: valor, um por linha. Não precisa de YAML completo
// aqui e uma dependência de parser custaria mais do que estas vinte linhas.
function separa(texto) {
  const limpo = texto.replace(/^﻿/, '');
  const m = limpo.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, corpo: limpo.trim() };

  const meta = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const par = linha.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!par) continue;
    const chave = par[1];
    let valor = par[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (valor === 'true' || valor === 'false') meta[chave] = valor === 'true';
    else if (valor !== '' && !Number.isNaN(Number(valor))) meta[chave] = Number(valor);
    else meta[chave] = valor;
  }
  return { meta, corpo: m[2].trim() };
}

// Separa frontmatter de corpo em qualquer .md. Exportado porque a bancada usa
// a mesma convenção de papel-em-markdown com outro conjunto de campos.
export { separa };

export async function lerAgentes(raiz, pasta = PASTA) {
  const dir = join(raiz, pasta);
  const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.md'));

  const cadeiras = [];
  let editor = null;

  for (const arquivo of arquivos.sort()) {
    const { meta, corpo } = separa(await readFile(join(dir, arquivo), 'utf8'));
    // Sem "cadeira" no frontmatter não é conselheiro. É o que permite guardar
    // configuração e anotação solta na mesma pasta sem elas subirem para a mesa.
    if (!meta.cadeira || meta.ativo === false || !corpo) continue;

    const agente = {
      id: arquivo.replace(/^_/, '').replace(/\.md$/, ''),
      arquivo,
      nome: meta.nome || arquivo.replace(/\.md$/, ''),
      cadeira: meta.cadeira || 'sem cadeira',
      modelo: meta.modelo || 'gemini-2.5-flash',
      temperatura: typeof meta.temperatura === 'number' ? meta.temperatura : 0.9,
      peso: typeof meta.peso === 'number' ? meta.peso : 1,
      papel: corpo,
    };

    if (agente.cadeira === 'editor') editor = agente;
    else cadeiras.push(agente);
  }

  if (!editor) throw new Error('Nenhum agente com "cadeira: editor" em agentes/. O comitê não fecha edição sem ele.');
  if (cadeiras.length < 2) throw new Error(`Só ${cadeiras.length} cadeira(s) ativa(s). Um comitê de um não delibera.`);

  return { cadeiras, editor };
}

// O comitê lê _fontes.md; o radar do Diretor lê _radar.md. Mesmo formato.
export async function lerFontes(raiz, arquivo = '_fontes.md') {
  const { meta, corpo } = separa(await readFile(join(raiz, PASTA, arquivo), 'utf8'));
  const fontes = [];

  for (const linha of corpo.split(/\r?\n/)) {
    const bruto = linha.trim();
    if (!bruto.startsWith('-')) continue;
    const item = bruto.slice(1).trim();
    if (item.startsWith('#')) continue;

    const url = item.match(/https?:\/\/\S+/);
    if (!url) continue;
    const nome = item.split('|')[0].trim() || new URL(url[0]).hostname;
    fontes.push({ nome, url: url[0] });
  }

  return {
    fontes,
    janelaHoras: Number(process.env.JANELA_HORAS) || meta.janela_horas || 36,
    maxItens: meta.max_itens || 70,
    maxPorFonte: meta.max_por_fonte || 12,
  };
}
