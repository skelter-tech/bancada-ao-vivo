// O tema é da área de quem escolheu?
//
// Em 23/09, primeiro dia das bancadas por tema, a Diretora de RH escolheu
// "Análise de dados com SQL para tomada de decisão" para Carreira e
// Competências. É tema de Dados com uma justificativa de carreira pendurada, e
// saiu ao vivo. Cada cabeça foi posto ali porque sabe daquele assunto; se ele
// pode escolher o assunto de outro, a bancada por tema não serve para nada.
//
// A medida: quanto das palavras do tema aparecem no vocabulário de cada área.
// Não é um limiar absoluto, é comparação — "alguém reivindica este tema mais do
// que você?" — porque tema bom pontua zero na própria área com frequência
// ("Índices parciais em bancos relacionais grandes" não tem palavra nenhuma do
// foco de Programação) e um limiar absoluto reprovaria metade do trabalho bom.
//
// Calibrado em 23/09 contra 17 temas escritos à mão, 5 invasores e 12 legítimos:
// os invasores ficaram em 0.40, 0.60, 0.80 e 1.00; o pior legítimo em 0.25. O
// limiar fica em 0.30, acima do pior legítimo.
//
// A trava é de um lado só, e isto é escolha. Um invasor ficou em 0.25, no mesmo
// ponto do pior legítimo ("Vazamento de memória em processos longos", que é
// Programação de verdade e pontua para Cibersegurança por causa de "vazamento"):
// ali a medida não separa, e preferir deixar passar a barrar tema bom é a mesma
// escolha da trava de eco da mesa.
const palavras = (s) => new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((p) => p.length > 3));

export const MARGEM = 0.30;

// O vocabulário de uma área é o que ela declara: o nome, o foco, a regra e a
// lista de palavras próprias. A lista existe porque o foco foi escrito para o
// modelo ler, não para classificar: sem ela, "credencial vazada" não pontuava
// para Cibersegurança em lugar nenhum e um invasor passava batido.
export const vocabulario = (area) => palavras(`${area.nome} ${area.foco} ${area.regra || ''} ${area.palavras || ''}`);

export function afinidade(tema, area) {
  const T = palavras(tema);
  if (!T.size) return 0;
  const V = vocabulario(area);
  let n = 0;
  for (const p of T) if (V.has(p)) n++;
  return n / T.size;
}

/* Devolve a área que reivindica o tema mais do que a de quem escolheu, ou null
   quando o tema pode ficar. Null também quando a área não está na lista: uma
   área sem concorrente não tem de quem ser invasora. */
export function foraDaArea(tema, area, areas, margem = MARGEM) {
  if (!tema || !area || !areas?.length) return null;
  const minha = afinidade(tema, area);
  let dono = null; let maior = minha;
  for (const a of areas) {
    if (a.nome === area.nome) continue;
    const nota = afinidade(tema, a);
    if (nota > maior) { maior = nota; dono = a; }
  }
  return dono && maior - minha >= margem ? { area: dono.nome, nota: maior, minha } : null;
}
