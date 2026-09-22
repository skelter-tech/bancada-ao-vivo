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

const estado = await db.le('aovivo/estado').catch(() => null);
const agora = new Date();
const idade = estado?.atualizado ? (agora - Date.parse(estado.atualizado)) / 60000 : Infinity;
const m = minutoSP();
const expediente = m >= 7 * 60 && m < 23 * 60 + 50;

// Esta lista é fechada de propósito, e é ela que separa "parada de propósito" de
// "travada". Um modo que o motor use e que não esteja aqui cai no galho de baixo,
// vira "travada há N min" e o vigia religa o turno por cima de uma parada que era
// para acontecer. Modo novo no motor entra aqui na mesma mudança.
const MOTIVO = {
  folga: 'de folga, volta às 7h',
  reuniao: 'em reunião de fim de semana',
  fimdesemana: 'descansando, volta segunda às 7h',
  pauta: 'o Diretor está montando a pauta do dia',
  cota: 'esperando a cota gratuita renovar',
  privado: 'num pedido do administrador',
  lanche: 'parada a pedido do administrador',
};

let situacao; let acao = '';
if (!estado) situacao = 'sem sinal do motor';
else if (MOTIVO[estado.modo]) situacao = MOTIVO[estado.modo];
else if (!expediente) situacao = 'fora do expediente';
else if (idade > TRAVADA_MIN) situacao = `travada há ${Math.round(idade)} min`;
else situacao = `trabalhando (${estado.atual?.agente}: ${estado.atual?.acao})`;

// religar é a única coisa que ele faz: um turno novo, que a corrente mantém
if (/travada|sem sinal/.test(situacao) && expediente) {
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
