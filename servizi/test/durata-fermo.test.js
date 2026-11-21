// Quanto dura il camper fermo: con quale consumo, e su quanta energia.
//
// Disegno: docs/superpowers/specs/2026-11-21-durata-consumo-vivo-design.md
//
// Due difetti nello stesso conto, e il secondo era nascosto dal primo.
//
// Il consumo era `consumo_fermo_w`, **11 W battuti in tabella** il 16/11/2026,
// col bollino «misurato». E il conto divideva i Wh della **sola Bluetti** per
// un consumo misurato sul 12 V delle Ective, come se la Bluetti servisse quel
// consumo senza perdite -- mentre per arrivare al 12 V quella corrente passa
// da inverter e caricatore e per strada se ne perde un quinto. Finche' il
// consumo era un 11 W piccolo l'incoerenza non si vedeva.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const { tuttiIConti } = await import('../src/lib/conti.js');
const { dimenticaIlRiposo } = await import('../src/lib/consumo.js');

const EC = ['NWJ1', 'NWJ2'];
const ective = (ampere = -6) => EC.map((b, i) => ({
  apparecchio: b, quando: new Date(),
  dati: { volt: 13.1, ampere, carica: 80, capacita_ah: 95,
          celle_mv: [3275, 3276, 3274, 3275], watt: 13.1 * ampere },
}));

const IMPIANTO = [
  { chiave: 'ective_ah', valore: 190, unita: 'Ah', nota: '', misurato: true },
  { chiave: 'ective_v', valore: 12.8, unita: 'V', nota: '', misurato: true },
  { chiave: 'bluetti_wh', valore: 2764, unita: 'Wh', nota: '', misurato: true },
  { chiave: 'rendimento_bluetti_ective', valore: 0.8, unita: '', nota: '', misurato: false },
  { chiave: 'consumo_fermo_w', valore: 11, unita: 'W',
    nota: 'Misurato il 16/11/2026: batterie -0,29 A piu’ pannelli +0,5 A.', misurato: true },
];

const BLUETTI = { apparecchi: [{ sn: 'EL300', nome: 'Elite 300', carica: 100 }] };

// Lo storico delle notti, nella forma che la query aggregata restituisce:
// una riga per intervallo, apparecchio e grandezza.
const notti = (quante, esce) => {
  const fuori = [];
  for (let g = 0; g < quante; g++) {
    const base = g * 1440;
    for (let m = base + 720; m > base + 480; m -= 5) {
      const quando = new Date(Date.now() - m * 60000);
      for (const b of EC) fuori.push({ quando, apparecchio: b, grandezza: 'watt', valore: -esce / EC.length });
      fuori.push({ quando, apparecchio: 'SmartSolar', grandezza: 'pannelli_w', valore: 0 });
    }
  }
  return fuori;
};

const conti = async (righe, { storico = [], impianto = IMPIANTO,
                              bluetti = BLUETTI } = {}) => {
  // Quel che si e' tenuto da parte va buttato: il consumo a riposo si ricorda
  // per un quarto d'ora, e senza questo la seconda prova vedrebbe il numero
  // della prima.
  dimenticaIlRiposo();
  archivio([
    ['FROM impianto', impianto],
    ['FROM istantanee', righe],
    ['FROM misure', storico],
  ]);
  return tuttiIConti(bluetti);
};

test('il consumo a riposo misurato VINCE su quello in tabella', async () => {
  const c = await conti(ective(), { storico: notti(4, 25) });
  assert.match(c.giorni_fermo_bluetti.perche, /25 W/,
    `perche = ${c.giorni_fermo_bluetti.perche}`);
  assert.doesNotMatch(c.giorni_fermo_bluetti.perche, /\b11 W\b/);
});

test('senza notti si ricade sulla tabella, e si dice che e’ di prima', async () => {
  const c = await conti(ective(), { storico: [] });
  assert.match(c.giorni_fermo_bluetti.perche, /11 W/);
  assert.match(c.giorni_fermo_bluetti.perche, /16\/11/);
});

test('«quanto dura fermo» conta Ective PIU’ Bluetti scontata del rendimento', async () => {
  // Scelta del proprietario, 21/11/2026, fra quattro possibilita'.
  // Ective: 2 x 95 Ah x 80 % x 13,1 V = 1991 Wh. Bluetti: 2764 x 100 % x 0,80
  // = 2211 Wh. In tutto 4202 Wh, a 25 W fanno 168 ore, cioe' 7 giorni.
  const c = await conti(ective(), { storico: notti(4, 25) });
  assert.ok(Math.abs(c.giorni_fermo_bluetti.valore - 7) < 0.5,
    `giorni = ${c.giorni_fermo_bluetti.valore}`);
  // E non e' la sola Bluetti: 2211/25/24 sarebbero 3,7 giorni.
  assert.ok(c.giorni_fermo_bluetti.valore > 5);
});

test('il bollino e’ STIMA, perche’ dentro c’e’ il rendimento stimato', async () => {
  // Un bollino «misurato» su un conto che contiene un numero di stima e' il
  // difetto che questo lavoro sta togliendo: ricrearlo altrove sarebbe
  // peggio che lasciarlo dov'era.
  const c = await conti(ective(), { storico: notti(4, 25) });
  assert.equal(c.giorni_fermo_bluetti.base, 'stima');
  assert.match(c.giorni_fermo_bluetti.perche, /rendimento/);
});

test('rendimento vuoto in tabella: non NaN, e si dice cosa manca', async () => {
  const senza = IMPIANTO.filter(r => r.chiave !== 'rendimento_bluetti_ective');
  const c = await conti(ective(), { storico: notti(4, 25), impianto: senza });
  assert.equal(Number.isNaN(c.giorni_fermo_bluetti.valore), false);
  assert.ok(c.giorni_fermo_bluetti.mancano.includes('rendimento_bluetti_ective'),
    `mancano = ${JSON.stringify(c.giorni_fermo_bluetti.mancano)}`);
  // I Wh delle Ective si sanno, quindi un numero si da' comunque: 1991 a 25 W
  // sono 3,3 giorni.
  assert.ok(c.giorni_fermo_bluetti.valore > 0);
});

test('senza i Wh della Bluetti si usano quelli delle Ective, e si dice', async () => {
  // E' lo stato in cui il camper si e' trovato il 21/11/2026 per mezz'ora: il
  // cloud Bluetti rifiutava.
  const c = await conti(ective(), { storico: notti(4, 25), bluetti: null });
  assert.ok(c.giorni_fermo_bluetti.valore > 0);
  assert.ok(c.giorni_fermo_bluetti.mancano.length > 0,
    'non dice che manca la Bluetti');
});

test('senza nessuna delle due energie non si da’ un numero', async () => {
  const soloConsumo = IMPIANTO.filter(r => r.chiave === 'consumo_fermo_w');
  const c = await conti([], { storico: [], impianto: soloConsumo, bluetti: null });
  assert.equal(c.giorni_fermo_bluetti.valore, null);
  assert.ok(c.giorni_fermo_bluetti.mancano.length > 0);
});
