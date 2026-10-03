/* Acento que o modelo come.
   Achado da auditoria de leitura em 30/09: títulos publicados como "Protecao",
   "Gestao", "Descarbonizacao", "Implementacao", "termica", e a hashtag
   #gestaodeestoque. Sempre nos mesmos lugares: o título e a linha de hashtags,
   que são escritos por último e em caixa diferente do resto.

   Por que não mandar o modelo consertar: ele já é mandado. O papel pede português
   do Brasil e o título acentuado, e os cinco casos saíram assim de qualquer jeito.
   Acento é trabalho de código, como o travessão.

   Duas forças, de propósito:

   - REGRA DE SUFIXO, para o que não tem exceção em português. Nenhuma palavra
     nossa termina em "cao", "coes", "sao" ou "soes" sem acento, então
     "adocao" vira "adoção" e "versoes" vira "versões" sem dicionário.
   - DICIONÁRIO, para o resto, que é caso a caso ("termica", "tecnico", "nivel").

   O que o código NÃO faz: mexer no corpo do post. Lá a palavra sem acento pode
   ser nome próprio, termo em inglês ou citação, e trocar letra dentro de um texto
   que o leitor vai ler inteiro é risco maior que o erro. No corpo o fiscal aponta
   e o Diretor reescreve, como faz com o resto. */

// Palavra que termina assim, em português, tem acento. Não há exceção nossa; o
// que existe é nome estrangeiro, e por isso a troca só vale com a palavra toda
// em letra minúscula ou com só a primeira maiúscula (título), nunca em CAIXA
// ALTA nem no meio de outra palavra.
// A ordem manda: "coes" antes de "oes", senão "adocoes" viraria "adocões" sem a
// cedilha; "cao" antes de "ao" pelo mesmo motivo. Só valem para palavra de quatro
// letras ou mais, porque "ao" é palavra nossa e não quer acento.
const SUFIXOS = [
  [/coes$/, 'ções'], [/oes$/, 'ões'],
  [/cao$/, 'ção'], [/ao$/, 'ão'],
];
const MINIMO_SUFIXO = 4;

/* Palavra que termina como as nossas e NÃO é nossa. Duas famílias:
   nome próprio ("Mao", "Macao", "Bilbao") e palavra inglesa de uso corrente em
   texto de tecnologia ("does", "goes"). Sem esta lista, o fiscal apontaria
   "does" como português sem acento e mandaria o Diretor consertar o que estava
   certo. */
const ESTRANGEIRO = /^(mao|tao|bilbao|macao|curacao|dao|cacao|lao|xiao|hao|ciao|does|goes|toes|shoes|heroes|echoes|foes|woes|oboes|canoes|potatoes|tomatoes|zeroes|tornadoes|aloe|aloes)$/i;

/* O dicionário. Só palavra que a casa de fato escreve, e que já apareceu ou tem
   chance real de aparecer em pauta de tecnologia, dados, varejo, carreira e
   segurança. A chave é a forma SEM acento, em minúscula. */
const PALAVRAS = {
  termica: 'térmica', termico: 'térmico', tecnica: 'técnica', tecnico: 'técnico', tecnicas: 'técnicas', tecnicos: 'técnicos',
  nivel: 'nível', niveis: 'níveis', numero: 'número', numeros: 'números', metrica: 'métrica', metricas: 'métricas',
  logistica: 'logística', logistico: 'logístico', estrategia: 'estratégia', estrategias: 'estratégias', estrategico: 'estratégico', estrategica: 'estratégica',
  historico: 'histórico', historia: 'história', pratica: 'prática', praticas: 'práticas', pratico: 'prático',
  politica: 'política', politicas: 'políticas', publico: 'público', publica: 'pública', publicas: 'públicas', publicos: 'públicos',
  analise: 'análise', analises: 'análises', analitico: 'analítico', analitica: 'analítica',
  critico: 'crítico', critica: 'crítica', criticos: 'críticos', criticas: 'críticas', criterio: 'critério', criterios: 'critérios',
  automatico: 'automático', automatica: 'automática', basico: 'básico', basica: 'básica',
  economico: 'econômico', economia: 'economia', economicos: 'econômicos',
  eletronico: 'eletrônico', eletronica: 'eletrônica', eletronicos: 'eletrônicos',
  organico: 'orgânico', organica: 'orgânica', dinamico: 'dinâmico', dinamica: 'dinâmica',
  maquina: 'máquina', maquinas: 'máquinas', modulo: 'módulo', modulos: 'módulos',
  codigo: 'código', codigos: 'códigos', calculo: 'cálculo', calculos: 'cálculos',
  usuario: 'usuário', usuarios: 'usuários', relatorio: 'relatório', relatorios: 'relatórios',
  inventario: 'inventário', inventarios: 'inventários', salario: 'salário', salarios: 'salários',
  armazem: 'armazém', orgao: 'órgão', orgaos: 'órgãos', area: 'área', areas: 'áreas',
  energia: 'energia', industria: 'indústria', industrias: 'indústrias', industrial: 'industrial',
  ultimo: 'último', ultima: 'última', proximo: 'próximo', proxima: 'próxima',
  minimo: 'mínimo', minima: 'mínima', maximo: 'máximo', maxima: 'máxima',
  medio: 'médio', media: 'média', medias: 'médias', possivel: 'possível', possiveis: 'possíveis',
  responsavel: 'responsável', responsaveis: 'responsáveis', disponivel: 'disponível', disponiveis: 'disponíveis',
  vulneravel: 'vulnerável', vulneraveis: 'vulneráveis', confiavel: 'confiável', confiaveis: 'confiáveis',
  util: 'útil', uteis: 'úteis', facil: 'fácil', faceis: 'fáceis', dificil: 'difícil', dificeis: 'difíceis',
  rapido: 'rápido', rapida: 'rápida', unico: 'único', unica: 'única', proprio: 'próprio', propria: 'própria',
  saude: 'saúde', ciencia: 'ciência', ciencias: 'ciências', experiencia: 'experiência', experiencias: 'experiências',
  eficiencia: 'eficiência', competencia: 'competência', competencias: 'competências', frequencia: 'frequência',
  inteligencia: 'inteligência', emergencia: 'emergência', concorrencia: 'concorrência', governanca: 'governança',
  seguranca: 'segurança', confianca: 'confiança', mudanca: 'mudança', mudancas: 'mudanças', cobranca: 'cobrança',
  inicio: 'início', comercio: 'comércio', negocio: 'negócio', negocios: 'negócios', servico: 'serviço', servicos: 'serviços',
  preco: 'preço', precos: 'preços', esforco: 'esforço', esforcos: 'esforços', orcamento: 'orçamento', orcamentos: 'orçamentos',
  terceirizacao: 'terceirização', acao: 'ação', acoes: 'ações', talvez: 'talvez',
  ja: 'já', so: 'só', tres: 'três', seculo: 'século', decada: 'década', periodo: 'período',
  varios: 'vários', varias: 'várias', apos: 'após', atraves: 'através', ate: 'até', voce: 'você', voces: 'vocês',
  nao: 'não', entao: 'então', tambem: 'também', alem: 'além', porem: 'porém', ninguem: 'ninguém', alguem: 'alguém',
  padrao: 'padrão', padroes: 'padrões', razao: 'razão', razoes: 'razões', irmao: 'irmão',
  /* As de "-ção", "-são" e "-tão" repetidas aqui de propósito. Soltas, a regra de
     sufixo já as resolve; o dicionário existe para quando elas aparecem DENTRO de
     uma hashtag composta, onde nenhum sufixo casa: "#gestaodeestoque", o caso do
     documento 288. */
  gestao: 'gestão', automacao: 'automação', informacao: 'informação', operacao: 'operação',
  producao: 'produção', inovacao: 'inovação', programacao: 'programação', transformacao: 'transformação',
  comunicacao: 'comunicação', organizacao: 'organização', educacao: 'educação', integracao: 'integração',
  manutencao: 'manutenção', implementacao: 'implementação', certificacao: 'certificação', validacao: 'validação',
  migracao: 'migração', distribuicao: 'distribuição', reputacao: 'reputação', contratacao: 'contratação',
  capacitacao: 'capacitação', formacao: 'formação', atencao: 'atenção', protecao: 'proteção',
  descarbonizacao: 'descarbonização', digitalizacao: 'digitalização', adocao: 'adoção',
  previsao: 'previsão', decisao: 'decisão', versao: 'versão', dimensao: 'dimensão', expansao: 'expansão',
  revisao: 'revisão', supervisao: 'supervisão', inclusao: 'inclusão', conclusao: 'conclusão',
  tensao: 'tensão', extensao: 'extensão', pressao: 'pressão', sao: 'são', pao: 'pão',
  cidadao: 'cidadão', cidadaos: 'cidadãos', orfao: 'órfão', chao: 'chão', graos: 'grãos', mae: 'mãe',
};

const SEM_ACENTO = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

// Como estava escrito, assim fica: "Protecao" devolve "Proteção", "PROTECAO"
// devolve "PROTEÇÃO". Caixa alta inteira é sigla na maior parte das vezes, e por
// isso ela só é trocada quando a palavra está no dicionário ou no sufixo.
function comCaixa(original, certa) {
  if (original === original.toUpperCase()) return certa.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return certa[0].toUpperCase() + certa.slice(1);
  return certa;
}

function corrigePalavra(p) {
  const baixa = p.toLowerCase();
  // palavra que já tem acento em algum lugar fica como está: ela foi escrita de
  // propósito, e "Protecão" (meio certo) é problema de outra natureza
  if (SEM_ACENTO(p) !== p) return null;
  if (ESTRANGEIRO.test(baixa)) return null;
  if (PALAVRAS[baixa]) return comCaixa(p, PALAVRAS[baixa]);
  if (baixa.length >= MINIMO_SUFIXO) {
    for (const [re, troca] of SUFIXOS) {
      const m = baixa.match(re);
      if (!m) continue;
      /* Só o FIM da palavra é trocado, e o começo fica como estava. Medido em
         02/10 com as hashtags reais: baixando a palavra inteira,
         "#SegurancaDaInformacao" virava "#Segurancadainformação" e o maiúsculo
         do meio, que é o que deixa a hashtag legível, ia embora. */
      const inicio = p.slice(0, p.length - m[0].length);
      return inicio + (p === p.toUpperCase() ? troca.toUpperCase() : troca);
    }
  }
  return null;
}

/* As palavras sem acento de um texto, para o fiscal apontar. Devolve pares
   [como está, como deveria]. */
export function semAcento(texto) {
  const achados = new Map();
  for (const m of String(texto).matchAll(/[A-Za-zÀ-ÿ]{2,}/g)) {
    const certa = corrigePalavra(m[0]);
    if (certa && certa !== m[0]) achados.set(m[0], certa);
  }
  return [...achados].map(([como, deveria]) => ({ como, deveria }));
}

/* A troca de verdade, para título e hashtag, que são curtos e controlados. */
export function comAcento(texto) {
  return String(texto).replace(/[A-Za-zÀ-ÿ]{2,}/g, (p) => corrigePalavra(p) || p);
}

/* A linha de hashtags é um caso próprio: "#gestaodeestoque" é uma palavra só
   para o regex de cima, e nenhuma regra pega "gestao" no meio dela. Aqui as
   palavras do dicionário são procuradas DENTRO da hashtag, da mais longa para a
   mais curta, para "gestao" não ser trocada antes de "gestaodeestoque" ter
   chance de casar inteira. */
/* Uma alternativa só, da palavra mais longa para a mais curta, e UMA passada.
   Em duas passadas "#AutomacaoIndustrial" virava "#AutomaçãoIndústrial": a
   palavra "industria" casava dentro de "Industrial" depois de "industrial" já
   ter passado. Numa alternação o motor de regex escolhe a primeira que casa em
   cada posição, e a posição consumida não é visitada de novo. */
const DENTRO = Object.keys(PALAVRAS).filter((p) => p.length >= 4).sort((a, b) => b.length - a.length);
const RE_DENTRO = new RegExp(DENTRO.join('|'), 'gi');

export function hashtagComAcento(tag) {
  const bruta = String(tag);
  const corpo = bruta.replace(/^#/, '');
  if (SEM_ACENTO(corpo) !== corpo) return bruta;
  let saida = corpo.replace(RE_DENTRO, (achado) => comCaixa(achado, PALAVRAS[achado.toLowerCase()]));
  // sufixo no fim da hashtag composta: "#gestaodeestoque" não casa inteira, e
  // depois da troca de dentro o que sobra pode ainda terminar em "cao"/"oes"
  for (const [re, troca] of SUFIXOS) {
    if (!re.test(saida.toLowerCase())) continue;
    saida = saida.replace(new RegExp(re.source, 'i'), (achado) => comCaixa(achado, troca));
    break;
  }
  return `#${saida}`;
}
