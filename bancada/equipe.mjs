import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { separa } from '../src/vault.mjs';

// Mesma convenção do comitê: o papel é o corpo do markdown, a configuração é o
// frontmatter. Aqui o discriminante é "funcao" em vez de "cadeira".
export async function lerEquipe(dir) {
  const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  const todos = [];

  for (const arquivo of arquivos) {
    const { meta, corpo } = separa(await readFile(join(dir, arquivo), 'utf8'));
    if (!meta.funcao || meta.ativo === false || !corpo) continue;
    todos.push({
      id: arquivo.replace(/^_/, '').replace(/\.md$/, ''),
      nome: meta.nome || arquivo,
      funcao: meta.funcao,
      entrega: meta.entrega || '',
      modelo: meta.modelo || 'gemini-3.5-flash',
      temperatura: typeof meta.temperatura === 'number' ? meta.temperatura : 0.85,
      ordem: typeof meta.ordem === 'number' ? meta.ordem : 99,
      papel: corpo,
    });
  }

  todos.sort((a, b) => a.ordem - b.ordem);
  const diretor = todos.find((a) => a.funcao === 'diretor');
  const equipe = todos.filter((a) => a.funcao !== 'diretor');

  if (!diretor) throw new Error('Nenhum agente com "funcao: diretor" em equipe/.');
  if (equipe.length < 2) throw new Error('Menos de duas funções ativas na bancada.');

  return { equipe, diretor, todos };
}
