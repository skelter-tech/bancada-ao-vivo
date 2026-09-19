// Para onde vai o que o ao vivo produz. Duas saídas com a mesma interface:
//   arquivo   grava em aovivo/saida/, para testar sem internet nem Firebase
//   firestore grava no Firestore, que é o que o site lê (ligado quando a chave existe)
//
// O que mora onde, no Firestore:
//   aovivo/estado        o que a tela pública mostra agora
//   documentos/{id}      os documentos públicos, para qualquer um baixar
//   privado/estado       o que a bancada faz num pedido do administrador
//   privados/{id}        os documentos dos pedidos, só o administrador baixa
//   pedidos/{id}         os pedidos do administrador e em que pé estão
//   controle/urgente     o pedido "para hoje" que faz a bancada parar na hora
//   controle/diretor     o Diretor montando a pauta do dia (escrito pelo comitê)
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { conectar } from '../src/firestore.mjs';

// Firestore quando existe a conta de serviço (FIREBASE_CONTA no ambiente, ou o
// arquivo .chave-firebase.json na raiz); arquivo local quando não existe.
export async function destinoPadrao(raiz) {
  // DESTINO=arquivo para testar no PC sem disputar a tela pública com o turno que
  // estiver rodando no GitHub: dois motores no mesmo Firestore se atropelariam
  if (process.env.DESTINO === 'arquivo') return destinoArquivo(raiz);
  const conta = process.env.FIREBASE_CONTA || await readFile(join(raiz, '.chave-firebase.json'), 'utf8').catch(() => '');
  return conta ? destinoFirestore(conta) : destinoArquivo(raiz);
}

const comNumero = (n) => ({ numero: { integerValue: String(n) } });

export function destinoFirestore(conta) {
  const db = conectar(conta);
  const proximo = async (colecao) => {
    const [ultimo] = await db.listaPorNumero(colecao, 1);
    return ultimo ? ultimo.numero + 1 : 1;
  };
  return {
    nome: `firestore (${db.projeto})`,
    estado: (e) => db.grava('aovivo/estado', e),
    estadoPrivado: (e) => db.grava('privado/estado', e),
    proximoNumero: () => proximo('documentos'),
    proximoNumeroPrivado: () => proximo('privados'),
    // "numero" também vai como campo numérico de verdade: é por ele que a lista
    // é ordenada, e consulta não enxerga dentro do texto JSON
    documento: (doc) => db.grava(`documentos/${doc.id}`, doc, comNumero(doc.numero)),
    documentoPrivado: (doc) => db.grava(`privados/${doc.id}`, doc, comNumero(doc.numero)),
    async temasRecentes(n = 40) {
      return (await db.listaPorNumero('documentos', n)).map((d) => d.tema).reverse();
    },
    urgente: () => db.le('controle/urgente'),
    limpaUrgente: () => db.apaga('controle/urgente').catch(() => {}),
    diretor: () => db.le('controle/diretor'),
    pedidos: () => db.listaPorNumero('pedidos', 40),
    atualizaPedido: (p) => db.grava(`pedidos/${p.id}`, p, comNumero(p.numero)),
  };
}

export function destinoArquivo(raiz) {
  const dir = join(raiz, 'aovivo', 'saida');
  const le = async (f, padrao) => JSON.parse(await readFile(join(dir, f), 'utf8').catch(() => JSON.stringify(padrao)));
  const grava = async (f, obj) => { await mkdir(dir, { recursive: true }); await writeFile(join(dir, f), JSON.stringify(obj, null, 1), 'utf8'); };
  const indice = (arq) => ({
    async proximo() { const idx = await le(arq, []); return idx.length ? Math.max(...idx.map((d) => d.numero)) + 1 : 1; },
    async grava(doc, pasta) {
      await mkdir(join(dir, pasta), { recursive: true });
      await writeFile(join(dir, pasta, `${doc.id}.txt`), doc.texto || doc.markdown, 'utf8');
      const idx = await le(arq, []);
      idx.push({ id: doc.id, numero: doc.numero, titulo: doc.titulo, tema: doc.tema, categoria: doc.categoria, data: doc.data, alertas: doc.alertas });
      await grava(arq, idx);
    },
  });
  const pub = indice('documentos.json');
  const priv = indice('privados.json');
  return {
    nome: 'arquivo',
    estado: (e) => grava('estado.json', e),
    estadoPrivado: (e) => grava('estado-privado.json', e),
    proximoNumero: () => pub.proximo(),
    proximoNumeroPrivado: () => priv.proximo(),
    documento: (doc) => pub.grava(doc, 'documentos'),
    documentoPrivado: (doc) => priv.grava(doc, 'privados'),
    async temasRecentes(n = 40) { return (await le('documentos.json', [])).slice(-n).map((d) => d.tema); },
    // no teste local, pedidos e controle são arquivos que você edita à mão
    urgente: () => le('urgente.json', null),
    limpaUrgente: () => rm(join(dir, 'urgente.json'), { force: true }),
    diretor: () => le('diretor.json', null),
    async pedidos() { return (await le('pedidos.json', [])).sort((a, b) => b.numero - a.numero); },
    async atualizaPedido(p) { const l = await le('pedidos.json', []); await grava('pedidos.json', [...l.filter((x) => x.id !== p.id), p]); },
  };
}
