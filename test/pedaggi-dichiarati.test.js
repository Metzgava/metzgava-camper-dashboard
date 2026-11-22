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

// ---------------------------------------------------------------------------
// Le due condizioni che la revisione ha trovato storte
// ---------------------------------------------------------------------------
//
// Trovate il 22/11/2026 dalla revisione dell'intero ramo. Tutte e due stavano
// dentro `src/routes/trips.js`, dentro la finestra che le prove leggevano, e
// tutte e due sono passate sotto centocinquantasette prove verdi: una prova
// che cerca delle parole non vede una **condizione** sbagliata. Qui le
// condizioni diventano funzioni pure, e si provano per quello che fanno.
import { laTappaHaDetto, daRidisegnare } from '../src/lib/tappe.js';

test('una tappa che ha dichiarato l’autostrada ha detto qualcosa, anche senza luoghi', () => {
  // Il difetto: la guardia del salvataggio guardava **solo i luoghi**. Una
  // tappa con «niente autostrada» e nessun luogo finiva nel ramo che applica
  // la strada scelta a mano nel riquadro -- calcolata fra i due soli capi, che
  // della dichiarazione non sa niente. Due tocchi e l'autostrada tornava
  // disegnata sopra un «no», senza che niente lo dicesse.
  assert.equal(laTappaHaDetto({ mezzo: 'camper', pedaggi_dichiarati: 'no' }), true);
  assert.equal(laTappaHaDetto({ mezzo: 'camper', via: [{ nome: 'Vidor', lat: 45.8, lon: 12 }] }), true);
  assert.equal(laTappaHaDetto({ mezzo: 'camper' }), false);
  assert.equal(laTappaHaDetto(null), false);
});

test('fuori dal camper non ha detto niente che riguardi la strada', () => {
  assert.equal(laTappaHaDetto({ mezzo: 'traghetto', pedaggi_dichiarati: 'no' }), false);
});

test('un nome sbagliato non butta via la riga costruita a mano', () => {
  // Il difetto reintrodotto: il riquadro manda **sempre** il campo
  // dell'autostrada, quindi «ha ridichiarato» era sempre vero e bastava un
  // «Vidorr» battuto male per rifare da zero una riga passata per Vidor e
  // Pieve di Soligo. Quel che conta non e' che il campo sia arrivato: e' che
  // la risposta sia **cambiata**.
  assert.equal(daRidisegnare({ buoni: 0, puliti: 1, prima: 'no', adesso: 'no' }), false);
  assert.equal(daRidisegnare({ buoni: 0, puliti: 1, prima: null, adesso: null }), false);
});

test('se la risposta sull’autostrada cambia, la riga si rifa’ comunque', () => {
  assert.equal(daRidisegnare({ buoni: 0, puliti: 1, prima: null, adesso: 'no' }), true);
  assert.equal(daRidisegnare({ buoni: 0, puliti: 1, prima: 'no', adesso: null }), true);
});

test('con dei luoghi trovati, o col campo svuotato, si rifa’ come prima', () => {
  assert.equal(daRidisegnare({ buoni: 2, puliti: 2, prima: null, adesso: null }), true);
  assert.equal(daRidisegnare({ buoni: 0, puliti: 0, prima: null, adesso: null }), true);
});
