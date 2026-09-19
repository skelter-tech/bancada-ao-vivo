// Para onde vai o que o ao vivo produz. Duas saídas com a mesma interface:
//   arquivo   grava em aovivo/saida/, para testar sem internet nem Firebase
//   firestore grava no Firestore, que é o que o site lê (ligado quando a chave existe)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

export function destinoFirestore(conta) {
  const db = conectar(conta);
  return {
    nome: `firestore (${db.projeto})`,
    estado: (e) => db.grava('aovivo/estado', e),
    async proximoNumero() {
      const [ultimo] = await db.listaPorNumero('documentos', 1);
      return ultimo ? ultimo.numero + 1 : 1;
    },
    // "numero" também vai como campo numérico de verdade: é por ele que a lista
    // é ordenada, e consulta não enxerga dentro do texto JSON
    documento: (doc) => db.grava(`documentos/${doc.id}`, doc, { numero: { integerValue: String(doc.numero) } }),
    async temasRecentes(n = 40) {
      return (await db.listaPorNumero('documentos', n)).map((d) => d.tema).reverse();
    },
  };
}

export function destinoArquivo(raiz) {
  const dir = join(raiz, 'aovivo', 'saida');
  return {
    nome: 'arquivo',
    async estado(e) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'estado.json'), JSON.stringify(e, null, 1), 'utf8');
    },
    async proximoNumero() {
      const idx = JSON.parse(await readFile(join(dir, 'documentos.json'), 'utf8').catch(() => '[]'));
      return idx.length ? Math.max(...idx.map((d) => d.numero)) + 1 : 1;
    },
    async documento(doc) {
      await mkdir(join(dir, 'documentos'), { recursive: true });
      await writeFile(join(dir, 'documentos', `${doc.id}.md`), doc.markdown, 'utf8');
      const idx = JSON.parse(await readFile(join(dir, 'documentos.json'), 'utf8').catch(() => '[]'));
      idx.push({ id: doc.id, numero: doc.numero, titulo: doc.titulo, tema: doc.tema, data: doc.data, alertas: doc.alertas });
      await writeFile(join(dir, 'documentos.json'), JSON.stringify(idx, null, 1), 'utf8');
    },
    async temasRecentes(n = 40) {
      const idx = JSON.parse(await readFile(join(dir, 'documentos.json'), 'utf8').catch(() => '[]'));
      return idx.slice(-n).map((d) => d.tema);
    },
  };
}
