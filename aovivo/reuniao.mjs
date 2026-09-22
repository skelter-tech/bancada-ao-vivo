// A reunião de sábado. A bancada não escreve pauta no fim de semana: às 7h do
// sábado ela lê o diário da semana e faz duas coisas.
//
//   1. O backlog. Os temas que ela quis escrever e não conseguiu, separados
//      entre os que valem outra tentativa e os que não valem, com o motivo.
//   2. A avaliação da própria ferramenta. O que aconteceu tantas vezes na
//      semana que merece existir no sistema e não existe.
//
// A regra que faz isso não virar achismo: toda sugestão precisa citar pelo
// menos um episódio do diário, pelo código, e o código é conferido contra o
// diário de verdade. Sugestão sem episódio válido é descartada aqui, antes de
// chegar na tela. Foi o mesmo caminho da conferência de anatomia do prompt de
// imagem: o modelo ignora a instrução em prosa e obedece à trava em código.
//
// Os agentes sugerem. Nada aqui muda prompt, papel ou configuração sozinho:
// a reunião produz cartões que o administrador aceita ou descarta no /admin/.
import { resume, recusadasDaSemana, episodiosValidos, citacoesValidas, TIPOS } from './diario.mjs';

export const SCHEMA_BACKLOG = {
  type: 'OBJECT',
  properties: {
    retomar: {
      type: 'ARRAY',
      description: 'No máximo 6 temas que valem outra tentativa na semana que vem.',
      items: {
        type: 'OBJECT',
        properties: {
          episodio: { type: 'STRING', description: 'O código do episódio da lista, no formato 0918-03.' },
          tema: { type: 'STRING', description: 'O tema, reescrito mais amplo se o problema foi busca estreita.' },
          porque: { type: 'STRING', description: 'Uma frase: o que muda desta vez para o resultado ser outro.' },
        },
        required: ['episodio', 'tema', 'porque'],
      },
    },
    arquivar: {
      type: 'ARRAY',
      description: 'No máximo 6 temas que não valem outra tentativa.',
      items: {
        type: 'OBJECT',
        properties: {
          episodio: { type: 'STRING', description: 'O código do episódio da lista, no formato 0918-03.' },
          tema: { type: 'STRING' },
          porque: { type: 'STRING', description: 'Uma frase: por que insistir não vale.' },
        },
        required: ['episodio', 'tema', 'porque'],
      },
    },
  },
  required: ['retomar', 'arquivar'],
};

export const SCHEMA_SUGESTOES = {
  type: 'OBJECT',
  properties: {
    sugestoes: {
      type: 'ARRAY',
      description: 'No máximo 4 sugestões. Menos é melhor que inventar.',
      items: {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING', description: 'A sugestão em até 8 palavras.' },
          observacao: { type: 'STRING', description: 'O que foi visto na semana, com o número de vezes.' },
          proposta: { type: 'STRING', description: 'O que passaria a existir no sistema. Concreto.' },
          episodios: { type: 'STRING', description: 'Os códigos dos episódios que sustentam isto, separados por vírgula.' },
        },
        required: ['titulo', 'observacao', 'proposta', 'episodios'],
      },
    },
  },
  required: ['sugestoes'],
};

// O que a reunião lê. Texto curto de propósito: o Groq corta a saída em 2.500
// tokens, e uma semana inteira de episódios crus não caberia na entrada nem
// deixaria espaço para a resposta.
export function pauta(dias) {
  const r = resume(dias);
  const recusadas = recusadasDaSemana(dias);
  const linhas = [
    `## A semana em números (${r.dias.slice(-1)[0] || '?'} a ${r.dias[0] || '?'})`,
    `${r.tentativas} tentativas de documento, ${r.publicados} publicados.`,
    '',
    'O que aconteceu, por tipo:',
    ...Object.entries(r.porTipo).sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${n}x ${t}: ${TIPOS[t] || t}`),
  ];
  if (Object.keys(r.porMarca).length) {
    linhas.push('', 'O que o fiscal pegou, por marca:', ...Object.entries(r.porMarca).sort((a, b) => b[1] - a[1]).map(([m, n]) => `- ${n}x ${m}`));
  }
  if (recusadas.length) {
    linhas.push('', `## Os ${recusadas.length} temas recusados da semana`, ...recusadas.map((x) => `[${x.id}] ${x.dia} (${x.tipo}${x.area ? `, ${x.area}` : ''}) ${x.tema}${x.consulta ? ` — buscou: "${x.consulta}"` : ''}`));
  }
  return { texto: linhas.join('\n'), resumo: r, recusadas };
}

// A trava. Uma sugestão sem episódio que exista no diário da semana é achismo,
// e achismo não entra. Devolve as que passaram e as que caíram, porque saber
// quantas caíram diz se a reunião está funcionando ou alucinando.
export function filtraSugestoes(sugestoes, dias) {
  const validos = episodiosValidos(dias);
  const passaram = []; const caidas = [];
  for (const s of sugestoes || []) {
    const cita = citacoesValidas(s.episodios, validos);
    if (cita.length) passaram.push({ ...s, episodios: cita });
    else caidas.push({ ...s, motivo: 'nenhum episódio do diário sustenta isto' });
  }
  return { passaram, caidas };
}

// Mesma trava para o backlog: item que cita episódio inexistente sai. Aqui a
// conferência é mais dura, porque o tema tem que ser um dos que a bancada de
// fato recusou, e não um que o modelo achou bonito inventar.
export function filtraBacklog(itens, recusadas) {
  const porId = new Map(recusadas.map((x) => [x.id, x]));
  const passaram = []; const caidas = [];
  for (const i of itens || []) {
    const ep = String(i.episodio || '').trim();
    if (porId.has(ep)) passaram.push({ ...i, episodio: ep, original: porId.get(ep).tema, tipo: porId.get(ep).tipo, dia: porId.get(ep).dia });
    else caidas.push({ ...i, motivo: 'episódio não está entre os temas recusados da semana' });
  }
  return { passaram, caidas };
}
