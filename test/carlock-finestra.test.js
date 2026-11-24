// Fin dove si è già guardato: la finestra da chiedere a CarLock.
//
// Disegno: docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md
//
// La prima versione del disegno faceva comparire il cartello «quando il
// viaggio ha almeno una tappa che non viene dal tracker», e sbagliava: le
// date di un viaggio si fissano **prima** di partire. Un viaggio futuro non ha
// nessuna tappa, e uno in corso ne acquista un giorno per volta. Serve una
// regola che funzioni mentre il viaggio accade.
//
// Il viaggio porta un segno -- `carlock_chiesto_fino_a` -- e la finestra va
// dal segno a **oggi**, mai oltre. Dopo una richiesta il segno avanza, anche
// se non si è trovato niente: così un giorno di sosta non ripropone lo stesso
// cartello per sempre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finestraDaChiedere, oltreLoStorico, mesiDiStorico } from '../src/lib/carlock-finestra.js';

const viaggio = (da, a, segno = null) => ({ start_date: da, end_date: a, carlock_chiesto_fino_a: segno });
const ora = s => Date.parse(s);
const ADESSO = ora('2026-11-24T12:00:00+01:00');
const q = (adesso = ADESSO, mesiStorico = 12) => ({ adesso, mesiStorico });

test('un viaggio tutto nel futuro non si chiede: non ci sono dati, e non si fa traffico', () => {
  assert.equal(finestraDaChiedere(viaggio('2027-07-04', '2027-07-15'), [], q()), null);
});

test('al terzo giorno di dieci si chiede fino a ADESSO, non fino alla fine del viaggio', () => {
  const f = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01'), [], q());
  assert.equal(f.da, ora('2026-11-22T00:00:00+01:00'));
  assert.equal(f.a, ADESSO, 'si e’ chiesto per giorni che non sono ancora passati');
});

test('col segno si riparte da dove si era arrivati, non da capo', () => {
  const f = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01', '2026-11-23T18:00:00+01:00'), [], q());
  assert.equal(f.da, ora('2026-11-23T18:00:00+01:00'));
});

test('appena guardato non si ripropone: la finestra e’ vuota', () => {
  assert.equal(finestraDaChiedere(viaggio('2026-11-22', '2026-12-01', '2026-11-24T12:00:00+01:00'),
    [], q()), null);
});

test('il giorno dopo c’e’ roba nuova, e la finestra torna', () => {
  const f = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01', '2026-11-24T12:00:00+01:00'),
    [], q(ora('2026-11-25T09:00:00+01:00')));
  assert.equal(f.da, ora('2026-11-24T12:00:00+01:00'));
  assert.equal(f.a, ora('2026-11-25T09:00:00+01:00'));
});

test('quando il segno e’ arrivato alla fine, non c’e’ piu’ niente da chiedere', () => {
  assert.equal(finestraDaChiedere(viaggio('2026-11-01', '2026-11-05', '2026-11-06T00:00:00+01:00'),
    [], q()), null);
});

test('un viaggio finito si chiede fino alla sua fine, non fino a oggi', () => {
  const f = finestraDaChiedere(viaggio('2026-11-01', '2026-11-05'), [], q());
  assert.equal(f.a, ora('2026-11-06T00:00:00+01:00') - 1,
    'si chiedono giorni che non sono di questo viaggio');
});

test('senza le date del viaggio valgono il primo e l’ultimo giorno delle tappe', () => {
  const f = finestraDaChiedere(viaggio(null, null), [{ date: '2026-11-02' }, { date: '2026-11-01' }], q());
  assert.equal(f.da, ora('2026-11-01T00:00:00+01:00'));
});

test('senza date e senza tappe datate non si chiede niente', () => {
  assert.equal(finestraDaChiedere(viaggio(null, null), [], q()), null);
  assert.equal(finestraDaChiedere(viaggio(null, null), [{ date: null }], q()), null);
});

test('un viaggio oltre lo storico non si chiede, e si sa dirlo', () => {
  const v = viaggio('2024-06-01', '2024-06-10');
  assert.equal(finestraDaChiedere(v, [], q()), null);
  assert.equal(oltreLoStorico(v, [], q()), true,
    'non comparire e’ diverso da dire «non c’e’ piu’»');
});

test('un viaggio in corso non e’ «oltre lo storico»', () => {
  assert.equal(oltreLoStorico(viaggio('2026-11-22', '2026-12-01'), [], q()), false);
  assert.equal(oltreLoStorico(viaggio('2027-07-04', '2027-07-15'), [], q()), false,
    'un viaggio futuro non e’ vecchio: e’ solo non ancora accaduto');
});

test('un viaggio a cavallo del limite si chiede per la parte che c’e’ ancora', () => {
  const f = finestraDaChiedere(viaggio('2025-10-01', '2026-01-15'), [], q());
  assert.equal(f.da, ora('2025-11-24T12:00:00+01:00'),
    'il limite dello storico deve comandare sull’inizio del viaggio');
  assert.equal(oltreLoStorico(viaggio('2025-10-01', '2026-01-15'), [], q()), false,
    'una parte si puo’ ancora chiedere: non e’ un viaggio perduto');
});

test('col piano piu’ piccolo la finestra si accorcia da se’', () => {
  // Tre mesi invece di dodici: lo stesso viaggio diventa inchiedibile.
  // Giugno 2026 sta dentro i dodici mesi da novembre 2026, e fuori dai tre.
  const v = viaggio('2026-06-01', '2026-06-10');
  assert.equal(finestraDaChiedere(v, [], q(ADESSO, 12)) === null, false);
  assert.equal(finestraDaChiedere(v, [], q(ADESSO, 3)), null);
  assert.equal(oltreLoStorico(v, [], q(ADESSO, 3)), true);
});

test('il piano dice quanto storico c’e’', () => {
  assert.equal(mesiDiStorico('STANDARD_PLUS'), 12);
  assert.equal(mesiDiStorico('STANDARD'), 3);
  assert.equal(mesiDiStorico(null), 3, 'nel dubbio il meno: si chiede meno, non si inventa');
  assert.equal(mesiDiStorico('QUALCOSA_DI_NUOVO'), 3,
    'un piano che non conosciamo non diventa dodici mesi per ottimismo');
});

test('un segno piu’ avanti di adesso non apre una finestra al rovescio', () => {
  // Non dovrebbe succedere -- il segno lo scrive il server -- ma un orologio
  // storto o un fuso sbagliato lo renderebbe possibile, e una finestra
  // rovesciata chiederebbe a CarLock un periodo che non esiste.
  assert.equal(finestraDaChiedere(viaggio('2026-11-22', '2026-12-01', '2026-11-30T00:00:00+01:00'),
    [], q()), null);
});

// ---------------------------------------------------------------------------
// La mezzanotte e' quella del veicolo, non quella del server
// ---------------------------------------------------------------------------
//
// Trovato facendo girare la suite con `TZ=UTC`, cioe' come gira su Railway.
// Il piano diceva di riusare `periodoDelViaggio` di `tracciati.js` per i capi
// del viaggio: quella costruisce la mezzanotte **locale**, che col file va
// bene perche' entrambi i lati del confronto sono storti uguale. Qui no: i
// capi vanno a CarLock come istanti assoluti, e su Railway la finestra
// sarebbe cominciata un'ora dopo la mezzanotte vera di Roma -- lasciando
// fuori un tragitto partito alle 00:30 del primo giorno, in silenzio.
test('i capi della finestra non si spostano col fuso del processo', () => {
  const f = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01'), [],
    { ...q(), fuso: 'Europe/Rome' });
  assert.equal(f.da, ora('2026-11-22T00:00:00+01:00'),
    'la finestra comincia alla mezzanotte del server invece che a quella del veicolo');
});

test('un veicolo in un altro fuso ha le sue mezzanotti', () => {
  // La prova che la funzione guarda davvero il fuso che le si da', invece di
  // ignorarlo: se lo ignorasse, questi due sarebbero identici.
  const roma = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01'), [], { ...q(), fuso: 'Europe/Rome' });
  const york = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01'), [], { ...q(), fuso: 'America/New_York' });
  assert.equal(york.da - roma.da, 6 * 60 * 60 * 1000,
    'New York e’ sei ore indietro a Roma in novembre');
});

test('la mezzanotte della notte del cambio d’ora e’ quella giusta', () => {
  // Il 25/10/2026 l'Italia torna all'ora solare: quella notte ha 25 ore, e la
  // mezzanotte e' ancora in ora legale (+02:00). Un calcolo a un passo solo
  // sull'offset la sbaglia di un'ora.
  const f = finestraDaChiedere(viaggio('2026-10-25', '2026-10-26'), [],
    { adesso: ora('2026-10-27T12:00:00+01:00'), mesiStorico: 12, fuso: 'Europe/Rome' });
  assert.equal(f.da, ora('2026-10-25T00:00:00+02:00'));
});
