// O fiscal da peça final. No primeiro expediente completo, o Analista inventou
// "12% de falsos negativos", o Auditor não pegou, e o Diretor publicou o número
// com mais dois que também não existiam em fonte nenhuma. O Auditor é um modelo,
// e modelo deixa passar. Então a última checagem é por código.
//
// A bancada não tem acesso à internet: só vê a pauta e os títulos das fontes. Todo
// número do texto que não aparece nesse material veio da memória do modelo ou foi
// inventado. Nos dois casos, alguém precisa conferir antes de publicar.

const NUMERO = /(?:R\$|US\$|€|\$)\s?\d[\d.,]*(?:\s?(?:bilh|milh|mil|bi\b|mi\b)\w*)?|\d+(?:[.,]\d+)?\s?(?:%|por cento|pontos percentuais|p\.p\.)|\d+(?:[.,]\d+)?\s?(?:vezes|x\b)|\b(?:duas|três|quatro|cinco|seis|sete|oito|nove|dez)\s+vezes\b/gi;

const EXTENSO = { duas: 2, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

// "12,5%" e "12.5 %" viram "12.5"; "US$ 3,9 bilhões" vira "3.9"; "quatro vezes" vira "4"
function valor(trecho) {
  const t = trecho.toLowerCase();
  const ext = t.match(/^(duas|três|quatro|cinco|seis|sete|oito|nove|dez)\s+vezes/);
  if (ext) return String(EXTENSO[ext[1]]);
  const d = t.match(/\d[\d.,]*/);
  if (!d) return null;
  let n = d[0].replace(/[.,]$/, '');
  // separador de milhar brasileiro (1.500) contra decimal (3.9): só é milhar se
  // vier seguido de exatamente três dígitos
  if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, '');
  return n.replace(',', '.');
}

function valoresDe(bruto) {
  // Os códigos dos itens ([n04]) e as URLs estão cheios de dígitos que não são
  // dado: com eles, "n04" validava "quatro vezes" no primeiro teste real.
  const texto = String(bruto).replace(/https?:\/\/\S+/g, ' ').replace(/\bn\d{2}\b/g, ' ');
  const achados = new Set();
  for (const m of texto.matchAll(/\d[\d.,]*/g)) {
    const v = valor(m[0]);
    if (v) { achados.add(v); achados.add(String(Number(v))); }
  }
  for (const [p, n] of Object.entries(EXTENSO)) if (new RegExp(`\\b${p}\\b`, 'i').test(texto)) achados.add(String(n));
  return achados;
}

// Devolve os números da peça que não aparecem em nenhuma fonte, com o trecho em volta.
export function numerosSemFonte(peca, fontes) {
  const conhecidos = valoresDe(fontes);
  const vistos = new Map();
  for (const m of String(peca).matchAll(NUMERO)) {
    const v = valor(m[0]);
    if (!v || conhecidos.has(v) || conhecidos.has(String(Number(v)))) continue;
    if (vistos.has(m[0].trim())) continue;
    const ini = Math.max(0, m.index - 60);
    const trecho = String(peca).slice(ini, m.index + m[0].length + 40).replace(/\s+/g, ' ').trim();
    vistos.set(m[0].trim(), trecho);
  }
  return [...vistos].map(([numero, trecho]) => ({ numero, trecho }));
}

export function travessoes(texto) {
  return (String(texto).match(/[—–]/g) || []).length;
}

// O modelo ignora a regra do travessão mesmo quando o fiscal pede a correção: no
// teste do ao vivo ele devolveu o texto igual, com oito. Então troca por código.
//   "**Rótulo** – texto"          ->  "**Rótulo**: texto"
//   "a análise — que compara — por" ->  "a análise, que compara, por"
//   qualquer outro                 ->  vírgula
// Hífen de palavra composta (pré-operatório) não é travessão e não é tocado.
/* O título da lista, sem as marcas de markdown que sobram.
   Em 25/09 o documento 177 apareceu na lista como "# O patch às pressas ou o
   risco documentado": o Diretor escreveu dois "#" na linha do título e a
   extração levou o segundo junto. Também tira o fecho "###" que alguns estilos
   de markdown põem no fim da linha, e o negrito, pela mesma razão. */
export function tituloLimpo(texto) {
  return String(texto || '')
    .replace(/^[\s#]+/, '')
    .replace(/[\s#]+$/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function semTravessao(texto) {
  return String(texto)
    .replace(/(\*\*[^*\n]+\*\*)\s*[—–]\s*/g, '$1: ')
    .replace(/\s+[—–]\s+([^—–\n]{1,160}?)\s+[—–]\s+/g, ', $1, ')
    // rótulo sem negrito só em item de lista: numa frase comum, virava dois pontos errado
    .replace(/^(\s*(?:[-*]|\d+[.)])\s+[^\n—–]{1,60}?)\s+[—–]\s+/gm, '$1: ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.;:!?])/g, '$1');
}

/* ---------- o post saiu em inglês ----------
   Aconteceu no documento 51: fontes em inglês e o modelo respondeu na língua
   delas. Como quase todo post tem termo técnico em inglês ("machine learning",
   "forecast"), a conta é por palavra funcional, que só aparece em frase inglesa
   de verdade. */
const FUNCIONAIS = /\b(the|and|of|with|that|for|from|this|these|are|is|was|were|have|has|had|will|would|can|could|their|which|been|than|about|into|through)\b/gi;

export function pareceIngles(texto) {
  const limpo = String(texto).replace(/https?:\/\/\S+/g, ' ').replace(/#\S+/g, ' ');
  const palavras = limpo.split(/\s+/).filter(Boolean).length;
  if (palavras < 25) return false;
  const achadas = (limpo.match(FUNCIONAIS) || []).length;
  return achadas / palavras > 0.06;
}

/* ---------- fecho que não responde ----------
   Achado da auditoria de leitura em 30/09: no documento 288 a Leitora perguntou
   "qual alavanca eu puxo quando a ruptura bater a meta?" e o texto terminou
   devolvendo a mesma pergunta ao leitor. Pergunta no fim é boa para comentário,
   mas ela não pode OCUPAR o lugar da resposta: quem leu até ali ficou sem nada
   para fazer na segunda-feira.

   A regra, e ela é de uma coisa só: o fecho tem que ter uma REGRA DE DECISÃO
   (uma condição e o que fazer sob ela) ou dizer EXPLICITAMENTE o que ficou sem
   resposta e por quê. Qualquer uma das duas serve, e as duas são frases que o
   código reconhece pela marca.

   Heurística, e assumida como tal: ela não entende o argumento, procura a marca
   da condição e a marca da pendência. Por isso não barra publicação, só pede
   correção: errar pedindo conserto custa uma rodada; errar barrando joga fora um
   documento bom. */
// os imperativos que fecham um post de ofício. Lista, e não regra de
// morfologia: "renegocie" e "centralize" terminam como substantivo, e inventar
// detector de imperativo em português daria mais erro que a lista.
const ACAO = '(fa[çc]a|prefira|troque|comece|exija|pare|mude|invista|segure|puxe|priorize|escolha|mantenha|corte|pe[çc]a|negocie|renegocie|me[çc]a|ajuste|reduza|aumente|reveja|revise|documente|automatize|centralize|distribua|contrate|treine|pague|cobre|trave|libere|mova|migre|teste|adote|amarre|separe|junte|publique|avise|espere|aceite|recuse|assuma|proteja|monitore|limite|defina|escreva|calcule|conte)';
const REGRA_DE_DECISAO = new RegExp([
  // condição explícita seguida do que fazer
  `se\\b[^.!?\\n]{5,120}\\b(ent[ãa]o|,\\s*${ACAO})`,
  `quando\\b[^.!?\\n]{5,100}\\b${ACAO}`,
  `enquanto\\b[^.!?\\n]{5,80}\\b(${ACAO}|n[ãa]o)`,
  // limite numérico ou de tamanho, que é a forma que o ofício mais usa
  `(acima|abaixo) de[^.!?\\n]{0,60}\\b(${ACAO}|passa a|vale|compensa|j[áa] n[ãa]o|n[ãa]o vale|n[ãa]o compensa)`,
  `at[ée]\\b[^.!?\\n]{0,40}\\b(${ACAO}|vale)`,
  // a regra dita como regra
  'a regra (é|e|pr[áa]tica)', 'o crit[ée]rio (é|e)', 'comece (por|pelo|pela)\\b', 'primeiro[^.!?\\n]{0,40}\\bdepois\\b',
].join('|'), 'i');
/* A pendência declarada. A primeira versão desta lista apontou 190 de 325 posts
   reais, e a amostra mostrou que a lista estava estreita, não que os posts
   estavam ruins: "Não definimos um modelo universal", "Ainda não ficou definido
   como", "A mesa não definiu um modelo padrão" são exatamente a declaração que a
   regra pede, e nenhuma casava. Medido de novo depois de ampliar. */
const PENDENCIA_DECLARADA = new RegExp([
  'ficou sem resposta', 'fica sem resposta', 'fica em aberto', 'segue em aberto', 'permanece em aberto',
  'n[ãa]o (temos|h[áa]|existe|existem) (dado|dados|n[úu]mero|n[úu]meros|evid[êe]ncia|resposta|consenso|m[ée]trica)',
  'n[ãa]o (definimos|definiu|definiram|chegamos|chegou|fechou|fecharam|resolveu|resolvemos|mediu|medimos|sabemos|se sabe|est[áa] (claro|medido|definido|respondido))',
  '(ainda )?n[ãa]o (ficou|est[áa]) (claro|definido|medido|respondido|fechado)',
  'ningu[ée]m (mediu|sabe|soube|respondeu)', 'falta (medir|dado|evid[êe]ncia|n[úu]mero)',
  'sem (dado|evid[êe]ncia|n[úu]mero) (p[úu]blico|para|que)', 'sem consenso',
  'a pergunta que (fica|segue|sobra)', 'o que (ficou|fica) sem resposta', 'n[ãa]o h[áa] resposta (única|unica|pronta|fechada)',
  'depende do (contexto|caso|setor|tamanho)', 'varia (muito )?(com|conforme|de acordo)',
].join('|'), 'i');

/* O fim do post: as últimas linhas, que é onde o fecho vive. Sem contar a linha
   de hashtags, que não é texto. */
export function fechamentoSemSaida(post, letras = 700) {
  const limpo = String(post).replace(/\n#[\p{L}\p{N}_\s#]+$/u, '').trim();
  const fim = limpo.slice(-letras);
  return !REGRA_DE_DECISAO.test(fim) && !PENDENCIA_DECLARADA.test(fim);
}

/* ---------- testemunho que ninguém viveu ----------
   Achado da auditoria de leitura em 30/09: o documento 288 abriu com "Vi a
   promessa de entrega em 48 horas derrubar o estoque de segurança", e quem
   escreveu aquilo não tem operação, não tem cliente e não tem passado. É a pior
   mentira possível neste projeto, porque é a única que o leitor não tem como
   conferir: número sem fonte o fiscal pega, testemunho inventado não deixa
   rastro.

   A trava vale para o TEXTO PUBLICADO, não para a mesa. Na mesa os especialistas
   falam da prática deles de propósito, e é disso que o formato vive; o que não
   pode é a primeira pessoa daquela conversa atravessar para o post, que é
   assinado pela casa e lido por quem não assistiu à discussão.

   Caso ilustrativo continua permitido, marcado como hipótese ("imagine uma
   operação em que..."), e por isso a marca de hipótese na mesma frase desarma a
   trava. */
const PRIMEIRA_PESSOA = /\b(eu (vi|vivi|presenciei|acompanhei|atendi|trabalhei|passei por|peguei)|j[áa] (vi|vivi|presenciei|peguei|atendi)|vi (isso|essa|esse|aquilo|a |o |um |uma )|na minha (empresa|opera[çc][ãa]o|equipe|[áa]rea|experi[êe]ncia)|no meu (time|cliente|setor|trabalho)|num cliente que (eu )?atend|cliente meu|me aconteceu|aconteceu comigo|na (empresa|opera[çc][ãa]o|companhia) (em que|onde) (eu )?(trabalh|estav|atuav))/gi;
const HIPOTESE = /\b(imagine|suponha|digamos|hipot[ée]tic|por hip[óo]tese|pense n[ao])\b/i;

export function experienciaPessoal(texto) {
  const achados = [];
  for (const m of String(texto).matchAll(PRIMEIRA_PESSOA)) {
    // a frase inteira em volta: hipótese marcada no começo dela desarma a trava
    const inicio = String(texto).lastIndexOf('.', m.index) + 1;
    const fim = String(texto).indexOf('.', m.index);
    const frase = String(texto).slice(inicio, fim === -1 ? undefined : fim);
    if (!HIPOTESE.test(frase)) achados.push(m[0].trim());
  }
  return [...new Set(achados)];
}

/* ---------- a cena da imagem ----------
   Pedido do Rubens em 24/09: "todo prompt tem alguma coisa de data center, está
   ficando repetitivo". A causa era o Designer receber só o texto do post, sem a
   área e sem saber o que a casa já tinha gerado: sobre um texto de tecnologia
   ele cai no cenário padrão de tecnologia.

   O conserto de verdade é o Designer passar a receber o tema, o cenário da área
   e as cenas recentes. Isto aqui é a trava que confere se ele obedeceu.

   Tentei antes medir repetição por semelhança entre as cenas, como a trava de
   tema faz. Medido no mesmo dia: duas cenas de data center escritas de formas
   diferentes deram 0.00, porque o que se repete é o MOTIVO e não as palavras. O
   vão entre repetido e diferente ficou estreito demais para um limiar, então a
   trava virou lista fechada, que é o que a casa usa quando a medida não separa. */

// A cena é a primeira coisa que o prompt nomeia. Serve para mostrar ao Designer
// o que já foi feito, sem despejar o prompt inteiro (que é quase todo igual de
// propósito: o filme e o grão são a identidade visual da casa).
const PREAMBULO = /\b(documentary|editorial|photograph|photography|photo|image|shot|taken|candid|realistic)\b/gi;

export function cenaDe(prompt) {
  const linha = String(prompt || '')
    .replace(/\*\*/g, '')
    .split('\n').map((l) => l.trim())
    .find((l) => /^(imagem|image)\s*:/i.test(l) || l.length > 40) || '';
  return linha.replace(/^(imagem|image)\s*:/i, '').replace(PREAMBULO, ' ')
    // o trim vem ANTES de tirar "of a": o preâmbulo removido deixa espaço na
    // frente, e com ele o ^ da expressão nunca casava
    .replace(/\s+/g, ' ').trim().replace(/^(?:(?:of|a|an|the)\s+)+/i, '')
    // corta no primeiro marcador de câmera, filme ou luz: dali em diante o prompt
    // é a identidade visual da casa, igual em todos, e não diz nada da cena
    .split(/\b(?:\d{2}mm|kodak|portra|fuji|ilford|natural grain|available light|golden hour|overcast)\b/i)[0]
    .split(/[.;]/)[0]
    .replace(/[\s,]+(?:on|in|with|at|under)?[\s,]*$/i, '')
    .trim().slice(0, 120);
}

/* O cenário genérico de tecnologia: lista fechada, como a de conteúdo
   patrocinado. Ele só pode aparecer quando o assunto for LITERALMENTE aquilo,
   e quem decide isso é o texto do post, não o Designer. */
const CENA_GENERICA = /\b(data ?cent(er|re)s?|server (rack|room|farm|aisle)s?|rows of (servers|racks)|blinking (led|leds|lights)|network operations cent(er|re)|wall of (monitors|screens)|glowing screens?)\b/i;

export function cenaGenerica(prompt, contexto) {
  const achado = String(prompt || '').match(CENA_GENERICA);
  if (!achado) return null;
  return CENA_GENERICA.test(String(contexto || '')) ? null : achado[0];
}
