// I punti dichiarati vincolano ogni ridisegno, non solo quello che li ha
// scritti.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// La geometria di una tappa si riscrive in piu' posti: «Ridisegna», il
// salvataggio della tappa, «Porta nella tappa». Se i punti vincolassero solo
// la rotta che li ha salvati, il primo «Ridisegna» cancellerebbe in silenzio
// l'unica informazione che viene da chi c'era -- cioe' ricreerebbe dentro la
// cura la classe di difetto che la cura chiude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { puntiDaUsare } from '../src/lib/tappe.js';

const VIDOR = { nome: 'Vidor', lat: 45.8833, lon: 12.0167 };
const PIEVE = { nome: 'Pieve di Soligo', lat: 45.8972, lon: 12.2944 };
const PERSO = { nome: 'Posto Che Non Esiste 9x', lat: null, lon: null };

test('una tappa in camper coi punti dichiarati li usa, nell’ordine', () => {
  const p = puntiDaUsare({ mezzo: 'camper', via: [VIDOR, PIEVE] });
  assert.deepEqual(p.map(x => x.nome), ['Vidor', 'Pieve di Soligo']);
});

test('un punto senza coordinate non si usa, ma non spegne gli altri', () => {
  const p = puntiDaUsare({ mezzo: 'camper', via: [VIDOR, PERSO] });
  assert.equal(p.length, 1);
  assert.equal(p[0].nome, 'Vidor');
});

test('su una tappa che non e’ in camper i punti si IGNORANO', () => {
  // Un traghetto non segue le statali, e disegnare l'autostrada sotto un
  // aereo sarebbe un racconto falso: la riga resta fra i due punti.
  assert.deepEqual(puntiDaUsare({ mezzo: 'traghetto', via: [VIDOR] }), []);
  assert.deepEqual(puntiDaUsare({ mezzo: 'aereo', via: [VIDOR, PIEVE] }), []);
});

test('senza punti dichiarati non c’e’ niente da usare', () => {
  assert.deepEqual(puntiDaUsare({ mezzo: 'camper' }), []);
  assert.deepEqual(puntiDaUsare({ mezzo: 'camper', via: [] }), []);
  assert.deepEqual(puntiDaUsare(null), []);
});

test('una tappa senza mezzo e’ in camper, come dappertutto nel programma', () => {
  assert.equal(puntiDaUsare({ via: [VIDOR] }).length, 1);
});

// ---------------------------------------------------------------------------
// Anche la quarta strada che ridisegna
// ---------------------------------------------------------------------------
//
// Trovato in revisione: le rotte che ridisegnano erano **quattro**, non tre.
// La piu' battuta -- toccare una strada nel riquadro di modifica -- non
// passava dalla guardia, e quella strada il client la calcola fra i due soli
// capi. Risultato: la geometria tornava per Bassano mentre la riga continuava
// a dire «passando per Vidor, come hai detto tu».
test('il ramo della strada scelta passa dai punti quando ce ne sono', () => {
  const rotta = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');
  const i = rotta.indexOf('} else if (scelto)');
  assert.ok(i > 0, 'il ramo della strada scelta non si trova piu’');
  const ramo = rotta.slice(i, i + 1600);
  // Dal 22/11/2026 la guardia e' piu' larga: `laTappaHaDetto` comprende i
  // punti dichiarati **e** l'autostrada dichiarata. La revisione aveva trovato
  // che guardare i soli punti lasciava passare una tappa con «niente
  // autostrada» e nessun luogo, che si prendeva la strada scelta a mano --
  // calcolata fra i due soli capi, che della dichiarazione non sa niente.
  assert.match(ramo, /laTappaHaDetto\(cur\)/,
    'la strada scelta si applica senza guardare quel che la tappa ha dichiarato');
  assert.match(ramo, /stradaDellaTappa/,
    'il ramo non passa dalla strada che rispetta i punti');
});
