// O trabalho ao vivo. Roda por um turno longo e, ao terminar, o próprio workflow
// chama o próximo: a bancada não depende da agenda do GitHub, que em 19/09 pulou
// quase todos os horários e deixou o escritório parado horas seguidas.
//
// Cada passo é publicado no instante em que acontece, com a hora de início e a
// velocidade da escrita. Quem abre o site no meio vê o texto no ponto exato em
// que ele está, porque a tela calcula quanto já foi "digitado" pelo relógio.
// O motor espera a escrita terminar antes do passo seguinte: é isso que faz o
// ritmo ser de gente trabalhando, e não de máquina despejando texto.
//
// A bancada pública trabalha das 7h à meia-noite. De madrugada ela descansa, o
// Diretor monta a pauta do dia e os pedidos do administrador são atendidos. Fora
// disso, só para quando a cota gratuita acaba ou num pedido "para hoje".
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gerar, liberaCotas, zeraConsumo, consumo } from '../src/llm.mjs';
import { pesquisar, empresasCitadas, veiculosCitados, semFontesRetiradas } from '../src/pesquisa.mjs';
import { numerosSemFonte, semTravessao, pareceIngles, cenaDe, cenaGenerica, tituloLimpo, experienciaPessoal, fechamentoSemSaida } from '../src/fiscal.mjs';
import { comAcento } from '../src/acentos.mjs';
import { paraLinkedin } from '../src/linkedin.mjs';
import { parecido } from '../src/memoria.mjs';
import { separa } from '../src/vault.mjs';
import { lerEquipe } from '../bancada/equipe.mjs';
import { destinoPadrao } from './destino.mjs';
import { novoDiario, anota, marcasDoFiscal } from './diario.mjs';
import { acrescenta, monta, VERSAO } from './indice.mjs';
import { pauta, filtraBacklog, filtraSugestoes, SCHEMA_BACKLOG, SCHEMA_SUGESTOES } from './reuniao.mjs';
import { filtraPautas, proximaPauta, marcaUsada, backlogDaArea, quantoSobrou, domingoDaSemana, parecidoNaFila, SCHEMA_PAUTAS, POR_AREA, LIMIAR, LIMIAR_AREA } from './pautas.mjs';
import { leEspecialistas, confereBancadas, montaBancada, temSubstancia, contestou, ecoDeAbertura, resumoDaMesa, ECO_PADRAO } from './bancadas.mjs';
import { foraDaArea } from './areas.mjs';

const RAIZ = join(import.meta.dirname, '..');
// data e hora em São Paulo, sem importar o publicar.mjs, que arrastaria o comitê
// junto para o repositório público do motor
const hoje = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
for (const l of (await readFile(join(RAIZ, '.env'), 'utf8').catch(() => '')).split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1').trim();
}
process.env.SO_GROQ = '1';

/* ---------- ritmo ----------
   8 letras por segundo. Eram 20, que dá umas 240 palavras por minuto: o limite
   de leitura de um adulto, ou seja, quem assistia só conseguia acompanhar sem
   nenhuma folga. A 8 são ~96 palavras por minuto, abaixo da leitura, e dá para
   ler pensando em vez de correr atrás.

   Pedido do Rubens em 23/09: "se demorar 1 hora e ficar bom tá ótimo". O tempo
   foi gasto DENTRO do documento e não no vão entre documentos, porque tela
   parada não é espetáculo: um documento passou de 12 para 25 minutos de tela,
   e o silêncio entre eles encolheu. */
const CPS = Number(process.env.CPS) || 8;
const DURACAO_MIN = Number(process.env.DURACAO_MIN) || 50;
// TESTE_RAPIDO encurta só as esperas, para conferir o fluxo; as chamadas são reais
const FATOR = process.env.TESTE_RAPIDO ? 0.03 : 1;
const RESPIROS = [7, 11, 13, 17];
/* Minutos entre o começo de um documento e o do próximo, contados do início de
   um ao início do outro. Como o documento em si passou a levar uns 25 minutos de
   tela, os 35 daqui deixam um vão de uns 10 minutos, menor que o de antes.

   Medido em 23/09 com o mesmo pipeline dos dois lados: sem mesa, 5 chamadas e
   3.248 tokens de entrada por documento; com a mesa de cinco vozes conversando
   em sequência, 10 chamadas e 5.455. São 68% a mais, e não os 25% da primeira
   versão da mesa: ali eram quatro monólogos paralelos, e aqui cada um recebe o
   que os anteriores disseram, então a conversa cresce enquanto anda.

   Serve também à cota: a 35 minutos cabem umas 29 peças nas 17 horas de
   expediente, o que deixa folga nos 200 mil tokens por dia de cada modelo do
   Groq. Para mexer, a variável INTERVALO_MIN no ambiente. */
const INTERVALO_MIN = Number(process.env.INTERVALO_MIN) || 35;

/* Quantos dias de memória de tema o Diretor recebe da própria área. Trinta, que
   foi o pedido da auditoria de leitura: a 29 documentos por dia entre nove áreas,
   um mês dá uns 95 documentos e uns 10 por área, o bastante para ele reconhecer o
   que já discutiu. */
const DIAS_DE_MEMORIA = Number(process.env.DIAS_DE_MEMORIA) || 30;

/* Quanto antes do fim do turno o motor para de PEGAR trabalho novo. Eram 20
   minutos, calibrados para documento de 12; com 25 minutos de documento, um
   começado no limite terminaria perto demais do corte de 6 horas do GitHub, e
   um documento cortado no meio deixa a tela congelada.
   Sair mais cedo não custa nada: o turno seguinte é chamado na hora em que este
   termina, então adiantar a saída só adianta o próximo. */
const MARGEM_FIM_MIN = Number(process.env.MARGEM_FIM_MIN) || 40;
let inicioDoDocumento = 0;
const LIMITE_POST = 2800;
const ECO_MESA = Number(process.env.ECO_MESA) || ECO_PADRAO;

const dorme = (s) => new Promise((ok) => setTimeout(ok, s * 1000 * FATOR));
const agora = () => new Date().toISOString();
const respiro = () => RESPIROS[Math.floor(Math.random() * RESPIROS.length)];
const log = (m) => console.log(`${agora().slice(11, 19)} ${m}`);

const destino = await destinoPadrao(RAIZ);

/* ---------- o diário do dia ----------
   Toda vez que o trabalho volta atrás, fica registrado. O turno carrega o diário
   do dia ao começar, para um turno novo (ou religado pelo vigia) continuar a
   lista em vez de apagá-la, e grava depois de cada anotação: se o processo cair,
   perde-se no máximo o episódio em curso.
   Dois turnos ao mesmo tempo se sobrescreveriam, mas o workflow só deixa um
   rodar por vez, e um episódio perdido não estraga a contagem da semana. */
let diario = (await destino.diario(hoje()).catch(() => null)) || novoDiario(hoje());
if (!Array.isArray(diario.episodios)) diario = novoDiario(hoje());

async function registra(tipo, dados = {}) {
  try {
    if (diario.data !== hoje()) diario = novoDiario(hoje());
    if (anota(diario, tipo, dados)) await destino.gravaDiario(diario);
  } catch (e) {
    // o diário é observação, não produção: se ele falhar, a bancada segue
    log(`diário não gravou (${tipo}): ${e.message}`);
  }
}

/* ---------- o elenco do dia ----------
   Em alguns dias da semana uma cadeira troca de dono: um estagiário, um
   plantonista, uma revisora convidada. O sorteio sai da data, então o turno que
   começa à tarde encontra o mesmo elenco que o da manhã. O substituto herda o
   papel inteiro da cadeira e só acrescenta o jeito dele de trabalhar. */
function sorteioDoDia(data) {
  let h = 2166136261;
  for (const c of data) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

async function elencoDoDia() {
  const { equipe, diretor } = await lerEquipe(join(RAIZ, 'aovivo', 'equipe'));
  const dir = join(RAIZ, 'aovivo', 'elenco');
  const subs = [];
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.md')).sort()) {
    const { meta, corpo } = separa(await readFile(join(dir, f), 'utf8'));
    if (meta.substitui && corpo) subs.push({ ...meta, corpo });
  }
  const s = sorteioDoDia(process.env.ELENCO_DIA || hoje());
  // 3 em cada 7 dias tem troca: "alguns por semana", sem dia fixo
  const troca = subs.length && s % 7 < 3 ? subs[(s >>> 3) % subs.length] : null;
  const cadeiras = equipe.map((a) => {
    if (!troca || troca.substitui !== a.id) return { ...a, titular: a.nome };
    return { ...a, titular: a.nome, nome: troca.nome, estagiario: !!troca.estagiario, substituto: true, papel: `${a.papel}\n\n## Hoje nesta cadeira\n\n${troca.corpo}` };
  });
  return { equipe: cadeiras, diretor, troca };
}

let elenco = await elencoDoDia();
let diaDoElenco = hoje();
// TITULARES é quem tem a cadeira; A é quem a está ocupando NESTE documento, que
// muda com o tema. Antes as duas coisas eram a mesma, e por isso eram uma variável só.
let TITULARES = Object.fromEntries([...elenco.equipe, elenco.diretor].map((a) => [a.id, a]));
let A = TITULARES;

const ESPECIALISTAS = await leEspecialistas(join(RAIZ, 'aovivo', 'especialistas'));
// falha no arranque, e não no meio de um documento, se uma bancada citar alguém que não existe
confereBancadas(ESPECIALISTAS);

const elencoParaTela = () => Object.values(A).map((a) => ({ id: a.id, nome: a.nome, titular: a.titular || a.nome, cargo: a.cargo || '', estagiario: !!a.estagiario, substituto: !!a.substituto, especialista: !!a.especialista }));

/* Quem senta neste documento. Tema com bancada própria troca as três cadeiras
   pelos especialistas dele; tema sem bancada mantém os titulares. */
function sentaBancada(area, numero) {
  if (!area?.bancada) { A = TITULARES; return null; }
  const b = montaBancada({ tema: area.bancada, numero, titulares: TITULARES, especialistas: ESPECIALISTAS });
  if (!b) { A = TITULARES; return null; }
  A = { ...TITULARES, ...b.agentes };
  return b;
}

/* ---------- o palco ----------
   Público ou privado. No público, o que acontece vai para aovivo/estado e todo
   mundo vê. Num pedido do administrador, o trabalho vai para privado/estado e a
   tela pública só mostra o aviso. */
const turno = { inicio: agora(), fim_previsto: new Date(Date.now() + DURACAO_MIN * 60000).toISOString() };
const novoEstado = () => ({ turno, modo: 'publico', aviso: null, atual: null, trilha: [], peca: null, cps: CPS, elenco: elencoParaTela() });
let E = novoEstado();
let privado = false;
const publica = () => { E.atualizado = agora(); return privado ? destino.estadoPrivado(E) : destino.estado(E); };

// A tela pública parada com um aviso: cota, pauta do dia ou modo privado
async function avisoPublico(modo, aviso, acao) {
  await destino.estado({
    turno, modo, aviso, cps: CPS, elenco: elencoParaTela(), trilha: [], peca: null, atualizado: agora(),
    atual: { agente: 'Diretor', id: 'diretor', acao: acao || aviso, texto: '', pensando: true, inicio: agora() },
  });
}

/* ---------- interrupção ----------
   Pedido "para hoje" do administrador para a bancada na hora, no meio do que
   estiver fazendo. A conferência é um documento só no banco, lido no máximo a
   cada 20 segundos. */
class Interrompido extends Error {}
let ultimaConferencia = 0;
async function confereInterrupcao() {
  if (privado || Date.now() - ultimaConferencia < 20000 * FATOR) return;
  ultimaConferencia = Date.now();
  const u = await destino.urgente().catch(() => null);
  if (u?.id) throw new Interrompido(u.id);
}

/* O crachá de quem está agindo AGORA, e só dele.
   Achado da auditoria de leitura em 30/09: o texto da Logística aparecia sob o
   nome de Varejo, e o da Pessoas sob o de Comercial. A causa era o elenco ser
   remontado dos titulares no meio do documento: o balão continuava com o texto
   de quem falou e o nome em cima dele voltava para o dono da cadeira.

   A regra que conserta: o nome do posto é o de quem escreveu o que está no
   balão. Então quem entra em cena carrega o próprio nome para a cadeira dele, os
   outros postos ficam como estavam, e a volta aos titulares acontece uma vez só,
   quando o documento seguinte senta a bancada nova. */
function poeNaCena(agente) {
  if (!agente?.id) return;
  E.elenco = (E.elenco || elencoParaTela()).map((x) => (x.id === agente.id
    ? { ...x, nome: agente.nome || x.nome, cargo: agente.cargo || x.cargo, especialista: !!agente.especialista }
    : x));
}

// alguém pensando: a tela mostra o agente concentrado, sem texto ainda
async function pensa(agente, acao) {
  await confereInterrupcao();
  poeNaCena(agente);
  E.atual = { agente: agente.nome, id: agente.id, acao, texto: '', pensando: true, inicio: agora() };
  await publica();
  log(`${agente.nome}: ${acao}…`);
}

// alguém escrevendo: publica o texto inteiro com a hora de início, e espera o
// tempo que a escrita leva na tela antes de seguir
async function escreve(agente, acao, bruto) {
  await confereInterrupcao();
  // travessão sai por código antes de ir para a tela: o modelo ignora a regra
  const texto = semTravessao(bruto);
  poeNaCena(agente);
  E.atual = { agente: agente.nome, id: agente.id, acao, texto, pensando: false, inicio: agora() };
  await publica();
  log(`${agente.nome}: ${acao} (${texto.length} letras, ${Math.round(texto.length / CPS)}s de escrita)`);
  await dorme(texto.length / CPS + respiro());
  E.trilha.push({ agente: agente.nome, id: agente.id, acao, resumo: texto.replace(/\s+/g, ' ').slice(0, 180), fim: agora() });
  E.trilha = E.trilha.slice(-14);
}

const chama = (agente, prompt, schema = null) => gerar({ modelo: agente.modelo, sistema: agente.papel, prompt, temperatura: agente.temperatura, schema });
// quanto de cada fonte cabe no pedido: o Gemini lê o texto quase inteiro, o Groq
// tem 8 mil tokens por minuto e precisa do trecho curto
const letrasPara = (agente, curto) => (String(agente.modelo).trim().startsWith('gemini') ? curto * 3 : curto);
const FISCAL = { nome: 'Fiscal', id: 'fiscal' };

/* ---------- as áreas ----------
   Escolhida pelo código, em rodízio pelo número do documento: deixada ao modelo,
   a bancada escreveu 14 de 15 documentos sobre IA.

   "ativo" liga e desliga um tema sem apagá-lo. Em 23/09 os quatro primeiros
   foram dormir por uma semana para arejar a pauta, e voltam ligando a marca de
   novo: os 140 documentos já publicados neles continuam no blog, e o filtro por
   tema continua funcionando.

   "bancada" diz qual equipe senta neste tema (aovivo/bancadas.mjs). Tema sem
   bancada usa a equipe titular, que é como a casa funcionava antes. */
const AREAS = [
  /* As quatro da redação, religadas em 30/09 a pedido do Rubens. Elas não têm
     bancada: tema sem bancada cai na equipe titular e no formato de redação, que
     é como a casa funcionava até 23/09. As duas formas convivem, sorteadas a
     cada documento, e cada uma fica no seu tema. */
  {
    nome: 'Tecnologia', ativo: true,
    foco: 'infraestrutura, software, telecom, chips, dados, nuvem, segurança digital, energia e hardware',
    cenario: 'o lugar onde a infraestrutura encosta no mundo: a sala de equipamentos com a porta aberta, o poste com cabo novo na rua, a antena no alto do prédio, a bancada de teste com a placa exposta, o caminhão de fibra na calçada, o galpão em obra que vai virar central de dados',
    palavras: 'nuvem servidor servidores chip chips processador rede banda fibra antena satélite telecom infraestrutura hardware armazenamento dispositivo equipamento conexão',
    regra: 'O post diz o que muda para quem usa e para quem paga a conta. Tecnologia sem consequência operacional não vira documento.',
  },
  {
    nome: 'Mundo corporativo', ativo: true,
    foco: 'gestão, trabalho, liderança, produtividade, governança, mercado e regulação que muda a vida das empresas, sempre com o ângulo de tecnologia ou transformação',
    cenario: 'onde a decisão de empresa acontece: a sala de reunião com a mesa grande, o corredor antes da reunião, a assinatura de um documento impresso, o auditório de um anúncio interno, a mesa de quem está lendo um comunicado no celular',
    palavras: 'empresa empresas gestão governança conselho diretoria regulação regulatório mercado setor produtividade política norma fusão investimento orçamento auditoria',
    regra: 'O ângulo é o que muda na prática de quem trabalha, não o movimento do mercado em si. Toda mudança vem com quem ganha e quem perde.',
  },
  {
    nome: 'Inteligência artificial', ativo: true,
    foco: 'modelos, uso em setores, regulação, custos, riscos e pesquisa em IA',
    cenario: 'onde a IA já está em uso por gente de verdade: o atendente com a sugestão na tela, o laudo conferido por quem assina, o operador acompanhando um painel de recomendação, a sala de aula usando a ferramenta, a reunião decidindo se adota ou não',
    palavras: 'inteligência artificial modelo modelos algoritmo inferência prompt agente agentes automação generativa neural token alucinação copiloto assistente',
    regra: 'Nada de futurologia. O post fala do que já está em uso ou do que a pesquisa mostrou, com o custo e o risco junto do benefício.',
  },
  {
    nome: 'Inovação', ativo: true,
    foco: 'pesquisa aplicada, ciência, novos materiais, saúde, agro, indústria, cidades, startups (sem nome) e políticas de inovação',
    cenario: 'onde a pesquisa encosta na aplicação: a bancada de laboratório com a amostra na mão, a estufa experimental, o piloto instalado na fábrica, o canteiro de uma obra urbana, o campo com o sensor fincado na terra, o protótipo em cima da mesa',
    palavras: 'pesquisa ciência científico laboratório material materiais patente protótipo indústria industrial agro agrícola saúde clínico cidade urbano renovável biotecnologia',
    regra: 'Separe o que já funciona fora do laboratório do que ainda é promessa. Inovação sem prazo e sem custo é anúncio, não documento.',
  },

  {
    nome: 'Programação', ativo: true, bancada: 'programacao',
    foco: 'linguagens que estão ganhando uso de verdade, ferramenta que muda o dia de quem escreve código, prática que economiza trabalho, curiosidade de linguagem e armadilha conhecida',
    // onde este tema acontece no mundo físico, para o Designer não cair no
    // cenário genérico de tecnologia (ver aovivo/equipe/designer.md)
    cenario: 'a mesa de quem escreve código, mas também o que existe FORA da tela: o quadro branco no meio de uma revisão, o diagrama impresso e rabiscado, a dupla discutindo em pé, o caderno de anotação ao lado do teclado, o crachá novo de quem entrou esta semana, a sala de reunião às onze da noite antes de um corte de versão',
    // o vocabulário que a trava de área usa (aovivo/areas.mjs); é lista de
    // classificador, não briefing: serve para dizer de quem é o tema
    palavras: 'código codigo linguagem linguagens framework biblioteca compilador build refatoração bug depuração sintaxe backend frontend função tipagem pacote dependência versão deploy legado',
    // pedido do Rubens em 23/09: o post tem que deixar claro de que lado está
    regra: 'Diga no texto se o assunto é de BACK END ou de FRONT END, e por quê. Se ele toca nos dois, separe o que muda de cada lado. Assunto de linguagem só vale com o problema que ela resolve e o custo de adotar.',
  },
  {
    nome: 'Dados e Analytics', ativo: true, bancada: 'dados',
    foco: 'análise de dados no trabalho, modelagem, qualidade de dado, visualização, ferramentas de BI e o que muda para quem monta relatório e decide por ele',
    // onde este tema acontece no mundo físico, para o Designer não cair no
    // cenário genérico de tecnologia (ver aovivo/equipe/designer.md)
    cenario: 'onde o número é LIDO e vira decisão, não onde ele é calculado: a reunião com o painel projetado, o relatório impresso com anotação à mão, o gerente conferindo o tablet no meio da operação, a planilha aberta ao lado de uma xícara vazia numa mesa de fechamento de mês',
    // o vocabulário que a trava de área usa (aovivo/areas.mjs); é lista de
    // classificador, não briefing: serve para dizer de quem é o tema
    palavras: 'analytics relatório painel dashboard métrica métricas modelagem pipeline consulta planilha indicador visualização estatística análise dados dado amostra correlação',
    regra: 'Prefira o recurso que a pessoa consegue usar na semana seguinte ao panorama de mercado. Toda métrica vem com o que ela mede e o que ela esconde.',
  },
  {
    nome: 'Cibersegurança', ativo: true, bancada: 'ciberseguranca',
    foco: 'incidente, vazamento, falha explorada, regulação de segurança, prática de defesa e risco para empresas',
    // onde este tema acontece no mundo físico, para o Designer não cair no
    // cenário genérico de tecnologia (ver aovivo/equipe/designer.md)
    cenario: 'o lado humano e físico do incidente: a sala às três da manhã, o telefone no ouvido, o quadro com a linha do tempo do ataque, a leitora de crachá na porta, o armário de rede trancado, a mesa de quem está escrevendo o comunicado para os clientes',
    // o vocabulário que a trava de área usa (aovivo/areas.mjs); é lista de
    // classificador, não briefing: serve para dizer de quem é o tema
    palavras: 'vazamento vazada vazado credencial credenciais invasão ataque ransomware phishing vulnerabilidade falha senha autenticação criptografia incidente defesa firewall chave acesso',
    regra: 'Neutro politicamente: incidente não vira disputa de lado nenhum. NUNCA descreva como explorar uma falha; escreva o que o gestor e o time fazem a respeito. Toda falha vem com quem é atingido e o que dá para fazer hoje.',
  },
  {
    nome: 'Varejo e Supply Chain', ativo: true, bancada: 'varejo',
    foco: 'comércio agêntico, logística, última milha, previsão de demanda, estoque, ruptura, experiência de compra e a cadeia do fornecedor à entrega',
    // onde este tema acontece no mundo físico, para o Designer não cair no
    // cenário genérico de tecnologia (ver aovivo/equipe/designer.md)
    cenario: 'a operação de verdade: a gôndola com buraco, a doca de recebimento, o coletor na mão do conferente, o caminhão esperando, o corredor do centro de distribuição, a fila do caixa, a caixa devolvida',
    // o vocabulário que a trava de área usa (aovivo/areas.mjs); é lista de
    // classificador, não briefing: serve para dizer de quem é o tema
    palavras: 'estoque gôndola sortimento ruptura frete entrega fornecedor armazém transporte loja comprador devolução milha demanda logística prateleira pedido',
    regra: 'Amarre o assunto na operação: o que muda para quem vende, para quem entrega e para quem compra. Melhoria de prazo tem custo em algum lugar; diga onde.',
  },
  {
    nome: 'Carreira e Competências', ativo: true, bancada: 'carreira',
    foco: 'habilidade que o mercado está pedindo, caminho para aprendê-la, recrutamento, formação, transição de carreira e o que muda no trabalho de quem já está empregado',
    // onde este tema acontece no mundo físico, para o Designer não cair no
    // cenário genérico de tecnologia (ver aovivo/equipe/designer.md)
    cenario: 'onde a carreira acontece: a sala de entrevista, o balcão do RH, a sala de treinamento com cadeiras em U, a feira de recrutamento, a mesa de alguém estudando depois do expediente, a conversa de corredor sobre promoção',
    // o vocabulário que a trava de área usa (aovivo/areas.mjs); é lista de
    // classificador, não briefing: serve para dizer de quem é o tema
    palavras: 'vaga vagas salário salarial recrutamento entrevista currículo promoção senioridade formação treinamento aprendizado habilidade competência contratação carreira profissional',
    regra: 'O foco é aprendizado e habilidade, não motivação. Toda habilidade vem com o sinal de que ela está sendo pedida e com o caminho concreto para desenvolvê-la.',
  },
];
const AREAS_ATIVAS = AREAS.filter((a) => a.ativo !== false);
if (!AREAS_ATIVAS.length) throw new Error('Nenhuma área ativa: a bancada não teria sobre o que escrever.');

/* Os dois formatos da casa, e como se escolhe entre eles.

   REDAÇÃO é o primeiro formato: o Diretor escolhe a pauta, o Pesquisador apura,
   o Diretor escreve, o Auditor dá o parecer em cena. Depende de fonte: sem três
   fontes o tema cai, porque o assunto é o que foi apurado.

   MESA é o formato de 23/09: a bancada do tema conversa antes de o texto existir
   e o assunto é o ofício, não a notícia. Quem tem bancada declarada usa este.

   Sorteio, não rodízio: pedido do Rubens em 30/09, "não tem ordem certa, pode
   ser qualquer quantidade, quero bem aleatório". Uniforme entre as nove áreas,
   com uma única amarra: não repetir a área do documento anterior, senão dois
   sorteios seguidos na mesma área produzem temas vizinhos e a trava de repetição
   derruba o segundo. A sequência de formatos fica livre, que é o pedido. */
const formatoDe = (area) => (area?.bancada ? 'mesa' : 'redacao');
let areaAnterior = null;

function sorteiaArea() {
  // AREA_TESTE=Tecnologia força a área, para conferir um formato de propósito
  if (process.env.AREA_TESTE) {
    const pedida = AREAS_ATIVAS.find((a) => a.nome.toLowerCase().startsWith(String(process.env.AREA_TESTE).toLowerCase()));
    if (pedida) { areaAnterior = pedida.nome; return pedida; }
    throw new Error(`AREA_TESTE="${process.env.AREA_TESTE}" não é área ativa. Ativas: ${AREAS_ATIVAS.map((a) => a.nome).join(', ')}`);
  }
  const candidatas = AREAS_ATIVAS.filter((a) => a.nome !== areaAnterior);
  const area = (candidatas.length ? candidatas : AREAS_ATIVAS)[Math.floor(Math.random() * (candidatas.length || AREAS_ATIVAS.length))];
  areaAnterior = area.nome;
  return area;
}

/* ---------- as etapas ---------- */
const SCHEMA_TEMA = {
  type: 'OBJECT',
  properties: {
    tema: { type: 'STRING', description: 'O problema do ofício em uma frase, que alguém da área entende sem contexto. Sem nome de empresa, sem número, sem ano.' },
    porque: { type: 'STRING', description: 'Duas frases: por que profissionais da área discordariam sobre isto. Sem número: nenhuma fonte foi lida ainda.' },
    consulta_pt: { type: 'STRING', description: 'De 2 a 4 palavras amplas em português, sem país, ano ou nome próprio.' },
    consulta_en: { type: 'STRING', description: 'De 2 a 4 palavras amplas em inglês, sem país, ano ou nome próprio.' },
  },
  required: ['tema', 'porque', 'consulta_pt', 'consulta_en'],
};

/* O mesmo esquema, com as descrições do formato de redação. A descrição de campo
   é o que o modelo lê com mais atenção no pedido estruturado: pedir "o problema
   do ofício" numa pauta de documento é pedir mesa redonda com outro nome. */
const SCHEMA_TEMA_REDACAO = {
  type: 'OBJECT',
  properties: {
    tema: { type: 'STRING', description: 'O assunto do documento em uma frase, amplo, do que está acontecendo na área. Sem nome de empresa, sem número, sem ano.' },
    porque: { type: 'STRING', description: 'Duas frases: por que isto importa para quem trabalha com o assunto. Sem número: nenhuma fonte foi lida ainda.' },
    consulta_pt: { type: 'STRING', description: 'De 2 a 4 palavras amplas em português, sem país, ano ou nome próprio.' },
    consulta_en: { type: 'STRING', description: 'De 2 a 4 palavras amplas em inglês, sem país, ano ou nome próprio.' },
  },
  required: ['tema', 'porque', 'consulta_pt', 'consulta_en'],
};
/* O jeito de quem ocupa a cadeira, repetido junto da pergunta.

   Medido em 23/09, primeiro dia das bancadas por tema: o papel do Diretor tem
   4.970 letras de regra da cadeira e o jeito do especialista entra no fim, com
   473 a 857 letras. Ou seja, quem dirige o tema é 9% a 15% do que o modelo lê,
   e os 85% restantes são as mesmas regras para todo mundo. Na escolha do tema
   isso é justamente o contrário do que se quer: escolher assunto é a hora em que
   o conhecimento do cabeça manda, não a hora da regra de formato.

   Repetir custa uns 200 tokens por escolha e põe o jeito ao lado da pergunta,
   que é a posição que o modelo de fato lê. */
const oJeitoDaCadeira = (agente) => (agente?.jeito
  ? `\n## Quem escolhe hoje\n\nVocê é ${agente.cargo.toLowerCase()}, e a escolha tem que ter a sua cara:\n\n${agente.jeito}\n`
  : '');

/* O que a mesa recebe quando a busca não trouxe nada aproveitável. Não é erro:
   é a mesa falando só do ofício, e o fiscal garante que ela fale sem número. */
const SEM_MATERIAL = 'Não há material de apoio desta vez. A mesa fala do que sabe da prática, e o texto sai SEM NÚMERO NENHUM.';

const REGRA_BUSCA = 'As buscas: de 2 a 4 palavras, amplas, SEM país, SEM ano e SEM nome próprio. Busca estreita volta vazia e o tema é recusado por falta de fonte. Exemplo bom: "consumo energia data centers" / "data center energy use". Exemplo ruim: "demanda profissionais IA Brasil 2024".';
const dataPorExtenso = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

async function escolheTema(area, recentes, recusados, daArea = []) {
  await pensa(A.diretor, `escolhendo o tema (${area.nome})`);
  const redacao = formatoDe(area) === 'redacao';
  const t = await chama(A.diretor, [
    redacao
      ? `Hoje é ${dataPorExtenso()}. Escolha o tema do próximo documento.`
      : `Hoje é ${dataPorExtenso()}. Escolha o assunto da próxima MESA REDONDA da sua área.`,
    redacao
      ? `Área da vez: **${area.nome}**, ou seja, ${area.foco}. Sem nome de empresa, com chance real de ter fonte pública e confiável.`
      : `Área da vez: **${area.nome}**, ou seja, ${area.foco}. Sem nome de empresa.`,
    'O tema tem que ser DESTA área. Assunto que pertence a outra mesa da casa não é seu, por mais que você consiga pendurar nele uma justificativa da sua área: isso é conferido por código e volta.',
    area.regra ? `\nA regra desta área: ${area.regra}` : '',
    oJeitoDaCadeira(A.diretor),
    '',
    /* O formato de redação cobre o que está acontecendo, e é por isso que ele
       depende de fonte: sem apuração não há documento. Daí o pedido ser o oposto
       do da mesa, e daí a instrução de deixar o tema amplo, que é o que faz a
       busca voltar com material. */
    ...(redacao ? [
      'Isto é PAUTA DE DOCUMENTO: um assunto que está acontecendo agora e sobre o qual existe material publicado para apurar. O documento vive do que a apuração trouxer, então escolha assunto que outras pessoas estejam cobrindo nesta semana.',
      'Deixe o tema amplo: o recorte (um país, um setor) só entra no texto se as fontes o cobrirem.',
      '',
      'NÃO escreva número nenhum aqui, nem porcentagem, nem valor, nem ano. Você não leu fonte nenhuma ainda, então qualquer número neste momento seria inventado por você. O sistema recusa por código.',
      '',
      `${REGRA_BUSCA}`,
    ] : [
      /* O que separa este formato do anterior. A casa não cobre notícia: ela senta
         profissionais para discutir o ofício deles. Um acontecimento pode aparecer
         no texto como prova de que o assunto está vivo, mas nunca É o assunto. */
      'ISTO NÃO É PAUTA DE JORNAL. Não é acontecimento, lançamento, anúncio, relatório novo nem resultado de pesquisa. É um problema do OFÍCIO: a decisão que a sua área toma errado com frequência, o trade-off que ninguém mede, a prática que todo mundo repete sem saber por quê, a dúvida que cai na sua mesa toda semana.',
      'Escreva como o assunto que uma mesa de profissionais levaria uma hora discutindo E sobre o qual eles DISCORDARIAM. Se todo mundo da área responderia a mesma coisa, não rende mesa: troque.',
      '',
      'NÃO escreva número nenhum aqui, nem porcentagem, nem valor, nem ano. Você não leu fonte nenhuma ainda, então qualquer número neste momento seria inventado por você. O sistema recusa por código.',
      '',
      `${REGRA_BUSCA} A busca não é para achar a notícia do assunto: é para trazer material de apoio e confirmar que outras pessoas estão lidando com isso agora.`,
    ]),
    /* A memória da ÁREA, de um mês, que é a mudança de 02/10. Antes o Diretor via
       45 temas da casa inteira, e a 29 documentos por dia entre nove áreas isso
       cobria um dia e meio: ele nunca via o que a própria área já tinha feito.
       Daí "treinar ou contratar" sete vezes em Carreira e Competências.

       A instrução fala de DILEMA e não de palavra de propósito: a medição de
       02/10 mostrou que a repetição que a leitora enxergou não aparece em
       semelhança de palavra nenhuma, então o que pode evitá-la é o Diretor ver a
       lista do mês da área dele e ser cobrado pelo ângulo. */
    daArea.length ? `\n## O que a SUA área já publicou no último mês (${daArea.length} documentos)\nNÃO repita nenhum, e não repita o DILEMA com outras palavras: "contratar fora ou treinar dentro" é o mesmo tema de "especialista externo ou requalificação interna". Se o seu assunto cabe em algum destes, ache um ângulo que nenhum deles tomou, ou troque de assunto.\n${daArea.slice(0, 60).map((r) => `- ${r.tema}`).join('\n')}` : '',
    // e os da casa inteira, para não atravessar a mesa do vizinho
    recentes.length ? `\nTemas recentes das outras áreas, NÃO repita nem chegue perto:\n${recentes.slice(-30).map((r) => `- ${r}`).join('\n')}` : '',
    recusados.length ? `\nTemas que o Pesquisador acabou de recusar por falta de fonte:\n${recusados.map((r) => `- ${r}`).join('\n')}` : '',
  ].join('\n'), redacao ? SCHEMA_TEMA_REDACAO : SCHEMA_TEMA);
  /* Repetição conferida por código: o modelo esquece a lista que acabou de ler.
     Dois limiares desde 02/10, calibrados no índice real (ver LIMIAR_AREA em
     pautas.mjs): dentro da área 0.40, fora dela 0.45. */
  const repetido = daArea.map((x) => x.tema).find((r) => parecidoNaFila(r, t.tema) >= LIMIAR_AREA)
    || recentes.find((r) => parecidoNaFila(r, t.tema) >= LIMIAR);
  if (repetido) { log(`tema parecido com "${repetido}", pedindo outro`); return { ...t, repetido }; }
  // de quem é este tema: em 23/09 o RH escolheu "Análise de dados com SQL" para
  // Carreira, que é tema de Dados com justificativa de carreira pendurada
  const invasor = foraDaArea(t.tema, area, AREAS_ATIVAS);
  if (invasor) { log(`tema é de ${invasor.area} (${invasor.nota.toFixed(2)} contra ${invasor.minha.toFixed(2)}), pedindo outro`); return { ...t, invasor }; }
  /* Número na escolha do tema é inventado por definição: nenhuma fonte foi lida
     ainda. Em 23/09 saiu ao vivo "a procura por quem implementa RPA cresceu 45%
     nas vagas de TI em 2025", número que não existia em lugar nenhum. O fiscal
     protege o texto final, mas esta etapa acontece antes dele.

     Quem confere é o mesmo numerosSemFonte do fiscal, com a lista de fontes
     vazia: sem fonte, todo número é sem fonte. */
  const inventados = numerosSemFonte(`${t.tema}\n${t.porque}`, '').map((n) => n.numero);
  if (inventados.length) { log(`tema veio com número sem fonte (${inventados.join(', ')}), pedindo outro`); return { ...t, inventados }; }
  await escreve(A.diretor, 'escolheu o tema', `${t.tema}\n\n${t.porque}`);
  return t;
}

// Num pedido do administrador o tema já vem dado: o Diretor só traduz em busca
async function temaDoPedido(pedido, tentativa) {
  await pensa(A.diretor, 'lendo o pedido do administrador');
  const t = await chama(A.diretor, [
    `Hoje é ${dataPorExtenso()}. O administrador pediu um documento sobre este tema. Não troque de tema; escreva-o numa frase clara e gere as buscas.`,
    '', `Tema pedido: ${pedido.tema}`,
    pedido.contexto ? `\nContexto que veio com o pedido:\n${String(pedido.contexto).slice(0, 1500)}` : '',
    '', REGRA_BUSCA,
    tentativa ? `\nEsta é a tentativa ${tentativa + 1}: as buscas anteriores não acharam três fontes. Use palavras MAIS amplas e diferentes.` : '',
  ].join('\n'), SCHEMA_TEMA);
  await escreve(A.diretor, 'entendeu o pedido', `${t.tema}\n\n${t.porque}`);
  return t;
}

// O trecho de cada fonte vai no pedido duas vezes (apuração e auditoria), e é o
// que mais pesa na cota de tokens do dia. 1.100 letras ainda dão o miolo da
// notícia; a auditoria se vira com menos, porque confere afirmação, não contexto.
function blocoFontes(fontes, comTexto, letras = 1100) {
  return fontes.map((f) => `[${f.id}] ${f.titulo} (${f.dominio}, ${f.tipo}${f.data ? `, ${String(f.data).slice(0, 10)}` : ''})${comTexto ? `\n${f.texto.slice(0, letras)}` : ''}`).join('\n\n');
}

const SCHEMA_MANCHETE = {
  type: 'OBJECT',
  properties: {
    numero: { type: 'NUMBER', description: 'O número da manchete escolhida na lista.' },
    tema: { type: 'STRING', description: 'O tema do documento em uma frase, sem nome de empresa.' },
    porque: { type: 'STRING', description: 'Duas frases: por que este tema importa para quem trabalha.' },
    palavras: { type: 'STRING', description: 'De 3 a 5 palavras do assunto, para achar as outras notícias sobre ele.' },
  },
  required: ['numero', 'tema', 'porque', 'palavras'],
};

// O caminho de quando a busca falha: escolher entre o que os veículos publicaram

async function umDocumento({ pedido = null } = {}) {
  const qualidade = !!pedido;
  // o consumo de tokens conta deste ponto até a publicação (ver consumo em llm.mjs)
  zeraConsumo();
  // 200 temas, uns quatro dias de trabalho: com 40, "detecção de fraudes em
  // pagamentos digitais" voltou no dia seguinte, porque a bancada passou a fazer
  // mais de 40 documentos por dia
  /* A memória de temas sai do índice: 1 leitura em vez de 200, e com área e data,
     que é o que faltava para enxergar repetição dentro da mesma área. O
     temasRecentes antigo fica de reserva para quando o índice ainda não existir
     (primeiro arranque, ou índice apagado). */
  const memoria = pedido ? [] : await destino.memoriaDeTemas().catch(() => []);
  const recentes = pedido ? []
    : memoria.length ? memoria.slice(0, 200).map((x) => x.tema).reverse()
      : await destino.temasRecentes(200).catch(() => []);
  const numeroPrevisto = pedido ? 0 : await destino.proximoNumero();
  const area = pedido ? { nome: 'Pedido do administrador' } : sorteiaArea();
  const formato = pedido ? 'mesa' : formatoDe(area);
  const redacao = formato === 'redacao';
  const banca = pedido ? (A = TITULARES, null) : sentaBancada(area, numeroPrevisto);
  /* A tela precisa saber QUEM sentou, agora. Sem esta linha o crachá continua com
     o elenco do documento anterior até a mesa começar, e em 24/09 isso pôs o nome
     da Diretora de RH em cima de uma escolha de tema da CTO sobre front-end: a
     bancada parecia estar fazendo exatamente o que a trava de área impede.
     Erro de vitrine é pior que erro de motor, porque ele acusa o motor de um
     crime que o motor não cometeu. */
  E.elenco = elencoParaTela();
  // o que a área já publicou no último mês, que é a memória que faltava
  const desde = new Date(Date.now() - DIAS_DE_MEMORIA * 86400000).toISOString().slice(0, 10);
  const daArea = pedido ? [] : memoria.filter((x) => x.categoria === area.nome && String(x.data) >= desde);
  if (!pedido) log(`sorteio: ${area.nome}, formato de ${formato === 'mesa' ? 'mesa redonda' : 'redação'}, ${daArea.length} temas da área no último mês`);
  if (banca) log(`bancada de ${area.nome}: ${Object.values(banca.agentes).map((x) => x.nome).join(', ')}`);
  const recusados = [];
  let tema; let fontes = []; let apuracao = '';
  // o tema que o cabeça da área deixou pronto no domingo, se a fila ainda tiver
  const daFila = pedido ? null : await pegaDaFila(area, recentes);

  // o Diretor propõe, o Pesquisador confere se há fonte; até três tentativas
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    tema = pedido ? await temaDoPedido(pedido, tentativa)
      : (tentativa === 0 && daFila) ? daFila
      : await escolheTema(area, recentes, recusados, daArea);
    if (tema.repetido) {
      recusados.push(tema.tema);
      await registra('repetido', { tema: tema.tema, area: area.nome, parecido: tema.repetido, pedido: !!pedido });
      continue;
    }
    if (tema.invasor) {
      recusados.push(tema.tema);
      await registra('fora_do_tema', { tema: tema.tema, area: area.nome, dono: tema.invasor.area, pedido: !!pedido });
      continue;
    }
    if (tema.inventados) {
      recusados.push(tema.tema);
      await registra('numero_inventado', { tema: tema.tema, area: area.nome, numeros: tema.inventados, pedido: !!pedido });
      continue;
    }
    // as fontes ficam FORA do painel ao vivo: um painel listando o que acabou de
    // ser baixado é exatamente "entregar na tela que eles estão pesquisando".
    // Elas voltam no documento, nas referências, que é onde o leitor as quer.
    E.peca = { tema: tema.tema, area: area.nome, fontes: [] };

    /* ---------- o material, de bastidor ----------
       A apuração não sumiu: ela é o que impede número inventado de entrar no
       texto. O que sumiu foi a encenação dela. Ninguém assiste a bancada
       pesquisar, porque numa mesa redonda os profissionais falam do que sabem e
       o material serve para sustentar o que afirmam, não para ser o assunto. */
    log(`material: procurando apoio para "${tema.tema}"`);
    const p = await pesquisar({ pt: tema.consulta_pt, en: tema.consulta_en }, { maxFontes: qualidade ? 8 : 6, log, bancada: area.bancada });
    fontes = p.fontes;
    log(`material: ${fontes.length} lidas, ${p.recusadas.naoConfiavel} fora da lista, ${p.recusadas.naoAbriu} não abriram`);

    /* Pouco material NÃO derruba mais o tema. Derrubava porque o assunto era a
       notícia: sem manchete não havia post. Agora o assunto é o ofício, e uma
       mesa sobre um problema do ofício não depende de alguém ter publicado
       matéria sobre ele nesta semana. O que a falta de material limita é o
       NÚMERO: o fiscal corta todo número que não esteja nas fontes, então mesa
       sem material fala sem número, que é como profissional fala da própria
       prática. */
    /* No formato de redação a regra antiga vale inteira: menos de três fontes
       derruba o tema e o Diretor tenta outro. É o formato que depende de
       apuração, e é esta exigência que faz o documento sair com referência para
       o primeiro comentário. */
    if (redacao && fontes.length < 3) {
      log(`material: só ${fontes.length} fonte(s), e a redação pede três; outro tema`);
      recusados.push(tema.tema);
      await registra('sem_fonte', { tema: tema.tema, area: area.nome, fontes: fontes.length, consulta: tema.consulta_pt, pedido: !!pedido });
      fontes = []; apuracao = '';
      continue;
    }
    if (!fontes.length) { log('material: nada aproveitável, a mesa vai sem apoio'); apuracao = SEM_MATERIAL; break; }

    log(`material: lendo ${fontes.length} fontes`);
    apuracao = await chama(A.pesquisador, [
      `Tema: ${tema.tema}`,
      // o formato muda o critério do veredito: ver aovivo/equipe/pesquisador.md
      redacao
        ? 'Formato: REDAÇÃO. O material é o assunto do documento.'
        : 'Formato: MESA REDONDA. O material é APOIO para a discussão do ofício, não é o assunto. Fonte que não prova a tese ainda serve, se traz número ou fato da área. Só diga NÃO SUSTENTA se não houver nada aproveitável em fonte nenhuma.',
      '', '## Fontes (use só estas, pelo código)', blocoFontes(fontes, true),
    ].join('\n'));
    if (/^\W*N[ÃA]O SUSTENTA/i.test(apuracao)) {
      /* Este caminho sumia do diário desde 24/09, e ele é o maior produtor de
         documento sem fonte da casa: metade dos posts de setembro saiu sem
         referência nenhuma e a reunião de sábado não tinha como ver por quê.
         Agora ele é anotado nos dois formatos, e na redação ele derruba o tema. */
      await registra('nao_sustenta', { tema: tema.tema, area: area.nome, fontes: fontes.length, consulta: tema.consulta_pt, pedido: !!pedido });
      if (redacao) {
        log('material: o apurador diz que as fontes não sustentam; outro tema');
        recusados.push(tema.tema);
        fontes = []; apuracao = '';
        continue;
      }
      log('material: o apurador diz que as fontes não sustentam; a mesa vai sem apoio');
      fontes = []; apuracao = SEM_MATERIAL; break;
    }
    // fonte que o Pesquisador marcou como fora do tema sai antes de o Diretor
    // escrever: no primeiro documento, duas fontes sem relação foram forçadas no texto
    // só a linha que COMEÇA com a marca vale, e "nenhuma" não tira nada: no segundo
    // teste uma frase explicativa fez o leitor retirar as três fontes de uma vez
    const fora = new Set([...apuracao.matchAll(/^\s*[-*]?\s*\**FORA DO TEMA\**\s*:\s*([^\n]+)/gim)]
      .filter((m) => !/nenhum|nada|none|todas? (estão|est[aã]o) no tema/i.test(m[1]))
      .flatMap((m) => m[1].match(/\bf\d+\b/g) || []));
    if (fora.size) {
      fontes = fontes.filter((f) => !fora.has(f.id));
      E.peca.fontes = E.peca.fontes.filter((f) => !fora.has(f.id));
      apuracao = semFontesRetiradas(apuracao, fora);
      log(`fora do tema, retiradas: ${[...fora].join(', ')}`);
    }
    log(`material pronto (${fontes.length} fontes)`);
    // o que sobrou depois de o Pesquisador tirar o que era de outro assunto
    if (redacao && fontes.length < 3) {
      log(`material: sobraram ${fontes.length} fonte(s) depois do corte; outro tema`);
      recusados.push(tema.tema);
      await registra('fora_do_tema', { tema: tema.tema, area: area.nome, fontes: fontes.length, consulta: tema.consulta_pt, pedido: !!pedido });
      fontes = []; apuracao = '';
      continue;
    }
    if (!fontes.length) apuracao = SEM_MATERIAL;
    break;
  }
  // só chega aqui quando as três tentativas foram recusadas antes de haver mesa
  // (repetido, de outra área, ou com número inventado)
  /* A guarda olha o material, não só a apuração. No primeiro teste do formato de
     redação, em 02/10, três temas caíram seguidos e o quarto post foi escrito com
     a apuração do segundo tema e as duas fontes do terceiro: a apuração tinha
     ficado de pé de uma volta anterior do laço. Limpar no "continue" resolve; a
     guarda dupla aqui é o cinto. */
  if (!apuracao || (redacao && fontes.length < 3)) {
    await escreve(A.diretor, 'pausa', pedido ? 'Três tentativas sem assunto que se sustente para o pedido. Aviso o administrador.' : 'Três assuntos recusados seguidos. Pausa curta e a mesa recomeça com outra questão.');
    await registra('sem_tema', { area: area.nome, tentados: recusados, pedido: !!pedido });
    return { falhou: 'três assuntos recusados seguidos' };
  }

  const fontesTexto = fontes.map((f) => `${f.titulo}\n${f.texto}`).join('\n\n');
  const listaFontes = blocoFontes(fontes, false);

  /* ---------- a mesa ----------
     Pedido do Rubens em 23/09. Antes de o Diretor escrever, a equipe do tema lê
     a apuração e conversa. Conversa mesmo: cada um recebe o que os anteriores
     disseram e é obrigado a se posicionar sobre aquilo. Na primeira versão eram
     quatro monólogos paralelos, e quatro ângulos compatíveis não dão atrito,
     dão sopa: o Diretor recebia tudo encaixado e misturava.

     Lê a apuração, e não as fontes cruas, por duas razões: a apuração já é o que
     sobrou de relevante, e o trecho das fontes é o que mais pesa na cota do dia.
     Quem falhar fica calado: a mesa é para enriquecer o texto, não para travar
     a produção. */

  // O corte seco é licença, não humor. Modelo mandado "ser ácido" produz piada
  // ruim; modelo com uma lista fechada de gatilhos corta quando é para cortar.
  const CORTE = [
    'O corte seco: você pode cortar em UMA frase quando, e só quando, aparecer uma destas quatro coisas:',
    '(a) alguém afirmou o que a apuração não sustenta;',
    '(b) um número não fecha com outro número da apuração;',
    '(c) promessa de fornecedor está sendo repetida como se fosse achado;',
    '(d) a conclusão é grande demais para o tamanho da evidência.',
    'O corte é sobre a afirmação, nunca sobre a pessoa, e não é ironia com quem falou. Não havendo nenhuma das quatro, NÃO corte: corte gratuito é pior que corte nenhum.',
  ].join(' ');
  const REGRAS_MESA = [
    'Regras da mesa:',
    '- Você fala do OFÍCIO, não de notícia. O que vale aqui é o que você viu acontecer na prática, não o que foi publicado.',
    '- O material de apoio é apoio. Se tudo que você tem a dizer é repetir o que está nele, você não tem o que dizer nesta mesa.',
    '- Não repita o que já foi dito. Quem repete não contribuiu.',
    '- Não invente número. Se o material não traz o número, fale sem número: profissional fala da própria prática sem estatística.',
    '- Diga se vale no Brasil e o que muda se não valer.',
    `- ${CORTE}`,
    '- Português do Brasil, sem travessão.',
  ].join('\n');

  const mesa = [];
  if (banca?.mesa?.length) {
    for (const [i, e] of banca.mesa.entries()) {
      /* Resumo, não transcrição. Pedido da auditoria em 30/09: com o texto
         literal do colega na frente, o modelo parafraseia; com a posição dele em
         uma linha, tem que escrever a própria. */
      const anteriores = mesa.length
        ? ['', '## As posições que já foram defendidas na mesa (resumo, não é o texto deles)', resumoDaMesa(mesa),
          '', 'Escreva com as SUAS palavras. Não comece a sua fala do jeito que algum deles começou a dele.'].join('\n')
        : '';
      // o robô da cadeira passa a usar o nome de quem fala, e quem faz isso é o
      // poeNaCena de dentro do pensa/escreve: assim o nome e o balão nunca se
      // separam (ver poeNaCena)
      const voz = { nome: e.nome, id: e.cadeira, cargo: e.cargo, especialista: true, modelo: A.diretor.modelo, temperatura: 0.8, papel: `Você é ${e.cargo.toLowerCase()} e está numa mesa redonda com outros profissionais da sua área. Ninguém aqui é seu chefe e ninguém é repórter: são pares discutindo o ofício.\n\n${e.corpo}` };
      await pensa(voz, mesa.length ? 'ouvindo a mesa' : 'abrindo a mesa');
      try {
        const encargo = e.ultima
          ? 'Você fala por último. Faça as três coisas do seu papel, nesta ordem: a pergunta, a palavra que travou, e o que você faria. Se a mesa conversou entre si e ninguém disse por que isso importa para quem está de fora, é isso que você fala.'
          : mesa.length
            ? 'Posicione-se sobre o que já foi dito: onde eles estão errados, onde estão confortáveis demais, ou o que todos deixaram passar. Concordar e acrescentar NÃO é contribuição; se você concorda com todos, diga o que todos deixaram passar. No máximo 4 frases.'
            : 'Você ABRE a mesa. Em no máximo 4 frases, diga como esta questão aparece na SUA prática: o que você vê acontecer, o que costuma dar errado, e qual é a sua posição. Posição, não panorama: a mesa existe para discordar de você.';
        const fala = await chama(voz, [
          `A mesa de hoje discute: ${tema.tema}`,
          tema.porque ? `Por que rende discussão: ${tema.porque}` : '',
          `Área: ${area.nome}.`, area.regra ? `Regra da área: ${area.regra}` : '',
          '', '## Material de apoio (bastidor, não é o assunto)', apuracao,
          anteriores,
          '', encargo, '', REGRAS_MESA,
        ].join('\n'));
        const curta = semTravessao(String(fala).trim()).slice(0, 700);
        // A trava do atrito, por código: fala que só reescreve a apuração não é
        // contribuição, é eco. O modelo promete não repetir e repete; quem
        // confere é isto. Mesmo caminho da conferência de anatomia da imagem.
        const eco = parecido(curta, apuracao);
        if (curta.length <= 20) { log(`mesa: ${e.nome} veio vazio`); continue; }
        if (eco >= ECO_MESA) { log(`mesa: ${e.nome} só parafraseou a apuração (${eco.toFixed(2)}), descartado`); continue; }
        if (!temSubstancia(curta)) { log(`mesa: ${e.nome} concordou sem acrescentar, descartado`); continue; }
        // e o eco do colega, que a trava de cima não pega: ver ecoDeAbertura
        const coro = ecoDeAbertura(curta, mesa);
        if (coro) { log(`mesa: ${e.nome} abriu igual a ${coro}, descartado`); continue; }
        mesa.push({ nome: e.nome, cargo: e.cargo, fala: curta, ultima: !!e.ultima });
        await escreve(voz, e.ultima ? 'a última palavra' : (mesa.length > 1 && contestou(curta) ? 'contestou' : 'na mesa'), curta);
      } catch (err) {
        log(`mesa: ${e.nome} ficou calado (${err.message})`);
        if (err.semCota) throw err;
      }
    }
  }

  /* Aqui havia a volta aos titulares, e era ela que punha o texto da Logística
     sob o nome de Varejo (auditoria de 30/09): o nome voltava, o balão ficava. A
     volta agora acontece uma vez só, no começo do documento seguinte, quando a
     bancada nova senta. */

  /* Sem mesa, sem documento.
     Achado em 24/09, rodando: quando todas as falas caem nas travas (eco ou
     concordância vazia), a mesa fica vazia e o fechamento escrevia o texto
     assim mesmo, a partir do material. Isso é exatamente o artefato do formato
     antigo voltando pela porta dos fundos: um texto de apuração assinado por
     quem deveria ter discutido.

     Neste formato a mesa É o trabalho. Uma voz só é monólogo, não mesa. Então
     abaixo de duas falas o documento não existe, e o episódio vai para o diário
     para a reunião de sábado contar quantas vezes isso aconteceu: se for
     sempre, o número aqui é que está errado, e o diário é que vai dizer. */
  const MESA_MINIMA = 2;
  if (banca?.mesa?.length && mesa.length < MESA_MINIMA) {
    await escreve(A.diretor, 'encerrou sem documento', mesa.length
      ? 'A mesa não pegou: uma fala só não é discussão. Prefiro não publicar a publicar um texto que ninguém discutiu.'
      : 'A mesa não teve discussão nenhuma. Sem mesa não há documento: esse é o trato deste formato.');
    await registra('mesa_vazia', { tema: tema.tema, area: area.nome, falas: mesa.length, convidados: banca.mesa.length, pedido: !!pedido });
    return { falhou: `a mesa produziu ${mesa.length} fala(s), mínimo ${MESA_MINIMA}` };
  }

  /* ---------- a ressalva ----------
     Pedido do Rubens em 23/09: o Plantonista, o Pesquisador e o Auditor não
     somem com o formato novo, mas param de ser etapa de produção. Eles viram
     quem é CHAMADO quando a mesa precisa, e o que entregam não é veto: é uma
     ressalva sobre as outras perspectivas possíveis, que entra no texto.

     Quando chamar é decisão de código, não de humor: mesa em que ninguém
     contestou produz texto com uma segurança que a discussão não teve. Quem é
     chamado é o titular da casa (ou o substituto do dia), de propósito — a graça
     é justamente vir de fora do tema. */
  let ressalva = '';
  const atrito = mesa.filter((m) => contestou(m.fala)).length;
  if (mesa.length >= 2 && !atrito) {
    const convidado = TITULARES.auditor;
    log(`mesa sem atrito em ${mesa.length} falas: chamando ${convidado.nome} para a ressalva`);
    await pensa(convidado, 'chamado à mesa: ninguém contestou');
    try {
      ressalva = semTravessao(String(await chama({ ...convidado, temperatura: 0.7 }, [
        `A mesa discutiu "${tema.tema}" e fechou sem ninguém contestar ninguém.`,
        'Você não é do tema, e é por isso que foi chamado.',
        '', '## O que a mesa disse', mesa.map((m) => `**${m.cargo}:** ${m.fala}`).join('\n\n'),
        '', 'Em no máximo 3 frases: que OUTRAS leituras desta questão existem e não apareceram aqui? Em que situação a conclusão da mesa não valeria?',
        'Não é veto e não é correção: é ressalva. Você não está dizendo que eles erraram, está dizendo o que a mesa não olhou.',
        'Não invente número. Português do Brasil, sem travessão.',
      ].join('\n'))).trim()).slice(0, 600);
      if (ressalva.length > 20) await escreve(convidado, 'a ressalva', ressalva);
      else { ressalva = ''; log('ressalva veio vazia'); }
    } catch (err) {
      log(`ressalva não veio (${err.message})`);
      if (err.semCota) throw err;
    }
  } else if (mesa.length) {
    log(`mesa com atrito em ${atrito} de ${mesa.length} falas: ressalva dispensada`);
  }

  await pensa(A.diretor, redacao ? 'escrevendo o post' : 'fechando a mesa');
  /* Quantas fontes o texto tem que citar.

     Na REDAÇÃO, três, a regra antiga: o texto é a apuração, e lá o material nunca
     tem menos de três (o tema cai antes).

     Na MESA, até duas. Era "até três", e a validação de 03/10 mostrou o custo:
     sobraram exatamente três fontes, o texto tinha que citar todas, inclusive a
     mais fraca, e o parecer de quem verifica (que passou a valer na mesa em
     02/10) mandava cortar justamente a afirmação mal apoiada. As duas regras
     puxavam em sentidos opostos e o documento foi barrado depois de treze
     chamadas. Na mesa o material é apoio do que a bancada discutiu; obrigar a
     citar a fonte que sobra é pedir citação forçada, que é o defeito que a casa
     combate desde 19/09. Sem material, o texto sai sem fonte e sem número. */
  const minimoFontes = redacao ? 3 : Math.min(2, fontes.length);
  let doc = await chama(A.diretor, [
    redacao ? `Tema: ${tema.tema}` : `A mesa discutiu: ${tema.tema}`,
    pedido?.contexto ? `\n## O que o administrador mandou junto\n${String(pedido.contexto).slice(0, 1500)}` : '',
    mesa.length ? `\n## O que a mesa disse\n${mesa.map((m) => `**${m.cargo}:** ${m.fala}`).join('\n\n')}` : '',
    ressalva ? `\n## A ressalva\n${ressalva}` : '',
    redacao ? `\n## A apuração do Pesquisador\n${apuracao}` : `\n## Material de apoio (bastidor)\n${apuracao}`,
    area.regra ? `\n## A regra desta área\n${area.regra}` : '',
    fontes.length ? `\n## As fontes\n${listaFontes}` : '',
    '',
    redacao
      ? 'Escreva o post para o LinkedIn, no formato do seu papel. Comece pelo título numa linha com #. O texto sai da APURAÇÃO: o que foi publicado sobre o assunto, o que isso muda e o que ainda não se sabe.'
      : 'FECHE A MESA: escreva o documento que sai DESTA DISCUSSÃO, para o LinkedIn, no formato do seu papel. Comece pelo título numa linha com #.',
    redacao
      ? 'Se as fontes não cobrem um recorte do tema (um país, um setor), NÃO recuse: ajuste o recorte do texto ao que as fontes cobrem.'
      : '',
    mesa.length
      ? 'O texto sai da mesa. Ele NÃO é o seu resumo do material com os ângulos dos outros encaixados por cima: é o que a discussão concluiu. Onde a mesa divergiu, o texto DIZ que divergiu e por quê. A discordância é o que este formato tem de melhor, não um problema a resolver. NÃO nomeie quem falou.'
      : '',
    ressalva ? 'A ressalva entra perto do fim, como as outras leituras possíveis da questão. Ela não desfaz o que a mesa concluiu.' : '',
    fontes.length
      ? `Cite as fontes pelo código entre colchetes, como [f2], logo depois da informação que veio dela. Use pelo menos ${minimoFontes} fonte(s) diferente(s). Nenhum número que não esteja nas fontes${mesa.length ? ', mesmo que alguém da mesa tenha dito' : ''}.`
      : 'Não há material de apoio desta vez: escreva SEM NÚMERO NENHUM e sem citar fonte. A mesa fala da prática dela, e isso basta para um bom texto.',
    '',
    'Você escreve um documento, nunca uma mensagem pedindo mais material.',
  ].join('\n'));

  // Recusa ou texto curto demais não é documento. No segundo teste uma recusa do
  // Diretor ("não é possível elaborar") passou pelo Auditor, ganhou capa e foi
  // publicada como documento 2.
  if (doc.length < 700 || /n[ãa]o (é|e) poss[íi]vel (elaborar|escrever|produzir)|n[ãa]o h[áa] como|envie|envi[áa]-las|forne[çc]a (mais|outras)/i.test(doc.slice(0, 600))) {
    await escreve(A.diretor, 'desistiu do tema', redacao
      ? 'As fontes não sustentam um post inteiro sobre isso. Troco de tema.'
      : 'A mesa não deu texto inteiro sobre isso. Troco de questão.');
    await registra('desistiu', { tema: tema.tema, area: area.nome, fontes: fontes.length, letras: doc.length, pedido: !!pedido });
    return { falhou: 'o Diretor não conseguiu escrever com essas fontes' };
  }
  await escreve(A.diretor, redacao ? 'escreveu o post' : 'fechou a mesa', doc);

  /* ---------- o parecer de quem verifica ----------
     Ele saiu do fluxo em 24/09 junto com o formato jornalístico e voltou em
     02/10, nos dois formatos, por decisão do Rubens depois da auditoria de
     leitura: no documento 288 o assento de verificação da mesa só fez uma
     pergunta, e afirmação sem suporte na fonte saiu publicada. Agora quem senta
     ali confere o texto final contra os trechos lidos, afirmação por afirmação.

     Sem fonte não há o que conferir: a mesa sem material já sai proibida de ter
     número pelo fiscal, e a chamada seria gasto sem ganho. */
  if (fontes.length) {
    await pensa(A.auditor, 'conferindo com as fontes do lado');
    try {
      const parecer = await chama(A.auditor, [
        'Confira o post contra as fontes, afirmação por afirmação.',
        'Toda afirmação factual e todo número do texto tem que estar nos trechos abaixo. O que não estiver: diga o trecho e mande cortar, ou mande marcar como opinião da mesa, sem cara de dado.',
        '', '## Fontes', blocoFontes(fontes, true, 700), '', '## O post', doc,
      ].join('\n'));
      await escreve(A.auditor, 'parecer', parecer);
      if (/CORRIGIR\s*\**\s*$/i.test(parecer.trim()) || /\*\*CORRIGIR\*\*/.test(parecer)) {
        await pensa(A.diretor, 'aplicando o parecer do Auditor');
        doc = await chama(A.diretor, [`Aplique as correções do Auditor. Mantenha todas as regras: sem empresa pelo nome (só como autora de dado, "segundo relatório da X [fN]"), sem veículo pelo nome, só números das fontes, pelo menos ${minimoFontes} fonte(s) pelo código, no máximo 2.600 caracteres.`, '', '## Parecer', parecer, '', '## Fontes', listaFontes, '', '## O post', doc].join('\n'));
        await escreve(A.diretor, 'aplicou o parecer', doc);
      }
    } catch (err) {
      // parecer é revisão, não porteiro: o fiscal roda abaixo de qualquer jeito
      log(`parecer não veio (${err.message})`);
      if (err.semCota) throw err;
    }
  }

  /* O fiscal por código. Até 19/09 ele só anotava alerta e o documento saía
     assim mesmo: o 10 foi publicado com uma fonte só, o 9 e o 10 com veículo
     citado. Agora ele barra: o que não passar depois das revisões não é publicado. */
  const confere = (texto) => {
    const validos = new Set(fontes.map((f) => f.id));
    const { post, usadas } = paraLinkedin(texto, fontes);
    return {
      empresas: empresasCitadas(texto, fontes),
      veiculos: veiculosCitados(texto, fontes),
      numeros: numerosSemFonte(texto, fontesTexto).map((n) => n.numero),
      codigos: [...new Set([...texto.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]).filter((id) => !validos.has(id)))],
      usadas: usadas.length,
      tamanho: post.length,
      ingles: pareceIngles(post),
      testemunho: experienciaPessoal(post),
      fechoFraco: fechamentoSemSaida(post),
      // vai junto para o diário contar "poucas fontes" pela regra do formato
      minimo: minimoFontes,
    };
  };
  /* O que BARRA a publicação: tudo aqui é afirmação falsa, regra combinada com o
     Rubens ou texto na língua errada. */
  const bloqueios = (x) => [
    ...(x.empresas.length ? [`Empresa citada pelo nome, proibido: ${x.empresas.join(', ')}. Descreva em vez de nomear. Só pode ficar se for autora de um dado, escrito como "segundo relatório da X" com o código da fonte que traz esse nome na mesma frase.`] : []),
    ...(x.veiculos.length ? [`Veículo de imprensa citado pelo nome no texto: ${x.veiculos.join(', ')}. Tire o nome; a referência numerada já mostra de onde veio.`] : []),
    ...(x.numeros.length ? [`Número que não aparece em nenhuma fonte: ${x.numeros.join(', ')}. Corte ou troque pelo número exato da fonte.`] : []),
    ...(x.codigos.length ? [`Código de fonte que não existe: ${x.codigos.join(', ')}.`] : []),
    ...(x.ingles ? ['O post saiu em inglês. Escreva em português do Brasil, mesmo quando as fontes estiverem em inglês.'] : []),
    ...(x.testemunho.length ? [`Testemunho em primeira pessoa, e você não viveu isso: "${x.testemunho.join('", "')}". Ninguém desta casa tem empresa, cliente ou passado. Reescreva de forma impessoal, ou marque como hipótese ("imagine uma operação em que...").`] : []),
    ...(x.usadas < minimoFontes ? [`O post cita só ${x.usadas} fonte(s). Use pelo menos ${minimoFontes} fonte(s) diferente(s) da lista, cada uma pelo código.`] : []),
    ...(x.tamanho > LIMITE_POST ? [`O post tem ${x.tamanho} caracteres e o limite é ${LIMITE_POST - 200}. Encurte sem perder as fontes.`] : []),
  ];

  /* O que é PEDIDO mas não barra. A diferença importa: número inventado é
     mentira e não pode sair; fecho fraco é texto pior, e jogar fora um documento
     verdadeiro por causa dele seria trocar um defeito por um prejuízo. Então
     entra na rodada de correção e, se o modelo não consertar, o documento sai
     assim mesmo. A medida de 02/10, nos 325 posts publicados: 27% terminariam
     apontados aqui. */
  const reparos = (x) => [
    ...(x.fechoFraco ? ['O fecho não dá saída para quem leu: ele termina devolvendo a pergunta ao leitor. Antes da pergunta, escreva UMA regra de decisão ("se o atraso vem do fornecedor, renegocie o prazo antes de mexer no estoque") ou diga explicitamente o que ficou sem resposta e por quê. A pergunta para os comentários pode ficar, depois disso.'] : []),
  ];
  const problemas = (x) => [...bloqueios(x), ...reparos(x)];

  let f = confere(doc);
  // o que o fiscal achou ANTES de qualquer correção: se o documento sair, é isto
  // que vira o episódio "corrigido", e é a contagem que mostra o que ele mais pega
  const marcasDeEntrada = marcasDoFiscal(f);
  // pedido do administrador ganha uma rodada de revisão a mais
  const rodadas = qualidade ? 2 : 1;
  for (let i = 0; i < rodadas && problemas(f).length; i++) {
    await escreve(FISCAL, 'conferiu por código', problemas(f).map((p) => `- ${p}`).join('\n'));
    await pensa(A.diretor, 'corrigindo o que o fiscal apontou');
    doc = await chama(A.diretor, ['Reescreva o post corrigindo exatamente isto, e mais nada:', ...problemas(f).map((p) => `- ${p}`), '', '## Fontes', listaFontes, '', '## O post', doc].join('\n'));
    await escreve(A.diretor, 'corrigiu', doc);
    f = confere(doc);
  }

  /* O fiscal roda DEPOIS do parecer, e isto é de propósito: o parecer é um modelo
     conferindo outro, e o histórico da casa mostra que modelo deixa passar. Quem
     barra número sem fonte, empresa pelo nome, veículo pelo nome, inglês e
     testemunho inventado é o código, aqui embaixo, e é ele que tem a última
     palavra sobre publicar ou não. */

  /* A última chance, e ela é só do que barra: a correção anterior pode ter
     reaberto um problema do próprio fiscal. Pedir conserto de fecho aqui custaria
     uma chamada a mais num documento que já vai sair, então reparo não entra. */
  if (bloqueios(f).length) {
    await escreve(FISCAL, 'conferiu por código', bloqueios(f).map((p) => `- ${p}`).join('\n'));
    await pensa(A.diretor, 'última correção');
    doc = await chama(A.diretor, ['Reescreva o post corrigindo exatamente isto, e mais nada:', ...bloqueios(f).map((p) => `- ${p}`), '', '## Fontes', listaFontes, '', '## O post', doc].join('\n'));
    await escreve(A.diretor, 'corrigiu', doc);
    f = confere(doc);
  }
  if (bloqueios(f).length) {
    await escreve(FISCAL, 'barrou a publicação', ['O post não passou na conferência e não será publicado:', ...bloqueios(f).map((p) => `- ${p}`)].join('\n'));
    await registra('barrado', { tema: tema.tema, area: area.nome, marcas: marcasDoFiscal(f), entrou_com: marcasDeEntrada, pedido: !!pedido });
    return { falhou: `barrado pelo fiscal: ${bloqueios(f).join(' ')}` };
  }

  /* O Designer estava cego: até 24/09 ele recebia só o texto do post, sem a área
     e sem saber o que a casa já tinha gerado. Sobre um texto de tecnologia ele
     caía no cenário padrão de tecnologia, e o Rubens viu data center em quase
     todo prompt. Agora ele recebe onde o assunto acontece e o que não repetir. */
  const cenas = pedido ? [] : await destino.cenasRecentes(20).catch(() => []);
  await pensa(A.designer, 'pensando na imagem');
  const pedeImagem = (insistindo) => [
    `Pauta: ${tema.tema}`,
    `Área: ${area.nome}.`,
    area.cenario ? `Onde este assunto acontece no mundo físico: ${area.cenario}` : '',
    cenas.length ? `\n## Cenas que a casa já usou. NÃO repita nenhuma, nem chegue perto\n${[...new Set(cenas.map(cenaDe).filter(Boolean))].slice(0, 12).map((c) => `- ${c}`).join('\n')}` : '',
    insistindo ? `\nO seu prompt anterior caiu em "${insistindo}", e o post não fala disso. Cenário genérico de tecnologia é proibido quando o assunto não é literalmente ele. Ache o lugar DESTA pauta.` : '',
    '', '## O post', doc.slice(0, 2600),
  ].join('\n');

  let imagem = await chama(A.designer, pedeImagem(null));
  // a trava: sala de servidor só quando o post for sobre sala de servidor
  const generica = cenaGenerica(imagem, `${tema.tema} ${doc}`);
  if (generica) {
    log(`imagem caiu no cenário genérico ("${generica}") e o post não fala disso, pedindo outra`);
    await pensa(A.designer, 'a cena não era da pauta, refazendo');
    imagem = await chama(A.designer, pedeImagem(generica));
  }
  await escreve(A.designer, 'imagem', imagem);

  const pronto = await montaDocumento({ tema, area, doc, fontes, imagem, pedido });
  if (marcasDeEntrada.length) await registra('corrigido', { tema: tema.tema, area: area.nome, marcas: marcasDeEntrada, numero: pronto.numero, pedido: !!pedido });
  // o custo deste documento, do jeito que os fornecedores cobraram, incluindo os
  // temas que caíram antes dele: é o custo real de pôr um post na rua
  const tokens = { entrada: consumo.entrada, saida: consumo.saida, chamadas: consumo.chamadas, formato };
  log(`custo: ${tokens.chamadas} chamadas, ${tokens.entrada} tokens de entrada e ${tokens.saida} de saída (${formato})`);
  await registra('publicado', {
    tema: tema.tema, area: area.nome, numero: pronto.numero, titulo: pronto.titulo, fontes: fontes.length, pedido: !!pedido, tokens,
    ...(banca ? { bancada: area.bancada, cadeiras: banca.escolhidos, mesa: mesa.length } : {}),
  });
  return pronto;
}

/* ---------- o documento publicado ----------
   O post, o primeiro comentário com as referências e o prompt da imagem, num
   arquivo só, pronto para copiar. Os links são montados pelo código a partir da
   pesquisa: o modelo nunca escreve URL. */
async function montaDocumento({ tema, area, doc: bruto, fontes, imagem, pedido }) {
  /* O acento entra aqui, no mesmo lugar e pelo mesmo motivo do travessão: o papel
     pede português do Brasil e o modelo publicou "Protecao", "Gestao" e
     "termica" de qualquer jeito (auditoria de leitura, 30/09). Vale para o TEXTO,
     não para o primeiro comentário, que é montado com o título original das
     fontes, muitas em inglês, nem para o prompt da imagem, que é em inglês. */
  const doc = comAcento(semTravessao(bruto));
  const { post, usadas } = paraLinkedin(doc, fontes);
  const numero = pedido ? await destino.proximoNumeroPrivado() : await destino.proximoNumero();
  const titulo = tituloLimpo(comAcento(semTravessao((doc.match(/^\s*#\s+(.+)$/m) || [, tema.tema])[1])));
  const data = hoje();
  const refs = usadas.map((id, i) => { const x = fontes.find((f) => f.id === id); return `(${i + 1}) ${x.titulo}\n${x.url}`; });
  /* Sem fonte, o comentário diz isso, em vez de um cabeçalho com nada embaixo.
     Visto no balanço de 30/09: metade dos downloads trazia "Fontes citadas no
     post:" vazio, e quem baixa não sabe se é defeito ou se o post não tem fonte. */
  const comentario = refs.length
    ? ['Fontes citadas no post:', '', ...refs].join('\n')
    : 'Este post não cita fonte: ele saiu da discussão da mesa, sem material publicado de apoio, e por isso não traz número nenhum.';
  const img = semTravessao(imagem).replace(/\*\*/g, '').trim();
  const linha = '='.repeat(56);
  const texto = [
    `${pedido ? 'Pedido' : 'Documento'} ${numero} · ${data.split('-').reverse().join('/')}`,
    `Tema: ${tema.tema}`,
    `Área: ${area.nome}`,
    '',
    linha, `POST PARA O LINKEDIN (${post.length} caracteres, copie e cole)`, linha, '',
    post, '',
    linha, 'PRIMEIRO COMENTÁRIO (as referências, link fora do post)', linha, '',
    comentario, '',
    linha, 'IMAGEM (prompt para o gerador de imagem)', linha, '',
    // o tema vai junto do prompt: é a referência de quem gera a imagem, e amarra
    // a cena ao texto em vez de virar foto genérica de tecnologia
    `Pauta ilustrada: ${tema.tema}`,
    `Área: ${area.nome}`, '',
    img, '',
  ].join('\n');
  const id = `${pedido ? 'p' : ''}${data}-${String(numero).padStart(4, '0')}`;
  /* "markdown" guardava o MESMO texto de novo, dobrando o tamanho de cada
     documento à toa. Quem lê usa `doc.texto || doc.markdown`, então parar de
     gravá-lo não quebra nada e os antigos continuam abrindo pelo campo velho. */
  const pronto = { id, numero, titulo, tema: tema.tema, categoria: area.nome, data, post, comentario, imagem: img, texto, alertas: [], pedido: pedido?.id || null };
  // O arquivo só é gravado DEPOIS de o anúncio terminar de aparecer na tela. Ele
  // já está pronto antes, mas liberar o download enquanto a cena ainda corre faria
  // a lista encher sozinha, sem relação com o que se vê acontecendo.
  await escreve(A.diretor, 'publicou', `${pedido ? 'Pedido' : 'Documento'} ${numero}: ${titulo}\n\n${post}`);
  if (pedido) await destino.documentoPrivado(pronto);
  else {
    await destino.documento(pronto);
    // o índice é o que o site lê; sem ele o documento sai mas não aparece na lista
    try {
      await destino.gravaIndice(acrescenta(await destino.indice().catch(() => null), pronto));
    } catch (e) {
      log(`índice não atualizou: ${e.message}`);
    }
  }
  // a tela avisa que saiu documento novo, para a lista não esperar a próxima leitura
  E.publicou = { numero, titulo, em: agora() };
  await publica();
  return pronto;
}

/* ---------- o expediente do dia (horário de São Paulo) ----------
   Pedido do Rubens em 19/09:
     00h às 05h  folga: a bancada pública para
     05h às 06h  o Diretor monta a pauta do dia (comitê, no repositório privado)
     06h às 07h  pedidos "pode esperar" do administrador; se não der tempo, tudo bem
     07h         volta o ao vivo, em ponto
   Pedido do Rubens em 22/09:
     sábado e domingo a bancada não escreve pauta. No sábado, às 7h, ela se reúne
     para organizar o backlog da semana e avaliar a própria ferramenta; o resto do
     fim de semana é descanso. Pedido do administrador continua rodando.
   Pedido "para hoje" roda a qualquer hora: é urgente por definição.
   Documento público novo não começa depois das 23h40, para a bancada não entrar
   na folga no meio de um texto. */
const minutoSP = () => { const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number); return (h % 24) * 60 + m; };
// 0 domingo … 6 sábado, no fuso de São Paulo
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const diaSP = () => DIAS[new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date())];
// DIA_UTIL=1 faz o motor trabalhar como em dia de semana, para testar documento
// num sábado (no fim de semana ele só faz reunião e pauta)
const fimDeSemana = () => !process.env.DIA_UTIL && (diaSP() === 0 || diaSP() === 6);
// O sábado deste fim de semana, que é o nome da reunião: no sábado é hoje, no
// domingo é ontem. Meio-dia UTC para subtrair dias sem esbarrar em fuso.
function sabadoDaSemana() {
  const d = new Date(`${hoje()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((diaSP() + 1) % 7));
  return d.toISOString().slice(0, 10);
}
// O nome da fila desta semana. A conta mora em pautas.mjs, com teste.
const domingoDaFila = () => domingoDaSemana(hoje(), diaSP());
const noExpediente = () => { const m = minutoSP(); return m >= 7 * 60 && m < 23 * 60 + 40; };
const horaDosPedidos = () => { const m = minutoSP(); return m >= 6 * 60 && m < 7 * 60; };
const segundosAteAs7 = () => { const m = minutoSP(); return m < 7 * 60 ? (7 * 60 - m) * 60 : Infinity; };

// O que a tela pública mostra fora do expediente
function avisoForaDoExpediente() {
  const m = minutoSP();
  if (m >= 5 * 60 && m < 6 * 60) return { modo: 'pauta', aviso: 'O Diretor está montando a pauta do dia', acao: 'montando a pauta do dia' };
  return { modo: 'folga', aviso: 'A bancada volta às 7h', acao: 'folga' };
}

/* ---------- pedidos do administrador ---------- */

// O próximo pedido a fazer agora: o urgente sempre; os de "pode esperar" só entre
// 6h e 7h, depois que o Diretor fechou a pauta do dia.
async function proximoPedido() {
  const u = await destino.urgente().catch(() => null);
  const fila = (await destino.pedidos().catch(() => [])).filter((p) => p.status === 'fila').sort((a, b) => a.numero - b.numero);
  if (u?.id) {
    const p = fila.find((x) => x.id === u.id);
    if (p) return p;
    await destino.limpaUrgente();
  }
  const urgente = fila.find((p) => p.urgencia === 'hoje');
  if (urgente) return urgente;
  return horaDosPedidos() ? fila[0] || null : null;
}

async function fazPedido(p, tela = { modo: 'privado', aviso: 'Rodando no modo privado pelo Admin', acao: 'modo privado' }) {
  log(`pedido ${p.numero} do administrador: ${p.tema}`);
  await destino.atualizaPedido({ ...p, status: 'em produção', inicio: agora() });
  await avisoPublico(tela.modo, tela.aviso, tela.acao);
  privado = true;
  E = novoEstado();
  E.modo = 'privado';
  // é por esta marca que o admin sabe que tem trabalho privado para mostrar,
  // qualquer que seja o aviso da tela pública
  E.ativo = true;
  E.pedido = { id: p.id, numero: p.numero, tema: p.tema, urgencia: p.urgencia };
  let r;
  try {
    r = await umDocumento({ pedido: p });
  } catch (e) {
    r = { falhou: e.message };
    if (e.semCota) r.semCota = true;
  } finally {
    privado = false;
  }
  if (r?.id) await destino.atualizaPedido({ ...p, status: 'pronto', fim: agora(), documento: r.id, titulo: r.titulo });
  else if (r?.semCota) await destino.atualizaPedido({ ...p, status: 'fila', obs: 'cota do dia acabou no meio; volta para a fila' });
  else await destino.atualizaPedido({ ...p, status: 'falhou', fim: agora(), motivo: r?.falhou || 'erro' });
  const u = await destino.urgente().catch(() => null);
  if (u?.id === p.id) await destino.limpaUrgente();
  await destino.estadoPrivado({ ...E, ativo: false, atualizado: agora() }).catch(() => {});
  E = novoEstado();
  E.atual = { agente: 'Diretor', id: 'diretor', acao: 'pedido encerrado, voltando ao ao vivo', texto: '', pensando: true, inicio: agora() };
  await publica();
  if (r?.semCota) throw Object.assign(new Error('sem cota'), { semCota: true });
}

/* ---------- a reunião de sábado ----------
   Uma vez por fim de semana, e à vista de quem estiver no site: a bancada lê o
   diário da semana, separa o backlog e diz o que falta na ferramenta.

   Duas chamadas em vez de uma porque o Groq corta a saída em 2.500 tokens e as
   duas respostas juntas não cabem. Separadas, cada uma tem espaço de sobra.

   Nada do que sai daqui muda o sistema sozinho. Vira cartão no /admin/. */
async function fazReuniao(id) {
  const dias = await destino.diasDoDiario(7).catch(() => []);
  const p = pauta(dias);

  await avisoPublico('reuniao', 'Sábado de manhã: a bancada está em reunião, olhando a semana que passou.', 'reunião de sábado');
  E = novoEstado();
  E.modo = 'reuniao';
  E.aviso = 'Reunião de sábado: o que a semana mostrou';

  // semana sem diário nenhum: não há o que discutir, e inventar seria o oposto
  // do motivo de a reunião existir
  if (!p.resumo.episodios) {
    await escreve(A.diretor, 'abriu a reunião', 'Não há diário desta semana para ler. Sem registro, não há o que concluir: a reunião fica para o próximo sábado.');
    const vazia = { id, numero: Number(id.replace(/-/g, '')), quando: agora(), semana: p.resumo.dias, vazia: true, backlog: [], arquivar: [], sugestoes: [], resumo: p.resumo };
    await destino.gravaReuniao(vazia).catch((e) => log(`reunião não gravou: ${e.message}`));
    return vazia;
  }

  await escreve(A.diretor, 'abriu a reunião', [
    `Semana de ${p.resumo.dias.slice(-1)[0]} a ${p.resumo.dias[0]}.`,
    `${p.resumo.tentativas} tentativas de documento, ${p.resumo.publicados} publicados, ${p.recusadas.length} temas recusados.`,
    '', 'Hoje não escrevemos pauta. Olhamos o que não deu certo e por quê.',
  ].join('\n'));

  /* 1. O backlog, com o Pesquisador: foi ele que recusou cada um desses temas
        por falta de fonte, então é dele a leitura de quais valem outra busca. */
  await pensa(A.pesquisador, `relendo os ${p.recusadas.length} temas recusados da semana`);
  const b = await chama(A.pesquisador, [
    'Você está na reunião de sábado. Não é para escrever documento nenhum hoje.',
    'Esta é a lista dos temas que a bancada quis escrever nesta semana e não conseguiu, cada um com o código do episódio e o motivo.',
    '',
    'Separe em dois grupos: os que valem outra tentativa na semana que vem, e os que não valem.',
    'Vale outra tentativa quando o problema era a busca (estreita demais, com nome próprio, com ano ou país) ou o recorte, e não o assunto.',
    'Não vale quando o assunto não tem fonte pública confiável, ou quando é parecido demais com o que já foi publicado.',
    '',
    'Use SÓ os códigos que estão na lista. Não invente código nem tema que não esteja aqui.',
    '', p.texto,
  ].join('\n'), SCHEMA_BACKLOG);

  const retomar = filtraBacklog(b.retomar, p.recusadas);
  const arquivar = filtraBacklog(b.arquivar, p.recusadas);
  await escreve(A.pesquisador, 'fechou o backlog da semana', [
    `${retomar.passaram.length} temas voltam para a mesa na semana que vem, ${arquivar.passaram.length} ficam de fora.`,
    '', ...retomar.passaram.map((x) => `[${x.episodio}] ${x.tema}\n  ${x.porque}`),
    ...(retomar.caidas.length + arquivar.caidas.length ? ['', `(${retomar.caidas.length + arquivar.caidas.length} item(ns) citando episódio que não existe no diário, descartados pelo sistema.)`] : []),
  ].join('\n'));

  /* 2. A avaliação da ferramenta, com o Auditor: o trabalho dele já é olhar o
        que saiu e dizer o que está errado. Aqui ele olha a semana inteira. */
  await pensa(A.auditor, 'somando a semana e procurando o que se repete');
  const sg = await chama(A.auditor, [
    'Você está na reunião de sábado. Hoje você não confere um post: você olha a semana inteira da bancada e diz o que falta na ferramenta.',
    '',
    'A pergunta é esta: o que aconteceu vezes suficientes nesta semana para merecer existir no sistema, e hoje não existe?',
    'Sugestão boa é sobre o trabalho que você enxerga aqui: como o tema é escolhido, como a fonte é buscada, o que o fiscal confere, quando a bancada desiste.',
    'Você NÃO enxerga o site, o blog, a geração de imagem nem a área do administrador. Não opine sobre eles.',
    '',
    'REGRA DURA: cada sugestão precisa citar os códigos dos episódios desta semana que a sustentam. Sem episódio, a sugestão é descartada pelo sistema antes de chegar na tela.',
    'Prefira duas sugestões sustentadas a quatro inventadas.',
    '', p.texto,
  ].join('\n'), SCHEMA_SUGESTOES);

  const sug = filtraSugestoes(sg.sugestoes, dias);
  await escreve(A.auditor, 'avaliação da semana', sug.passaram.length ? [
    ...sug.passaram.map((x) => `**${x.titulo}**\n${x.observacao}\nProposta: ${x.proposta}\nEpisódios: ${x.episodios.join(', ')}`),
    ...(sug.caidas.length ? ['', `(${sug.caidas.length} sugestão(ões) sem episódio que a sustentasse, descartada(s) pelo sistema.)`] : []),
  ].join('\n\n') : 'Nenhuma sugestão desta semana se sustentou nos episódios do diário. Prefiro não propor nada a propor achismo.');

  const r = {
    id, numero: Number(id.replace(/-/g, '')), quando: agora(), semana: p.resumo.dias,
    backlog: retomar.passaram, arquivar: arquivar.passaram, sugestoes: sug.passaram,
    descartadas: { backlog: retomar.caidas.length + arquivar.caidas.length, sugestoes: sug.caidas },
    resumo: p.resumo, status: 'aberta',
  };
  await destino.gravaReuniao(r).catch((e) => log(`reunião não gravou: ${e.message}`));
  await escreve(A.diretor, 'encerrou a reunião', [
    `${r.backlog.length} temas no backlog da semana que vem e ${r.sugestoes.length} sugestão(ões) para o Rubens decidir.`,
    'Nada disso muda a bancada sozinho: ele aceita ou descarta no painel.',
    '', 'Bom fim de semana. Segunda às 7h a gente volta.',
  ].join('\n'));
  log(`reunião ${id}: ${r.backlog.length} no backlog, ${r.sugestoes.length} sugestões, ${r.descartadas.sugestoes.length} descartadas`);
  return r;
}

/* ---------- a pauta da semana ----------
   Domingo de manhã. O sábado olhou para trás; este é o olhar para a frente, e
   quem faz é outra gente: no sábado a equipe titular lê o diário da casa inteira,
   no domingo é o cabeça de cada tema, que é quem sabe o que vale a pena naquele
   assunto. A CTO monta Programação e Dados, a CISO monta Cibersegurança, o
   Diretor de Supply Chain monta Varejo, a Diretora de RH monta Carreira.

   O que sai daqui é uma fila, e fila não é ordem de serviço: a semana só começa
   pelo que está nela enquanto ela durar. Vazia ou acabada, a segunda-feira
   funciona como funcionava antes de isto existir. */
async function fazPautaDaSemana(id) {
  const reuniao = await destino.reuniao(sabadoDaSemana()).catch(() => null);
  const recentes = await destino.temasRecentes(200).catch(() => []);

  await avisoPublico('pautasemana', 'Domingo de manhã: os cabeças de cada tema estão montando a pauta da semana.', 'pauta da semana');
  E = novoEstado();
  E.modo = 'pautasemana';
  E.aviso = 'Domingo de pauta: a semana que vem sendo montada';

  A = TITULARES;
  await escreve(A.diretor, 'abriu a pauta da semana', [
    'Hoje não escrevemos documento. Cada um de vocês vai deixar a pauta da sua área pronta para a semana.',
    reuniao?.backlog?.length
      ? `A reunião de ontem devolveu ${reuniao.backlog.length} tema(s) que valem outra tentativa. Quem for da área, reaproveite com o recorte consertado.`
      : 'Não há backlog de ontem para reaproveitar: a pauta sai do zero.',
    '', `No máximo ${POR_AREA} temas por área. Tema repetido o sistema corta aqui mesmo, antes de virar fila.`,
  ].join('\n'));

  const itens = []; const caidas = [];
  for (const area of AREAS_ATIVAS) {
    // numero 0: cada tema tem um cabeça só, então o rodízio devolve sempre ele
    sentaBancada(area, 0);
    const cabeca = A.diretor;
    const backlog = backlogDaArea(reuniao, area.nome);

    await pensa(cabeca, `montando a pauta de ${area.nome}`);
    let p;
    try {
      p = await chama(cabeca, [
        `Amanhã começa a semana. Você responde por **${area.nome}** e está montando a pauta da sua área.`,
        `A área é: ${area.foco}.`,
        area.regra ? `\nA regra desta área: ${area.regra}` : '',
        oJeitoDaCadeira(cabeca),
        '',
        `Escolha até ${POR_AREA} temas para a bancada escrever nos próximos dias. Um tema por assunto: não desdobre o mesmo assunto em variações.`,
        'Sem nome de empresa. Cada tema precisa ter chance real de ter fonte pública e confiável nesta semana.',
        '', REGRA_BUSCA,
        recentes.length ? `\nTemas já publicados, NÃO repita nem chegue perto:\n${recentes.slice(-45).map((r) => `- ${r}`).join('\n')}` : '',
        backlog.length ? `\nTemas que a bancada tentou nesta semana e não conseguiu escrever. A reunião de ontem disse que valem outra tentativa; pegue os que você acha que valem e conserte o recorte:\n${backlog.map((b) => `- ${b.tema} (${b.porque})`).join('\n')}` : '',
      ].join('\n'), SCHEMA_PAUTAS);
    } catch (err) {
      // uma área que falhe não derruba as outras: a fila sai menor, e menor é
      // melhor que nenhuma
      if (err.semCota) throw err;
      log(`pauta de ${area.nome} falhou: ${err.message}`);
      continue;
    }

    // o que é de outra mesa cai antes de virar fila: um tema invasor guardado no
    // domingo só cobraria a vaga na quarta, longe de quem poderia ligar a causa
    const invasores = [];
    const doTema = (p.pautas || []).filter((x) => {
      const inv = foraDaArea(x.tema, area, AREAS_ATIVAS);
      if (inv) { invasores.push({ ...x, motivo: `é tema de ${inv.area}` }); return false; }
      return true;
    });
    const f = filtraPautas(doTema, { recentes, jaAceitos: itens, area: area.nome, bancada: area.bancada, cabeca: cabeca.nome });
    f.caidas.push(...invasores);
    itens.push(...f.passaram); caidas.push(...f.caidas);

    await escreve(cabeca, `fechou a pauta de ${area.nome}`, [
      f.passaram.length
        ? f.passaram.map((x, n) => `${n + 1}. ${x.tema}\n   ${x.porque}`).join('\n\n')
        : 'Não fechei tema nenhum que se sustentasse. Prefiro entregar a área vazia a entregar repetição.',
      ...(f.caidas.length ? ['', `(${f.caidas.length} descartado(s) pelo sistema: ${[...new Set(f.caidas.map((c) => c.motivo))].join('; ')}.)`] : []),
    ].join('\n'));
  }

  A = TITULARES;
  const fila = {
    id, numero: Number(id.replace(/-/g, '')), quando: agora(),
    itens, descartadas: caidas.length, sabado: reuniao?.id || null,
  };
  await destino.gravaPautaSemana(fila).catch((e) => log(`pauta da semana não gravou: ${e.message}`));

  await escreve(A.diretor, 'fechou a pauta da semana', itens.length ? [
    `${itens.length} temas na fila da semana, ${caidas.length} descartado(s) pelo sistema.`,
    ...AREAS_ATIVAS.map((a) => `- ${a.nome}: ${itens.filter((i) => i.area === a.nome).length}`),
    '', 'Isto não é ordem de serviço: se um tema envelhecer durante a semana, quem estiver na cadeira escolhe outro na hora.',
    '', 'Segunda às 7h a gente começa por aqui.',
  ].join('\n') : 'A fila saiu vazia: nada do que foi proposto hoje passou nas travas. Segunda-feira o Diretor escolhe na hora, como antes.');

  log(`pauta da semana ${id}: ${itens.length} temas, ${caidas.length} descartados`);
  return fila;
}

/* O tema que o cabeça da área deixou pronto no domingo. Devolve null quando a
   fila acabou, e aí o Diretor escolhe na hora.

   A fila não escapa da trava de repetição: um tema montado no domingo pode ter
   ficado parecido com algo publicado na terça, e nesse caso ele cai aqui do mesmo
   jeito que cairia se tivesse sido escolhido agora. */
async function pegaDaFila(area, recentes) {
  if (!area?.nome) return null;
  const fila = await destino.pautaSemana(domingoDaFila()).catch(() => null);
  const item = proximaPauta(fila, area.nome);
  if (!item) return null;

  marcaUsada(fila, item.id);
  await destino.gravaPautaSemana(fila).catch((e) => log(`fila da semana não gravou: ${e.message}`));

  const repetido = recentes.find((r) => parecido(r, item.tema) >= 0.45);
  if (repetido) {
    log(`pauta da semana "${item.tema}" envelheceu (parecida com "${repetido}"), descartada`);
    await registra('repetido', { tema: item.tema, area: area.nome, parecido: repetido, daFila: true });
    return null;
  }

  await escreve(A.diretor, 'pegou o tema da pauta da semana', [
    `${item.tema}`, '', item.porque, '',
    `(Da pauta que ${item.cabeca} montou no domingo. Sobram ${quantoSobrou(fila, area.nome)} temas desta área na fila.)`,
  ].join('\n'));
  return item;
}

/* ---------- o turno ---------- */
const fim = Date.now() + DURACAO_MIN * 60000;
log(`turno de ${DURACAO_MIN} min, ${CPS} letras/s, destino ${destino.nome}`);
// turno mais curto que a margem do fim não pega trabalho nenhum, e sem este aviso
// isso sai como um turno que rodou, não fez nada e não disse por quê
if (DURACAO_MIN <= MARGEM_FIM_MIN) log(`ATENÇÃO: turno de ${DURACAO_MIN} min é menor que a margem de fim (${MARGEM_FIM_MIN} min), nenhum documento será começado`);
if (elenco.troca) log(`elenco de hoje: ${elenco.troca.nome} no lugar do titular de ${elenco.troca.substitui}`);

/* O índice, montado de uma vez quando não existe. É trabalho pesado (lê todos os
   documentos) e por isso mora AQUI, no Node do Actions, que tem memória: a
   função de borda que serve a lista não aguentava e era justamente esse o
   problema. Se ele sumir ou nascer torto, o próximo turno remonta sozinho. */
try {
  const indiceAtual = await destino.indice().catch(() => null);
  // formato velho também remonta: é assim que um conserto de entrada alcança os
  // documentos que já estavam indexados, e não só os que vierem depois
  const precisa = !indiceAtual?.itens?.length || indiceAtual.versao !== VERSAO;
  if (precisa) {
    const todos = await destino.todosDocumentos();
    const novo = monta(todos);
    if (novo.itens.length) {
      await destino.gravaIndice(novo);
      log(`índice ${indiceAtual?.itens?.length ? `remontado (formato ${indiceAtual.versao || 1} para ${VERSAO})` : 'montado do zero'}: ${novo.itens.length} documentos`);
    }
  } else {
    log(`índice com ${indiceAtual.itens.length} documentos, formato ${indiceAtual.versao}`);
  }
} catch (e) {
  // o índice é a vitrine, não a produção: sem ele a bancada continua escrevendo
  log(`índice não pôde ser conferido: ${e.message}`);
}
let feitos = 0;

while (Date.now() < fim - MARGEM_FIM_MIN * 60000 * FATOR) {
  // virou o dia: o elenco pode ter mudado
  if (hoje() !== diaDoElenco) {
    elenco = await elencoDoDia(); diaDoElenco = hoje();
    TITULARES = Object.fromEntries([...elenco.equipe, elenco.diretor].map((a) => [a.id, a]));
    A = TITULARES;
  }
  try {
    // pausa do administrador: termina o documento em curso (esta conferência só
    // acontece entre documentos) e a bancada vai lanchar até ele liberar
    const pausa = await destino.pausa().catch(() => null);
    if (pausa?.ativa) {
      const avisoLanche = pausa.aviso || 'Rodando um pedido do Rubens no modo privado';
      // no lanche a tela pública fica parada, mas pedido do administrador roda:
      // só ele vê o trabalho, pelo admin
      const pedidoNoLanche = await proximoPedido();
      if (pedidoNoLanche) { await fazPedido(pedidoNoLanche, { modo: 'lanche', aviso: avisoLanche, acao: 'hora do lanche' }); feitos++; continue; }
      await avisoPublico('lanche', avisoLanche, 'hora do lanche');
      log('pausa do administrador, bancada no lanche');
      await dorme(60);
      continue;
    }

    /* Fim de semana: a produção de pauta para. O que continua é o pedido do
       administrador, porque ele é trabalho dele, não da bancada. */
    if (fimDeSemana()) {
      const aviso = { modo: 'fimdesemana', aviso: 'A bancada descansa no fim de semana. Volta segunda às 7h.', acao: 'fim de semana' };
      const pedidoFds = await proximoPedido();
      if (pedidoFds) { await fazPedido(pedidoFds, aviso); feitos++; continue; }
      // a reunião: sábado, dentro do expediente, uma vez só por fim de semana
      const sabado = sabadoDaSemana();
      if (diaSP() === 6 && noExpediente() && !(await destino.reuniao(sabado).catch(() => null))) {
        await fazReuniao(sabado);
        continue;
      }
      // domingo: os cabeças de cada tema montam a pauta da semana, uma vez só
      const domingo = domingoDaFila();
      if (diaSP() === 0 && noExpediente() && !(await destino.pautaSemana(domingo).catch(() => null))) {
        await fazPautaDaSemana(domingo);
        continue;
      }
      await avisoPublico(aviso.modo, aviso.aviso, aviso.acao);
      await dorme(5 * 60);
      continue;
    }

    // fora do expediente a tela pública descansa; pedido do administrador roda
    // por trás (o urgente a qualquer hora, o "pode esperar" entre 6h e 7h)
    if (!noExpediente()) {
      const fora = avisoForaDoExpediente();
      const pedidoFora = await proximoPedido();
      if (pedidoFora) { await fazPedido(pedidoFora, fora); feitos++; continue; }
      await avisoPublico(fora.modo, fora.aviso, fora.acao);
      // acorda em ponto às 7h, sem esperar o minuto inteiro
      await dorme(Math.max(5, Math.min(60, segundosAteAs7())));
      continue;
    }

    // o Diretor montando a pauta do dia (comitê da madrugada): a bancada para e espera
    const d = await destino.diretor().catch(() => null);
    if (d?.rodando && Date.now() - Date.parse(d.desde || 0) < 3 * 3600000) {
      await avisoPublico('pauta', 'O Diretor está montando a pauta do dia', 'montando a pauta do dia');
      log('Diretor montando a pauta do dia, bancada em espera');
      await dorme(90);
      continue;
    }

    const pedido = await proximoPedido();
    if (pedido) { await fazPedido(pedido); feitos++; }
    else {
      E = novoEstado();
      inicioDoDocumento = Date.now();
      const doc = await umDocumento();
      if (doc?.id) feitos++;
    }
  } catch (e) {
    privado = false;
    if (e instanceof Interrompido) {
      log(`interrompido por pedido urgente do administrador (${e.message})`);
      continue;
    }
    if (e.semCota) {
      // a cota volta sozinha: fica esperando dentro do turno, tentando de tempos em tempos
      log('cota gratuita do dia esgotada, esperando');
      await registra('sem_cota', {});
      await avisoPublico('cota', 'A cota gratuita de IA acabou por agora. A bancada volta sozinha quando ela renovar.', 'esperando a cota renovar');
      await dorme(20 * 60);
      liberaCotas();
      continue;
    }
    log(`erro no documento: ${e.message}`);
    await escreve(A.diretor, 'pausa', 'Um passo falhou. Pausa curta e recomeço.').catch(() => {});
  }
  E = novoEstado();
  E.atual = { agente: 'Diretor', id: 'diretor', acao: 'pensando no próximo tema', texto: '', pensando: true, inicio: agora() };
  /* O compasso do dia. O freio do Groq não é o número de chamadas: são 200 mil
     tokens por dia POR MODELO, 600 mil no total. Cada documento gasta uns 11 mil
     depois do corte dos trechos de fonte, então a cota dá umas 50 peças. Espaçando
     um documento a cada 20 minutos, as 17 horas de expediente cabem na cota; sem
     isso, em 20/09 a bancada fez 36 documentos em 7 horas e ficou parada até a noite. */
  const faltaDoCompasso = Math.max(0, INTERVALO_MIN * 60 - (Date.now() - inicioDoDocumento) / 1000);
  if (faltaDoCompasso > 0) log(`compasso: ${Math.round(faltaDoCompasso / 60)} min até o próximo documento`);
  // a tela mostra a hora do próximo, para a pausa do compasso não parecer travamento
  E.proximo = new Date(Date.now() + faltaDoCompasso * 1000).toISOString();
  await publica();
  // a espera entre documentos também para na hora se chegar pedido urgente
  for (let s = 0, total = Math.max(40 + Math.random() * 40, faltaDoCompasso); s < total; s += 20) {
    await dorme(Math.min(20, total - s));
    if ((await destino.urgente().catch(() => null))?.id) break;
  }
  // UM_DOCUMENTO=1 para conferir um fluxo inteiro; UM_DOCUMENTO=5 para ver cinco,
  // que é o tamanho de amostra que o Rubens pede antes de subir mudança de texto
  if (process.env.UM_DOCUMENTO && feitos >= (Number(process.env.UM_DOCUMENTO) || 1)) break;
}
/* O fim do turno. No fim de semana a tela NÃO pode voltar para o modo público:
   o vigia lê a lista fechada de motivos, não acharia "publico" nela, veria um
   estado parado em horário de expediente e religaria o turno. O painel do
   administrador mostraria "travada há N min" o sábado inteiro, por nada. */
if (fimDeSemana()) {
  await avisoPublico('fimdesemana', 'A bancada descansa no fim de semana. Volta segunda às 7h.', 'fim de semana');
} else {
  E = novoEstado();
  E.atual = { agente: 'Diretor', id: 'diretor', acao: 'troca de turno', texto: '', pensando: true, inicio: agora() };
  await publica();
}
log(`turno encerrado: ${feitos} documento(s)`);
