// Dal file dei tracciati di CarLock ai tragitti coi loro punti.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// CarLock manda, su richiesta, le posizioni registrate: 32.069 punti, 143
// tragitti, uno ogni quindici secondi. Finora la riga sulla mappa era una
// ricostruzione -- fra due strade possibili si prendeva quella che misurava
// piu' vicino ai chilometri veri -- e su Novaledo -> Udine passava per
// Bassano, a 15,6 km dalla strada percorsa davvero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leggiTracciati } from '../src/lib/tracciati.js';

const CAPO = 'trip,trip_start,trip_end,time,latitude,longitude,speed_kmh,heading_deg,altitude_m';
const riga = (trip, da, a, t, lat, lon) =>
  `${trip},${da},${a},${t},${lat},${lon},0,0,0`;

const CSV_DUE_PUNTI = [CAPO,
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:20:26', '45.850968', '12.252515'),
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:20:41', '45.851500', '12.253000'),
].join('\n');

const CSV_DUE_TRAGITTI = [CSV_DUE_PUNTI,
  riga(2, '2026-07-31 18:00:00', '2026-07-31 18:10:00', '2026-07-31 18:00:00', '46.0', '11.5'),
  riga(2, '2026-07-31 18:00:00', '2026-07-31 18:10:00', '2026-07-31 18:05:00', '46.1', '11.6'),
  riga(2, '2026-07-31 18:00:00', '2026-07-31 18:10:00', '2026-07-31 18:10:00', '46.2', '11.7'),
].join('\n');

const CSV_FUORI_ORDINE = [CAPO,
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:21:00', '45.86', '12.26'),
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:20:26', '45.85', '12.25'),
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:20:45', '45.855', '12.255'),
].join('\n');

const CSV_CON_RIGA_ROTTA = [CAPO,
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:20:26', '45.850968', '12.252515'),
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:20:41', '', 'ciao'),
  riga(1, '2026-07-31 17:20:26', '2026-07-31 17:27:46', '2026-07-31 17:20:56', '45.852000', '12.254000'),
].join('\n');

test('un tragitto diventa un elemento coi suoi punti', () => {
  const t = leggiTracciati(CSV_DUE_PUNTI);
  assert.equal(t.length, 1);
  assert.equal(t[0].punti.length, 2);
  assert.ok(Math.abs(t[0].punti[0].lat - 45.850968) < 1e-6);
  assert.ok(Math.abs(t[0].punti[0].lon - 12.252515) < 1e-6);
});

test('ogni tragitto porta il suo inizio e la sua fine', () => {
  // Sono la chiave per attaccarlo alla tappa giusta: le tappe importate da
  // CarLock hanno gia' data e orari.
  const t = leggiTracciati(CSV_DUE_PUNTI)[0];
  assert.equal(new Date(t.da).toISOString().slice(11, 16), new Date('2026-07-31T17:20:26').toISOString().slice(11, 16));
  assert.ok(t.a > t.da);
});

test('tragitti diversi non si mescolano', () => {
  const t = leggiTracciati(CSV_DUE_TRAGITTI);
  assert.deepEqual(t.map(x => x.punti.length), [2, 3]);
});

test('i punti restano in ordine di tempo anche se il file non lo e’', () => {
  // Una riga fuori ordine disegnerebbe un dente nella strada.
  const p = leggiTracciati(CSV_FUORI_ORDINE)[0].punti.map(x => x.t);
  assert.deepEqual(p, [...p].sort((a, b) => a - b));
});

test('una riga malformata si salta, il tragitto resta', () => {
  // Buttare settecento punti buoni per un refuso sarebbe perdere la strada.
  const t = leggiTracciati(CSV_CON_RIGA_ROTTA);
  assert.equal(t.length, 1);
  assert.equal(t[0].punti.length, 2);
});

test('un file vuoto o senza intestazione non fa cadere niente', () => {
  assert.deepEqual(leggiTracciati(''), []);
  assert.deepEqual(leggiTracciati('ciao'), []);
  assert.deepEqual(leggiTracciati(null), []);
});
