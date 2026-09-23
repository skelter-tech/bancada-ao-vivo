// O aviso da parada. Quando existe PAUSADA na raiz, o turno não trabalha — e sem
// isto a tela pública ficaria congelada no último passo do turno anterior, como
// se a bancada tivesse travado no meio de uma frase.
//
// Roda no lugar do motor: lê o estado que está lá, troca só o modo e o aviso, e
// devolve. Manter o resto (o elenco, sobretudo) é o que faz a cena continuar de
// pé com os robôs no lugar, parados, em vez de a tela se desmontar.
//
// A PRIMEIRA LINHA do arquivo PAUSADA é o que aparece na tela. É de propósito:
// trocar o aviso é editar uma linha pelo github.com, sem tocar em código, como
// os botões do ritmo no workflow.
import { readFile } from 'node:fs/promises';
import { conectar } from '../src/firestore.mjs';

const PADRAO = 'A bancada parou para melhorias. Volta em breve.';

const conta = process.env.FIREBASE_CONTA;
if (!conta) { console.log('sem FIREBASE_CONTA: não dá para avisar na tela'); process.exit(0); }

const bruto = await readFile(new URL('../PAUSADA', import.meta.url), 'utf8').catch(() => '');
const aviso = bruto.split('\n').map((l) => l.trim()).find(Boolean) || PADRAO;

try {
  const db = conectar(conta);
  const antes = await db.le('aovivo/estado').catch(() => null);
  await db.grava('aovivo/estado', {
    ...(antes || {}),
    modo: 'melhorias',
    aviso,
    trilha: [],
    peca: null,
    publicou: null,
    atualizado: new Date().toISOString(),
    atual: { agente: 'Diretor', id: 'diretor', acao: 'em melhorias', texto: '', pensando: true, inicio: new Date().toISOString() },
  });
  console.log(`aviso publicado na tela: ${aviso}`);
} catch (e) {
  // o aviso é cortesia, não produção: falhar aqui não pode derrubar a pausa
  console.log(`não deu para avisar na tela: ${e.message}`);
}
