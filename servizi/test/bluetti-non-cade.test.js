// Un guasto del cloud di Bluetti non deve portare giu' la pagina.
//
// Il 19/11/2026, alle 14:41:59, il loro gateway e' andato in timeout:
//
//   ConnectTimeoutError: gw.bluettipower.com:443, timeout 10000ms
//   GET /api/stato -> 500  (16 secondi)
//   GET /api/stato -> 500
//
// Non e' caduta la sezione Bluetti: e' caduta **tutta la pagina**. Le Ective,
// i termometri, le Victron, la scatoletta -- tutto quello che con Bluetti non
// c'entra niente -- spariti per sedici secondi, perche' un fornitore esterno
// non rispondeva.
//
// Il ripiego c'era gia' e funzionava bene per i **rifiuti**: si mostra
// l'ultima lettura buona con la sua eta'. Ma un rifiuto torna una risposta,
// mentre un timeout **lancia**, e quel lancio risaliva fino alla rotta.
//
// La differenza fra i due casi e' tutta tecnica e non interessa a nessuno:
// per chi guarda la pagina sono la stessa cosa -- la Bluetti non si legge --
// e vanno trattati allo stesso modo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const { statoBluetti } = await import('../src/lib/bluetti.js');

const esplode = async () => { throw new Error('Connect Timeout Error'); };

test('se la lettura esplode, lo stato non esplode', async () => {
  archivio([['FROM istantanee', [{
    apparecchio: 'SN1', dati: { carica: 62 },
    quando: new Date(Date.now() - 4 * 60000),
  }]]]);
  const s = await statoBluetti({ fresco: true }, esplode);
  assert.equal(s.vecchia, true, 'deve ripiegare sull’ultima lettura buona');
  assert.equal(s.apparecchi[0].carica, 62);
});

test('e dice da quanto, come per un rifiuto', async () => {
  archivio([['FROM istantanee', [{
    apparecchio: 'SN1', dati: { carica: 62 },
    quando: new Date(Date.now() - 4 * 60000),
  }]]]);
  const s = await statoBluetti({ fresco: true }, esplode);
  assert.equal(s.minuti, 4);
  assert.ok(s.avviso && s.avviso.length > 0, 'il motivo va detto');
});

test('senza nessuna lettura in archivio non esplode lo stesso', async () => {
  // Il caso peggiore: il cloud non risponde e non c'e' niente da mostrare.
  // Deve uscirne un oggetto che la pagina sa disegnare, non un'eccezione.
  archivio([['FROM istantanee', []]]);
  const s = await statoBluetti({ fresco: true }, esplode);
  assert.ok(s && typeof s === 'object');
  assert.ok(s.errore, 'va detto che non si sa niente');
});
