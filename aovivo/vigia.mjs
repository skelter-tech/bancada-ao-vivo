// O vigia da bancada. Roda no GitHub de meia em meia hora, sozinho, com o PC do
// Rubens desligado. Ele olha o estado no Firestore e decide três coisas:
//
//   1. a bancada está trabalhando?          nada a fazer
//   2. está parada por um motivo conhecido? (folga, pauta do dia, cota, modo
//      privado, fim de semana) registra e não mexe
//   3. está travada em horário de expediente? religa o turno
//
// O que ele vê fica gravado em vigia/estado, e o administrador lê isso no /admin/.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { conectar } from '../src/firestore.mjs';

const conta = process.env.FIREBASE_CONTA || readFileSync(new URL('../.chave-firebase.json', import.meta.url), 'utf8');
const db = conectar(conta);
const REPO = process.env.GITHUB_REPOSITORY || 'skelter-tech/bancada-ao-vivo';
const TRAVADA_MIN = 25;

const minutoSP = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date()).split(':').map(Number);
  return (h % 24) * 60 + m;
};

/* Ler o estado e FALHAR ao ler são coisas diferentes, e até 24/09 o vigia tratava
   as duas como "motor morto": o .catch devolvia null, o null virava "sem sinal do
   motor" e ele religava o turno. Religar não conserta Firestore fora do ar, então
   o que ele fazia era queimar um turno a cada meia hora enquanto o motor estava
   vivo e trabalhando do outro lado. */
let erroDeLeitura = null;
const estado = await db.le('aovivo/estado').catch((e) => { erroDeLeitura = e; return null; });
const agora = new Date();
const idade = estado?.atualizado ? (agora - Date.parse(estado.atualizado)) / 60000 : Infinity;

/* O compasso entre documentos não é travamento. O motor já publica a hora do
   próximo documento para a tela não parecer parada; o vigia passa a ler o mesmo
   campo. Antes ele comparava com TRAVADA_MIN=25, que virou mentira quando o
   INTERVALO_MIN subiu para 35 em 23/09: todo intervalo normal passou a parecer
   travada. Usar a hora que o próprio motor anunciou dispensa manter dois números
   iguais em dois arquivos, que é justamente o que se desencontrou. */
const GRACA_MIN = 6;
const esperando = !!estado?.proximo && Date.parse(estado.proximo) > agora - GRACA_MIN * 60000;
const m = minutoSP();
const expediente = m >= 7 * 60 && m < 23 * 60 + 50;

// Esta lista é fechada de propósito, e é ela que separa "parada de propósito" de
// "travada". Um modo que o motor use e que não esteja aqui cai no galho de baixo,
// vira "travada há N min" e o vigia religa o turno por cima de uma parada que era
// para acontecer. Modo novo no motor entra aqui na mesma mudança.
const MOTIVO = {
  folga: 'de folga, volta às 7h',
  reuniao: 'em reunião de fim de semana',
  pautasemana: 'montando a pauta da semana',
  // o formato do trabalho está sendo refeito: pode ficar 24 horas assim, e isso
  // NÃO é travada. Enquanto este modo estiver no estado, o vigia não religa nada.
  melhorias: 'parada para melhorias, pode passar 24 horas assim',
  fimdesemana: 'descansando, volta segunda às 7h',
  pauta: 'o Diretor está montando a pauta do dia',
  cota: 'esperando a cota gratuita renovar',
  privado: 'num pedido do administrador',
  lanche: 'parada a pedido do administrador',
};

let situacao; let acao = '';
if (erroDeLeitura) situacao = `não consegui ler o estado: ${String(erroDeLeitura.message).slice(0, 120)}`;
else if (!estado) situacao = 'sem sinal do motor';
else if (MOTIVO[estado.modo]) situacao = MOTIVO[estado.modo];
else if (!expediente) situacao = 'fora do expediente';
else if (esperando) situacao = `no compasso, próximo documento às ${new Date(estado.proximo).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`;
else if (idade > TRAVADA_MIN) situacao = `travada há ${Math.round(idade)} min`;
else situacao = `trabalhando (${estado.atual?.agente}: ${estado.atual?.acao})`;

/* Religar é a única coisa que ele faz, e só quando religar resolve. Falha de
   leitura fica de fora de propósito: ali o problema é o banco ou a chave, e um
   turno novo não toca em nenhum dos dois. */
if (/travada|sem sinal/.test(situacao) && !erroDeLeitura && expediente) {
  try {
    execSync(`gh workflow run turno.yml --repo ${REPO}`, { stdio: 'pipe' });
    acao = 'religou o turno';
  } catch (e) {
    acao = `não consegui religar: ${String(e.message).split('\n')[0].slice(0, 120)}`;
  }
}

const anterior = await db.le('vigia/estado').catch(() => null);
const registro = {
  quando: agora.toISOString(),
  situacao,
  acao,
  modo: estado?.modo || null,
  idadeMin: Number.isFinite(idade) ? Math.round(idade) : null,
  documentos: (await db.listaPorNumero('documentos', 1).catch(() => []))[0]?.numero || null,
};
await db.grava('vigia/estado', { ...registro, historico: [registro, ...(anterior?.historico || [])].slice(0, 48) });
console.log(`${registro.quando} ${situacao}${acao ? ` | ${acao}` : ''}`);
