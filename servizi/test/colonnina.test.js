// Il limite della presa, e chi dei due frena.
//
// Disegno: docs/superpowers/specs/2026-11-21-colonnina-ampere-design.md
//
// Il proprietario, in viaggio: «cambia gli ampere da colonnina da 1 a 16 o
// oltre... era per il calcolo dei tempi di ricarica stimati sia di bluetti che
// di ective da colonnina, ora non si riesce a mettere 2 o 4 o 6».
//
// Non era un campo che rifiutava: era un campo che non c'era. L'unico dato
// della 220 nell'Impianto e' `bluetti_carica_ac_w`, in **watt**, a 1800 --
// scriverci 4 vuol dire quattro watt.
//
// E 1800 W e' quel che la Bluetti sa prendere, non quel che la colonnina sa
// dare. In campeggio il limite e' quasi sempre la colonnina: su una presa da
// 4 A il conto di prima promette una ricarica **doppia** di quella vera, e
// sbaglia nella direzione ottimista -- la sola che fa restare fermi contando
// su ore che non ci sono.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limiteDellaPresa, RETE_V, TAGLIE_A } from '../src/lib/colonnina.js';

test('la presa piu’ piccola dell’apparecchio e’ lei a frenare', () => {
  // 4 A sono 920 W: la Bluetti ne prenderebbe 1800.
  const l = limiteDellaPresa(1800, 4);
  assert.equal(l.watt, 4 * RETE_V);
  assert.equal(l.chi, 'presa');
});

test('la presa piu’ grande dell’apparecchio non cambia niente', () => {
  // 16 A sono 3680 W: a frenare resta la Bluetti.
  const l = limiteDellaPresa(1800, 16);
  assert.equal(l.watt, 1800);
  assert.equal(l.chi, 'apparecchio');
});

test('senza ampere dichiarati il conto resta quello di oggi', () => {
  // Vincolo del disegno: un valore assente non deve peggiorare quel che gia'
  // funziona.
  const l = limiteDellaPresa(1800, null);
  assert.equal(l.watt, 1800);
  assert.equal(l.chi, 'apparecchio');
  assert.equal(l.presa_w, null);
});

test('senza sapere quanto prende l’apparecchio non si da’ un limite', () => {
  const l = limiteDellaPresa(null, 6);
  assert.equal(l.watt, null);
  assert.equal(l.chi, null);
  // Ma quel che da' la presa si sa, ed e' comunque un'informazione.
  assert.equal(l.presa_w, 6 * RETE_V);
});

test('a pari merito non e’ la presa a frenare', () => {
  // Dire «e’ la presa» quando non lo e' manderebbe a cambiare piazzola chi
  // non ne ha bisogno.
  const l = limiteDellaPresa(8 * RETE_V, 8);
  assert.equal(l.chi, 'apparecchio');
});

test('i watt si ricavano dagli ampere con la tensione di rete, non a mano', () => {
  // 230 V e' una costante del codice e non un dato da compilare: e' la
  // tensione di rete europea, e chiederla sarebbe una domanda in piu' per un
  // numero che non cambia mai.
  assert.equal(RETE_V, 230);
  assert.equal(limiteDellaPresa(99999, 6).watt, 1380);
});

test('le taglie da scegliere coprono da 1 a 16 piu’ le grosse', () => {
  // Le parole del proprietario: «devono essere selezionabili da 1 a 16
  // almeno». Le prese esistono in taglie, non in numeri qualunque: un ampere
  // e mezzo non esiste, e su un iPad scegliere si sbaglia meno che battere.
  for (let a = 1; a <= 16; a++) {
    assert.ok(TAGLIE_A.includes(a), `manca la taglia da ${a} A`);
  }
  for (const grossa of [20, 25, 32]) {
    assert.ok(TAGLIE_A.includes(grossa), `manca la taglia da ${grossa} A`);
  }
  // In ordine, e senza doppioni: e' un elenco da cui si scegle.
  assert.deepEqual(TAGLIE_A, [...new Set(TAGLIE_A)].sort((a, b) => a - b));
});
