// Aprire una sezione della pagina non deve costare sei secondi.
//
// `disegna()` rilegge /stato a ogni cambio di sezione. Se la lettura rifiutata
// fa la pausa e il rinnovo **dentro la richiesta della pagina**, passare da
// «Adesso» a «Comandi» aspetta tutta la catena. Il proprietario l'ha visto il
// 17/11: «spostarsi di sezione e' molto lento».
//
// Due regole, qui provate:
//  - la pausa e il rinnovo si fanno solo quando qualcuno ha chiesto una
//    lettura **fresca** — il giro periodico, o il tasto di aggiornamento. Una
//    semplice apertura di pagina prova una volta e ripiega;
//  - il ripiego si mette in cache come una lettura buona, cosi' le aperture
//    successive non toccano nemmeno la rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const RIFIUTO = JSON.stringify({ msgCode: 805, message: 'login scaduto (finto)' });
let chiamate = 0;

globalThis.fetch = async (url) => {
  if (String(url).includes('/oauth2/token')) {
    return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
  }
  chiamate++;
  return { ok: true, status: 200, text: async () => RIFIUTO, json: async () => JSON.parse(RIFIUTO) };
};

archivio([
  ['SELECT nome, valore, scade, aggiornato FROM gettoni_cloud', [
    { nome: 'bluetti_accesso', valore: 'ACCESSO', scade: null, aggiornato: new Date(Date.now() - 20 * 60000) },
    { nome: 'bluetti_rinnovo', valore: 'RINNOVO', scade: null, aggiornato: new Date(Date.now() - 20 * 60000) },
  ]],
  ["FROM istantanee WHERE fonte='bluetti'", [
    { apparecchio: 'SN1', dati: { nome: 'AC180', sn: 'SN1', carica: 72 },
      quando: new Date(Date.now() - 14 * 60000) },
  ]],
]);

const { statoBluetti } = await import('../src/lib/bluetti.js');

test('aprire una sezione non aspetta la pausa: una prova sola, poi ripiego', async () => {
  const via = Date.now();
  const s = await statoBluetti();                 // senza `fresco`: e' una pagina
  const durata = Date.now() - via;
  assert.equal(s.vecchia, true);
  assert.equal(s.apparecchi?.length, 1);
  assert.equal(chiamate, 1, 'una sola richiesta al cloud, nessun secondo tentativo');
  assert.ok(durata < 2000, `ci ha messo ${durata} ms: deve essere svelto`);
});

test('il ripiego si tiene in cache: la seconda apertura non tocca la rete', async () => {
  const prima = chiamate;
  const via = Date.now();
  const s = await statoBluetti();
  assert.equal(chiamate, prima, 'non deve richiedere niente');
  assert.equal(s.vecchia, true);
  assert.ok(Date.now() - via < 200);
});

test('il giro periodico invece insiste: chiede fresco, e fa il secondo tentativo', async () => {
  const prima = chiamate;
  await statoBluetti({ fresco: true });
  assert.ok(chiamate >= prima + 2, `richieste al cloud: ${chiamate - prima}, ne servono almeno 2`);
});
