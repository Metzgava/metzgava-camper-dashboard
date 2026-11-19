// Le due rotte del vivo: una segna che qualcuno guarda, l'altra dice alla
// scatoletta che passo tenere.
//
// La seconda sta **dentro il router dell'ingresso**, quindi dietro la chiave
// della scatoletta. Non e' un dettaglio: senza, chiunque passi potrebbe far
// accelerare la radio del camper e consumarne la batteria servizi da lontano,
// senza nemmeno dover entrare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

process.env.INGEST_TOKEN = 'chiave-di-prova';
const { router } = await import('../src/routes/ingresso.js');
const { segnaOcchiata, SVELTO_S } = await import('../src/lib/occhiata.js');

function manoDi(percorso, metodo = 'get') {
  for (const strato of router.stack) {
    if (strato.route?.path === percorso && strato.route.methods[metodo]) {
      return strato.route.stack[strato.route.stack.length - 1].handle;
    }
  }
  throw new Error(`non trovo ${metodo.toUpperCase()} ${percorso}`);
}

async function chiedi(conChiave = true) {
  archivio([]);
  const gestore = manoDi('/ritmo');
  const req = { get: () => (conChiave ? 'Bearer chiave-di-prova' : '') };
  let corpo = null, stato = 200;
  const res = { json: d => { corpo = d; }, status(s) { stato = s; return this; } };
  await gestore(req, res, e => { throw e; });
  return { corpo, stato };
}

test('se qualcuno guarda, la scatoletta riceve il passo svelto', async () => {
  segnaOcchiata(Date.now());
  const { corpo } = await chiedi();
  assert.equal(corpo.secondi, SVELTO_S);
});

test('se nessuno guarda da un pezzo, nessun passo imposto', async () => {
  segnaOcchiata(Date.now() - 10 * 60 * 1000);
  const { corpo } = await chiedi();
  assert.equal(corpo.secondi, null, 'null vuol dire: tieni il tuo passo');
});

test('la risposta e’ minuscola: la scatoletta la chiede ogni quindici secondi', async () => {
  // Una risposta grassa, moltiplicata per quattro al minuto per sempre, e'
  // traffico che il 4G del camper paga senza motivo.
  segnaOcchiata(Date.now());
  const { corpo } = await chiedi();
  assert.ok(JSON.stringify(corpo).length < 60, JSON.stringify(corpo));
});
