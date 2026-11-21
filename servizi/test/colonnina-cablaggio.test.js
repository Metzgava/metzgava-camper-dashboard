// Il cablaggio della colonnina: dal valore scelto ai tempi in pagina.
//
// Disegno: docs/superpowers/specs/2026-11-21-colonnina-ampere-design.md
//
// La funzione pura e' provata in `colonnina.test.js`. Qui si prova quel che
// sta fra lei e la pagina, ed e' dove si sbaglia davvero: un conto che resta
// quello di prima perche' nessuno l'ha ricablato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const { tuttiIConti } = await import('../src/lib/conti.js');
const { dimenticaIlRiposo } = await import('../src/lib/consumo.js');

const EC = ['NWJ1', 'NWJ2'];
const ective = () => EC.map(b => ({
  apparecchio: b, quando: new Date(),
  dati: { volt: 13.1, ampere: -6, carica: 50, capacita_ah: 95,
          celle_mv: [3275, 3276, 3274, 3275], watt: 13.1 * -6 },
}));

const BASE = [
  { chiave: 'bluetti_wh', valore: 2764, unita: 'Wh', nota: '', misurato: true },
  { chiave: 'bluetti_carica_ac_w', valore: 1800, unita: 'W', nota: '', misurato: false },
  { chiave: 'ective_v', valore: 12.8, unita: 'V', nota: '', misurato: true },
];
const con = (...righe) => [...BASE, ...righe];
const amp = a => ({ chiave: 'colonnina_a', valore: a, unita: 'A', nota: '', misurato: true });
const caricaEctive = a => ({ chiave: 'ective_carica_a', valore: a, unita: 'A', nota: '', misurato: true });

const BLUETTI = { apparecchi: [{ sn: 'EL300', nome: 'Elite 300', carica: 50 }] };

const conti = async (impianto, righe = ective()) => {
  dimenticaIlRiposo();
  archivio([
    ['FROM impianto', impianto],
    ['FROM istantanee', righe],
    ['FROM misure', []],
  ]);
  return tuttiIConti(BLUETTI);
};

test('con una presa da 4 A il tempo si allunga, e si dice che e’ la presa a frenare', async () => {
  // 1382 Wh da rimettere nella Bluetti. A 1800 W sarebbero 46 minuti; dalla
  // presa da 4 A -- 920 W -- sono un'ora e mezza. Il conto di prima usava
  // sempre 1800: prometteva una ricarica doppia di quella vera.
  const c = await conti(con(amp(4)));
  assert.ok(c.ore_colonnina.valore > 1.3, `ore = ${c.ore_colonnina.valore}`);
  assert.match(c.ore_colonnina.perche, /920 W/);
  assert.match(c.ore_colonnina.perche, /presa/);
  // Il numero senza quella frase fa cambiare apparecchio a chi doveva
  // cambiare piazzola.
  assert.equal(c.ore_colonnina.chi, 'presa');
});

test('con una presa da 16 A a frenare resta la Bluetti', async () => {
  const c = await conti(con(amp(16)));
  assert.match(c.ore_colonnina.perche, /1800 W/);
  assert.equal(c.ore_colonnina.chi, 'apparecchio');
});

test('senza ampere dichiarati il conto resta quello di oggi', async () => {
  // Vincolo del disegno: un valore assente non deve peggiorare quel che gia'
  // funziona, e non deve far comparire una frase che non serve.
  const c = await conti(con());
  assert.match(c.ore_colonnina.perche, /1800 W/);
  assert.equal(c.ore_colonnina.chi, 'apparecchio');
});

test('il tempo delle Ective dalla colonnina: senza il caricabatterie si dice cosa manca', async () => {
  // `ective_carica_a` e' vuoto dal primo giorno. Si scrive cosa manca, non si
  // inventa un caricabatterie.
  const c = await conti(con(amp(6)));
  assert.equal(c.ore_colonnina_ective.valore, null);
  assert.ok(c.ore_colonnina_ective.mancano.includes('ective_carica_a'),
    `mancano = ${JSON.stringify(c.ore_colonnina_ective.mancano)}`);
});

test('col caricabatterie dichiarato, il tempo delle Ective c’e’ e la presa lo limita', async () => {
  // 30 A a 12,8 V sono 384 W di carica. Le Ective al 50 % di 2 x 95 Ah a
  // 13,1 V: mancano circa 1244 Wh, cioe' poco piu' di tre ore.
  const largo = await conti(con(amp(16), caricaEctive(30)));
  assert.ok(largo.ore_colonnina_ective.valore > 2, `ore = ${largo.ore_colonnina_ective.valore}`);
  assert.equal(largo.ore_colonnina_ective.chi, 'apparecchio');

  // Su una presa da 1 A -- 230 W -- a frenare e' la presa, e il tempo si
  // allunga.
  const stretto = await conti(con(amp(1), caricaEctive(30)));
  assert.ok(stretto.ore_colonnina_ective.valore > largo.ore_colonnina_ective.valore,
    'la presa piu’ piccola deve allungare il tempo');
  assert.equal(stretto.ore_colonnina_ective.chi, 'presa');
});

test('il tempo delle Ective non si da’ senza letture delle batterie', async () => {
  const c = await conti(con(amp(6), caricaEctive(30)), []);
  assert.equal(c.ore_colonnina_ective.valore, null);
  assert.ok(c.ore_colonnina_ective.mancano.length > 0);
});

test('a batterie piene non c’e’ niente da rimettere, e non e’ un dato che manca', async () => {
  const piene = EC.map(b => ({
    apparecchio: b, quando: new Date(),
    dati: { volt: 13.4, ampere: -1, carica: 100, capacita_ah: 95,
            celle_mv: [3350, 3350, 3350, 3350], watt: -13.4 },
  }));
  const c = await conti(con(amp(6), caricaEctive(30)), piene);
  assert.equal(c.ore_colonnina_ective.valore, null);
  assert.deepEqual(c.ore_colonnina_ective.mancano, []);
  assert.match(c.ore_colonnina_ective.perche, /piene|niente da rimettere/);
});

test('le spiegazioni non contengono markup: vanno in HTML', async () => {
  // Scritto dopo averlo sbagliato: avevo messo `**presa da 1 A**` in un
  // `perche`, che la pagina inserisce come testo -- in pagina si sarebbero
  // letti gli asterischi. Nessun altro `perche` del progetto usa markup, e
  // l'enfasi vive nel campo `chi`, che la pagina mostra come avviso in ambra.
  const c = await conti(con(amp(4), caricaEctive(30)));
  for (const nome of ['ore_colonnina', 'ore_colonnina_ective']) {
    assert.doesNotMatch(c[nome].perche || '', /\*\*/, `${nome} ha degli asterischi`);
  }
});
