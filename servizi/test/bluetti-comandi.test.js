// Un comando che non passa deve dirlo in italiano.
//
// Il 17/11 il proprietario ha premuto «uscita 220» con un permesso rifiutato e
// si e' visto rispondere in cinese: era la frase del loro cloud,
// «登录已过期，请重新登录！» (accesso scaduto, entra di nuovo), passata di peso
// dalla risposta alla pagina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const CINESE = '登录已过期，请重新登录！';

archivio([['SELECT nome, valore, scade, aggiornato FROM gettoni_cloud', [
  { nome: 'bluetti_accesso', valore: 'ACCESSO', scade: null, aggiornato: new Date() },
]]]);

const { comanda } = await import('../src/lib/bluetti.js');

test('un comando rifiutato (805) parla italiano e dice cosa fare', async () => {
  const c = JSON.stringify({ msgCode: 805, message: CINESE });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => c, json: async () => JSON.parse(c) });

  const esito = await comanda('SN1', 'SetCtrlAc', 1);
  const detto = `${esito.errore || ''} ${esito.messaggio || ''}`;
  assert.equal(esito.ok, false);
  assert.ok(!detto.includes(CINESE), `non deve riportare il cinese: ${detto}`);
  assert.match(detto, /ricollega/i, `deve dire cosa fare: ${detto}`);
});

test('un comando riuscito resta riuscito anche se msgCode arriva come stringa', async () => {
  // Lo stesso inciampo che aveva nascosto il guasto del 16/11: il loro cloud
  // puo' mandare msgCode come stringa, e `=== 0` su una stringa e' falso.
  const c = JSON.stringify({ msgCode: '0', message: 'ok' });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => c, json: async () => JSON.parse(c) });
  assert.equal((await comanda('SN1', 'SetCtrlAc', 1)).ok, true);
});
