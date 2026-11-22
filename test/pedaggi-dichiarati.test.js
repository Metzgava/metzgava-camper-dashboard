// L'autostrada dichiarata da chi ha guidato, e le regole che non hanno bisogno
// della rete.
//
// Disegno: docs/superpowers/specs/2026-11-22-pedaggi-dichiarati-design.md
//
// CarLock misura **quanto** si e' percorso, non **per dove**: fra le strade
// possibili il programma prende quella che misura piu' vicino ai chilometri
// veri. E' un indizio, non un'informazione. Chi c'era invece sa se ha pagato
// un casello, e quella e' l'altra meta' della stessa informazione: cambia il
// disegno **e** i chilometri a pedaggio, da cui esce la spesa stimata.
//
// Tre stati, non due. «Non lo so» deve restare distinguibile da «no»:
// altrimenti ogni tappa vecchia dichiarerebbe da sola una cosa che nessuno ha
// detto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pedaggiDaUsare, pedaggiDichiarati, pedaggiNonTornano } from '../src/lib/tappe.js';

test('una tappa in camper usa la dichiarazione che ha', () => {
  assert.equal(pedaggiDaUsare({ mezzo: 'camper', pedaggi_dichiarati: 'no' }), 'no');
  assert.equal(pedaggiDaUsare({ pedaggi_dichiarati: 'si' }), 'si');   // mezzo mancante = camper
  assert.equal(pedaggiDaUsare({ mezzo: 'camper' }), null);
  assert.equal(pedaggiDaUsare(null), null);
});

test('su una tappa che non e’ in camper la dichiarazione si IGNORA', () => {
  // Come i luoghi dichiarati: una rotta e un volo le statali non le seguono.
  // E resta **salvata**, per quando il mezzo torna quello di prima.
  assert.equal(pedaggiDaUsare({ mezzo: 'traghetto', pedaggi_dichiarati: 'no' }), null);
  assert.equal(pedaggiDaUsare({ mezzo: 'aereo', pedaggi_dichiarati: 'si' }), null);
});

test('quel che arriva dal corpo si normalizza, e cio’ che non si capisce resta vuoto', () => {
  // Il verso prudente: una stringa che non si riconosce **non** puo' diventare
  // «no», perche' «no» e' una dichiarazione e nessuno l'ha fatta.
  assert.equal(pedaggiDichiarati('si'), 'si');
  assert.equal(pedaggiDichiarati('SI'), 'si');
  assert.equal(pedaggiDichiarati(' no '), 'no');
  assert.equal(pedaggiDichiarati('forse'), null);
  assert.equal(pedaggiDichiarati(1), null);
  assert.equal(pedaggiDichiarati(''), null);
  assert.equal(pedaggiDichiarati(undefined), null);
});

test('dichiarato «no» e la strada fa pedaggi: lo si dice', () => {
  assert.equal(pedaggiNonTornano('no', 12), 'ne_fa_comunque');
  assert.equal(pedaggiNonTornano('no', 0), null);
});

test('dichiarato «si» e la strada non ne fa nemmeno uno: lo si dice', () => {
  assert.equal(pedaggiNonTornano('si', 0), 'non_ne_fa');
  assert.equal(pedaggiNonTornano('si', 54), null);
});

test('pedaggi sconosciuti non contraddicono niente', () => {
  // `—` vuol dire «non so»; `0` vuol dire «uno zero che conosco». Una strada
  // che non dice niente sui pedaggi non sta dicendo che non ce ne sono: e'
  // quel che torna quando risponde OSRM invece di OpenRouteService.
  assert.equal(pedaggiNonTornano('no', null), null);
  assert.equal(pedaggiNonTornano('si', undefined), null);
});

test('senza la chiave del servizio un «no» non si puo’ nemmeno chiedere', () => {
  assert.equal(pedaggiNonTornano('no', 0, { sannoEvitare: false }), 'non_chiedibile');
  assert.equal(pedaggiNonTornano('si', 54, { sannoEvitare: false }), null);
});

test('senza dichiarazione non c’e’ niente da contraddire', () => {
  assert.equal(pedaggiNonTornano(null, 54), null);
  assert.equal(pedaggiNonTornano(undefined, 0), null);
});
