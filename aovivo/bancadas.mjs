// Quem senta na bancada em cada tema.
//
// Até 22/09 a bancada era uma só: quatro cadeiras fixas, as mesmas pessoas
// escrevendo sobre qualquer assunto. Com os temas novos isso deixou de fazer
// sentido: quem sabe falar de última milha não é quem sabe falar de índice de
// banco de dados.
//
// As cadeiras continuam sendo três (quem dirige, quem apura, quem verifica),
// porque é o que o motor sabe conduzir. O que muda é quem as ocupa, e isso é
// dado, não código: para intercalar as formações na semana que vem basta mexer
// na tabela abaixo.
//
// Além das cadeiras existe a MESA: antes do Diretor escrever, cada especialista
// do tema dá a leitura dele sobre o que foi apurado. É a diferença entre um
// texto escrito por uma pessoa e um texto escrito depois de ouvir a equipe.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { separa } from '../src/vault.mjs';

/* A composição de cada tema. O primeiro nome de cada cadeira é o titular; os
   seguintes entram por rodízio, pelo número do documento, para que todo mundo
   apareça ao longo da semana e nenhum documento fique igual ao anterior.
   A mesa é a soma de todos, sem repetir, mais a Leitora.

   A CISO dirige Cibersegurança em vez da CTO. No primeiro desenho a CTO dirigia
   três dos cinco temas e assinava 6 de cada 10 documentos: bancada por tema
   existe para variar a voz, e aquilo entregava a mesma voz na maioria dos
   textos. Segurança também pede quem pensa em incidente, não em orçamento. */
export const BANCADAS = {
  programacao: {
    diretor: ['cto'],
    apuracao: ['dev-senior'],
    verificacao: ['dba', 'secops'],
  },
  dados: {
    diretor: ['cto'],
    apuracao: ['cientista-dados', 'dev-senior'],
    verificacao: ['dba'],
  },
  ciberseguranca: {
    diretor: ['ciso'],
    apuracao: ['secops'],
    verificacao: ['dev-senior', 'dba'],
  },
  varejo: {
    diretor: ['supply'],
    apuracao: ['varejo', 'logistica'],
    verificacao: ['comercial', 'pessoas'],
  },
  carreira: {
    diretor: ['rh'],
    apuracao: ['recrutamento', 'treinamento'],
    verificacao: ['pessoas', 'marketing'],
  },
};

/* Quanto uma fala da mesa pode parecer com a apuração antes de ser eco em vez de
   contribuição. Calibrado em 23/09 contra textos escritos à mão: reescrita
   literal deu 0.48, paráfrase disfarçada 0.26, e as contribuições de verdade
   ficaram entre 0.03 e 0.09. O limiar fica no meio do vão, mais perto do lado
   bom: melhor deixar passar um eco do que calar uma contribuição. */
export const ECO_PADRAO = 0.18;

/* A outra forma de não contribuir, que o eco não pega porque não repete palavra
   nenhuma: a concordância vazia. "Concordo com os colegas, tema muito relevante"
   deu 0.00 de semelhança e passaria limpo. Aqui ela é barrada pela abertura,
   que é onde ela sempre aparece, e só quando a fala não traz número nem
   contestação: quem concorda E acrescenta um dado continua valendo. */
const CONCORDA = /^\W*(concordo|de acordo|exatamente|perfeito|isso mesmo|excelente ponto|ótimo ponto|otimo ponto|muito bem colocado|subscrevo|corroboro)\b/i;
const CONTESTA = /\b(mas|porém|porem|entretanto|no entanto|errado|erro|não é|nao e|discordo|falta|faltou|ninguém|ninguem|cuidado|na verdade|contradiz)\b/i;
export function temSubstancia(fala) {
  if (!CONCORDA.test(String(fala))) return true;
  return /\d/.test(fala) || CONTESTA.test(fala);
}

/* A Leitora está em todas as mesas e fala sempre por último. Ela não ocupa
   cadeira nenhuma: as três cadeiras são de quem sabe do assunto, e a função dela
   é justamente não saber. Sem ela, os 16 especialistas melhoram o que o texto
   SABE e ninguém cuida de o texto ser lido até o fim. */
export const LEITORA = 'leitora';

export async function leEspecialistas(dir) {
  const fora = {};
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.md')).sort()) {
    const { meta, corpo } = separa(await readFile(join(dir, f), 'utf8'));
    const id = f.replace(/\.md$/, '');
    if (!meta.nome || !corpo) throw new Error(`especialistas/${f}: falta "nome" no cabeçalho ou o corpo do papel`);
    fora[id] = { id, nome: meta.nome, cargo: meta.cargo || meta.nome, corpo: corpo.trim() };
  }
  return fora;
}

// Falha alto: uma bancada que aponta para um especialista que não existe deixaria
// a cadeira vazia no meio de um documento, e o erro apareceria longe da causa.
export function confereBancadas(especialistas, bancadas = BANCADAS) {
  const faltando = [];
  if (!especialistas[LEITORA]) faltando.push(`falta especialistas/${LEITORA}.md, que está em todas as mesas`);
  for (const [tema, b] of Object.entries(bancadas)) {
    for (const cadeira of ['diretor', 'apuracao', 'verificacao']) {
      if (!b[cadeira]?.length) faltando.push(`${tema}.${cadeira} está vazia`);
      for (const id of b[cadeira] || []) if (!especialistas[id]) faltando.push(`${tema}.${cadeira}: não existe especialistas/${id}.md`);
    }
  }
  if (faltando.length) throw new Error(`Bancadas mal formadas:\n- ${faltando.join('\n- ')}`);
}

const rodizio = (lista, n) => lista[n % lista.length];

/* A bancada de um documento. Recebe o titular de cada cadeira (o papel, que é o
   que o motor conduz) e devolve quem a ocupa hoje, com o papel do titular
   inteiro mais o jeito do especialista, que é o mesmo arranjo que o elenco de
   substitutos já usava: as regras da cadeira valem, o jeito é outro. */
export function montaBancada({ tema, numero, titulares, especialistas, bancadas = BANCADAS }) {
  const b = bancadas[tema];
  if (!b) return null;

  const veste = (titular, id) => {
    const e = especialistas[id];
    return {
      ...titular,
      nome: e.nome,
      cargo: e.cargo,
      titular: titular.nome,
      especialista: true,
      // o jeito solto, além de embutido no papel: as regras da cadeira têm ~5 mil
      // letras e o jeito tem ~800, então no fim do papel ele é 10% do que o modelo
      // lê. Quem precisa dele perto da pergunta pega por aqui.
      jeito: e.corpo,
      papel: `${titular.papel}\n\n## Hoje nesta cadeira\n\nQuem ocupa esta cadeira hoje é ${e.cargo.toLowerCase()}. As regras da cadeira valem inteiras; o jeito de olhar é outro:\n\n${e.corpo}`,
    };
  };

  const escolhidos = {
    diretor: rodizio(b.diretor, numero),
    pesquisador: rodizio(b.apuracao, numero),
    auditor: rodizio(b.verificacao, numero),
  };

  const agentes = {};
  for (const [cadeira, id] of Object.entries(escolhidos)) {
    if (titulares[cadeira]) agentes[cadeira] = veste(titulares[cadeira], id);
  }
  // o Designer não muda com o tema: a imagem é ofício, não assunto
  if (titulares.designer) agentes.designer = titulares.designer;

  /* A mesa: todo mundo do tema, sem repetir, na ordem em que a tabela declara.
     Quem está numa cadeira também fala, porque a leitura dele sobre o apurado
     não é a mesma coisa que o trabalho da cadeira.

     Cada voz leva a cadeira A QUE ELA PERTENCE, e não só a que ocupa hoje: é por
     esse id que a tela sabe qual robô anima e renomeia enquanto a pessoa fala.
     Sem isso, quem está na mesa mas fora da cadeira falaria sem ninguém na cena. */
  const cadeiraDe = (id) => (b.diretor.includes(id) ? 'diretor' : b.apuracao.includes(id) ? 'pesquisador' : 'auditor');
  const naMesa = [...new Set([...b.diretor, ...b.apuracao, ...b.verificacao])]
    .map((id) => ({ ...especialistas[id], cadeira: cadeiraDe(id), ocupa: Object.entries(escolhidos).find(([, v]) => v === id)?.[0] || null }));

  // por último, e sem cadeira própria: ela empresta a do Diretor, que é quem vai
  // escrever e precisa ouvir a reclamação por último
  if (especialistas[LEITORA]) naMesa.push({ ...especialistas[LEITORA], cadeira: 'diretor', ocupa: null, ultima: true });

  return { agentes, mesa: naMesa, escolhidos };
}
