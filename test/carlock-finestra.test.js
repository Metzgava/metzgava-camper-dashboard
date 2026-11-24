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
import { finestraDaChiedere, oltreLoStorico, mesiDiStorico, valeIlCartello } from '../src/lib/carlock-finestra.js';

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

// Queste quattro provavano il **vecchio** significato del segno: tagliava la
// domanda. La revisione finale ha trovato cosa costava -- un tragitto
// pubblicato da CarLock dopo il tocco non si offriva piu', mai, e in silenzio
// -- e adesso il segno decide solo se mostrare il cartello. Riscritte dove
// quel comportamento vive ora.
test('appena guardato il cartello non si ripropone', () => {
  assert.equal(valeIlCartello(viaggio('2026-11-22', '2026-12-01', '2026-11-24T08:00:00+01:00'),
    [], q()), false);
});

test('il giorno dopo c’e’ roba nuova, e il cartello torna', () => {
  assert.equal(valeIlCartello(viaggio('2026-11-22', '2026-12-01', '2026-11-24T08:00:00+01:00'),
    [], q(ora('2026-11-25T09:00:00+01:00'))), true);
});

test('guardato fino alla fine del viaggio, il cartello smette', () => {
  assert.equal(valeIlCartello(viaggio('2026-11-01', '2026-11-05', '2026-11-06T00:00:00+01:00'),
    [], q()), false);
});

test('ma il tasto, se lo tocca lui, risponde comunque', () => {
  // Il segno non e' un divieto: e' un «non ti disturbo».
  assert.notEqual(finestraDaChiedere(viaggio('2026-11-01', '2026-11-05', '2026-11-06T00:00:00+01:00'),
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

test('un segno piu’ avanti di adesso non fa comparire il cartello', () => {
  // Non dovrebbe succedere -- il segno lo scrive il server -- ma un orologio
  // storto lo renderebbe possibile. La finestra adesso non la tocca (il segno
  // non taglia la domanda), quindi il posto dove puo' fare danno e' il
  // cartello: con un segno nel futuro deve tacere, non lampeggiare.
  assert.equal(valeIlCartello(viaggio('2026-11-22', '2026-12-01', '2026-11-30T00:00:00+01:00'),
    [], q()), false);
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

test('rubinetto spento vuol dire zero mesi: non «non lo so», ma «non posso chiedere»', () => {
  // Su Railway le credenziali vanno nelle variabili del servizio, e finche'
  // non ci sono il rubinetto e' spento. Tornare 3 come per un piano
  // sconosciuto farebbe comparire il cartello, e il tocco risponderebbe «non
  // configurato»: un invito che non porta da nessuna parte e' peggio di
  // nessun invito. Zero e' la verita': niente da chiedere.
  assert.equal(mesiDiStorico('STANDARD_PLUS', { configurato: false }), 0);
  assert.equal(mesiDiStorico(null, { configurato: false }), 0);
  assert.equal(mesiDiStorico('STANDARD_PLUS', { configurato: true }), 12);
  assert.equal(mesiDiStorico('STANDARD_PLUS'), 12, 'di suo si assume acceso, come prima');
});

test('con zero mesi non si chiede niente e non e’ «troppo vecchio»', () => {
  const v = viaggio('2026-11-22', '2026-12-01');
  assert.equal(finestraDaChiedere(v, [], q(ADESSO, 0)), null);
  assert.equal(oltreLoStorico(v, [], q(ADESSO, 0)), false,
    'un rubinetto spento non e’ un viaggio vecchio: sono due ragioni diverse');
});

// ---------------------------------------------------------------------------
// Il segno decide se disturbare, non cosa chiedere
// ---------------------------------------------------------------------------
//
// La revisione finale ha trovato due difetti, e sono la stessa domanda: cosa
// vuol dire il segno.
//
//   - **un giorno di sosta riproponeva il cartello per sempre.** Il segno lo
//     scriveva solo la rotta che crea le tappe, e quella si rifiuta se non
//     hai scelto niente: guardavi, non c'era nulla, e domani il cartello era
//     di nuovo li'. Lo stesso per un viaggio finito e importato dal file, che
//     non passa mai da quella rotta;
//   - **un tragitto caricato in ritardo da CarLock era perduto.** Tocco alle
//     12:00, CarLock pubblica alle 12:05 il tragitto delle 11:20: la finestra
//     dopo parte dalle 12:00, e quel tragitto non si offre piu'. Mai. Nel
//     verso rassicurante, perche' nessuno lo dice.
//
// La cura e' smettere di usare il segno per **tagliare la domanda**: si chiede
// tutto il periodo del viaggio (cinque kB) e i doppioni li impedisce il
// vincolo sull'identificativo, che e' il suo lavoro. Il segno serve solo a
// decidere **se mostrare il cartello**.
test('la finestra da chiedere e’ tutto il periodo del viaggio, fino a oggi', () => {
  const senza = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01'), [], q());
  const con = finestraDaChiedere(viaggio('2026-11-22', '2026-12-01', '2026-11-23T18:00:00+01:00'), [], q());
  assert.deepEqual(con, senza,
    'il segno taglia la domanda: un tragitto caricato in ritardo non si offre piu’');
  assert.equal(senza.da, ora('2026-11-22T00:00:00+01:00'));
});

test('col segno alla fine si chiede ancora, ma il cartello tace', () => {
  // Due domande diverse: «c'e' qualcosa da chiedere» e «vale la pena
  // disturbarlo». Se tocca lui, gli si risponde.
  const v = viaggio('2026-11-01', '2026-11-05', '2026-11-06T00:00:00+01:00');
  assert.notEqual(finestraDaChiedere(v, [], q()), null,
    'toccando il tasto non si potrebbe piu’ chiedere niente');
  assert.equal(valeIlCartello(v, [], q()), false, 'il cartello si ripropone dopo aver guardato');
});

test('senza segno il cartello vale, col segno di oggi no, domani si’', () => {
  const v = viaggio('2026-11-22', '2026-12-01');
  assert.equal(valeIlCartello(v, [], q()), true);
  assert.equal(valeIlCartello({ ...v, carlock_chiesto_fino_a: '2026-11-24T08:00:00+01:00' }, [], q()), false,
    'guardato stamattina: non si ripropone nel pomeriggio');
  assert.equal(valeIlCartello({ ...v, carlock_chiesto_fino_a: '2026-11-24T08:00:00+01:00' }, [],
    q(ora('2026-11-25T09:00:00+01:00'))), true, 'il giorno dopo c’e’ roba nuova');
});

test('un viaggio oltre lo storico: niente cartello, ma si sa dirlo', () => {
  const v = viaggio('2024-06-01', '2024-06-10');
  assert.equal(valeIlCartello(v, [], q()), false);
  assert.equal(oltreLoStorico(v, [], q()), true);
});
