// O diário de bordo da bancada: o que deu errado no dia, guardado.
//
// Quase toda a fricção do trabalho hoje é gerada e jogada fora no mesmo segundo.
// O tema recusado por falta de fonte vira uma linha na tela, entra num array
// local do motor e morre quando o processo morre. O post barrado pelo fiscal
// idem. Sobrava só o que foi publicado, que é justamente o que NÃO tem problema.
//
// Sem esse registro, a reunião de sábado seria achismo: os agentes opinariam de
// memória sobre uma semana que ninguém anotou. Com ele, cada sugestão tem que
// apontar para um episódio com data e número, ou não vira sugestão.
//
// Um documento por dia, em diario/{AAAA-MM-DD}. O campo "numero" é a data como
// inteiro (20260922), que é o que deixa a consulta por número do Firestore
// devolver os últimos dias em ordem, sem precisar de índice novo.

// Os tipos de episódio. São poucos de propósito: cada um corresponde a um ponto
// exato do motor onde o trabalho para ou volta atrás.
export const TIPOS = {
  repetido: 'tema parecido com um já publicado',
  sem_fonte: 'menos de três fontes confiáveis',
  nao_sustenta: 'o Pesquisador achou fonte, mas não sustenta o tema',
  fora_do_tema: 'as fontes que sobraram eram de outro assunto',
  sem_tema: 'três tentativas sem tema que tivesse fonte',
  desistiu: 'o Diretor não conseguiu escrever com essas fontes',
  corrigido: 'o fiscal apontou e a correção resolveu',
  barrado: 'o fiscal barrou a publicação',
  sem_cota: 'a cota gratuita acabou no meio do trabalho',
  publicado: 'documento publicado',
};

// As marcas do fiscal, em uma palavra cada. A frase que o fiscal escreve é para
// o Diretor ler e corrigir; a marca é para a reunião conseguir contar.
export function marcasDoFiscal(x) {
  return [
    ...(x.empresas?.length ? ['empresa'] : []),
    ...(x.veiculos?.length ? ['veiculo'] : []),
    ...(x.numeros?.length ? ['numero_sem_fonte'] : []),
    ...(x.codigos?.length ? ['codigo_inexistente'] : []),
    ...(x.ingles ? ['ingles'] : []),
    ...(x.usadas < 3 ? ['poucas_fontes'] : []),
    ...(x.tamanho > 2800 ? ['tamanho'] : []),
  ];
}

export const novoDiario = (data) => ({ data, numero: Number(data.replace(/-/g, '')), episodios: [] });

// O código do episódio é curto de propósito: é ele que a reunião cita, e modelo
// erra código longo. "0922-07" é o sétimo episódio do dia 22 de setembro.
const codigo = (data, n) => `${data.slice(5).replace('-', '')}-${String(n).padStart(2, '0')}`;

// Teto por dia. Um dia normal tem umas 60 anotações; 400 é folga larga e evita
// que um dia de erro em série estoure o limite de 1 MiB do documento.
const TETO = 400;

export function anota(diario, tipo, dados = {}) {
  if (!TIPOS[tipo]) throw new Error(`tipo de episódio desconhecido: ${tipo}`);
  if (diario.episodios.length >= TETO) { diario.estourou = (diario.estourou || 0) + 1; return null; }
  const ep = { id: codigo(diario.data, diario.episodios.length + 1), quando: new Date().toISOString(), tipo, ...dados };
  diario.episodios.push(ep);
  return ep;
}

// O resumo que vai para a reunião. Conta por tipo e por marca do fiscal, porque
// é a contagem que separa "aconteceu uma vez" de "acontece toda semana".
export function resume(dias) {
  const episodios = dias.flatMap((d) => d.episodios || []);
  const porTipo = {};
  const porMarca = {};
  for (const e of episodios) {
    porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
    for (const m of e.marcas || []) porMarca[m] = (porMarca[m] || 0) + 1;
  }
  const tentativas = episodios.filter((e) => e.tipo !== 'corrigido' && e.tipo !== 'sem_cota').length;
  return {
    dias: dias.map((d) => d.data),
    episodios: episodios.length,
    tentativas,
    publicados: porTipo.publicado || 0,
    porTipo,
    porMarca,
  };
}

// Os temas recusados da semana, que são o backlog: o que a bancada quis escrever
// e não conseguiu. Sem os publicados e sem o que não tem tema (cota, correção).
// O barrado entra: ele chegou mais longe que todos os outros, com fonte e texto
// prontos, e só caiu na forma. É o candidato mais barato de recuperar.
// Pedido do administrador fica de fora: o tema era dele, não uma escolha da
// bancada, então não é candidato a voltar na pauta por decisão dela.
const RECUSA = new Set(['repetido', 'sem_fonte', 'nao_sustenta', 'fora_do_tema', 'desistiu', 'barrado']);

export function recusadasDaSemana(dias) {
  const fora = [];
  for (const d of dias) {
    for (const e of d.episodios || []) {
      if (!RECUSA.has(e.tipo) || !e.tema || e.pedido) continue;
      fora.push({ id: e.id, dia: d.data, tema: e.tema, tipo: e.tipo, area: e.area || '', consulta: e.consulta_pt || '' });
    }
  }
  return fora;
}

// Um episódio só conta como evidência se existir mesmo no diário da semana. É
// esta função que faz a trava "sem evidência, sem sugestão" ser de código, e não
// um pedido no prompt que o modelo pode ignorar.
export function episodiosValidos(dias) {
  return new Set(dias.flatMap((d) => (d.episodios || []).map((e) => e.id)));
}

export function citacoesValidas(texto, validos) {
  const citados = [...new Set(String(texto || '').match(/\b\d{4}-\d{2}\b/g) || [])];
  return citados.filter((c) => validos.has(c));
}
