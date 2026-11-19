// Un disegno che si muove su dati vecchi mente meglio di un numero fermo.
//
// Il 19/11/2026 il proprietario ha notato che le Ective erano «on line e reali
// anche con le animazioni», mentre la Bluetti era ferma a novanta minuti
// prima. Vero, e per una ragione buona: le Ective arrivano dalla scatoletta
// ogni due minuti, la Bluetti dal loro cloud in avaria.
//
// Ma i puntini dello schema scorrevano **comunque**, senza guardare l'eta' dei
// dati. Finche' la scatoletta parla va bene. Il giorno che tace -- fuori
// portata, spenta, senza rete -- quei puntini continuerebbero a scorrere su
// numeri di un'ora prima, e direbbero «sta entrando corrente adesso» con piu'
// forza di quanta ne abbia un numero immobile.
//
// E' la stessa trappola del quadrante, nel punto dove non era ancora chiusa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ramiDellaCarica } from '../src/lib/flusso.js';

const fonti = { valore: 210, sole_w: 6, motore_w: 0, rete_w: 204, base: 'misurato' };

test('con letture fresche i rami si muovono', () => {
  const f = ramiDellaCarica(fonti, { letture: true, minuti: 2 });
  assert.notEqual(f.ferma, true);
  assert.ok(f.rami.some(r => r.attivo));
});

test('con letture vecchie nessun ramo si anima', () => {
  const f = ramiDellaCarica(fonti, { letture: true, minuti: 60 });
  assert.equal(f.ferma, true, 'la figura deve dichiararsi ferma');
  assert.equal(f.rami.filter(r => r.attivo).length, 0,
    'un ramo attivo si anima, e animarsi su dati di un’ora fa e’ una bugia');
});

test('ma i numeri restano scritti', () => {
  // Non si cancellano: erano veri, solo di prima. E' l'eta' che va detta,
  // non il valore che va nascosto.
  const f = ramiDellaCarica(fonti, { letture: true, minuti: 60 });
  assert.equal(f.rami.find(r => r.id === 'rete').watt, 204);
});

test('senza sapere l’eta’ si continua come prima', () => {
  // Nessun dato sull'eta' non deve diventare «vecchio»: si resta come si era
  // prima di questa aggiunta, altrimenti una chiamata dimenticata spegne la
  // figura per sempre.
  assert.notEqual(ramiDellaCarica(fonti, { letture: true }).ferma, true);
});

test('il confine e’ la mezz’ora, come per i termometri', () => {
  assert.notEqual(ramiDellaCarica(fonti, { letture: true, minuti: 29 }).ferma, true);
  assert.equal(ramiDellaCarica(fonti, { letture: true, minuti: 31 }).ferma, true);
});
