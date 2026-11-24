// I giorni del viaggio: quali tragitti si guardano e quali si lasciano stare.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// Era una riga dentro la rotta, e la revisione del 24/11/2026 ha trovato due
// cose:
//
//   - **non si poteva provare.** La prova guardava il testo della rotta e
//     cercava «start_date»: cancellando la riga che filtra, passava lo
//     stesso. Il vincolo piu' importante del disegno -- un tragitto di agosto
//     non finisce su una tappa di novembre -- non aveva una prova capace di
//     fallire.
//   - **tagliava la mezzanotte.** Il periodo finiva alle 23:59:59 dell'ultimo
//     giorno, ma la finestra di una tappa notturna arriva nel giorno dopo: il
//     tragitto delle 00:10 veniva buttato come «fuori periodo» mentre la sua
//     tappa lo aspettava, e la tappa si prendeva mezza traccia chiamandola
//     intera.
//
// Adesso sono due funzioni pure, provate sui valori.
import test from 'node:test';
import assert from 'node:assert/strict';
import { periodoDelViaggio, dentroIlPeriodo, MARGINE_MS } from '../src/lib/tracciati.js';

const alle = s => new Date(s).getTime();

test('il periodo sono le date del viaggio, da mezzanotte a mezzanotte', () => {
  const p = periodoDelViaggio({ start_date: '2026-11-20', end_date: '2026-11-22' }, []);
  assert.equal(p.da, alle('2026-11-20T00:00:00'));
  assert.equal(p.a, alle('2026-11-23T00:00:00') - 1);
});

test('senza le date del viaggio valgono il primo e l’ultimo giorno delle tappe', () => {
  const p = periodoDelViaggio({ start_date: null, end_date: null },
    [{ date: '2026-07-05' }, { date: '2026-07-02' }, { date: null }]);
  assert.equal(p.da, alle('2026-07-02T00:00:00'));
  assert.equal(p.a, alle('2026-07-06T00:00:00') - 1);
});

test('un viaggio senza date e senza tappe datate non ha un periodo', () => {
  assert.equal(periodoDelViaggio({}, []), null);
  assert.equal(periodoDelViaggio({}, [{ date: null }]), null);
});

// Qui sta il vincolo del disegno, con la prova che lo vede cadere.
test('un tragitto di agosto non entra nel periodo di un viaggio di novembre', () => {
  const p = periodoDelViaggio({ start_date: '2026-11-20', end_date: '2026-11-22' }, []);
  assert.equal(dentroIlPeriodo({ da: alle('2026-08-14T10:00:00') }, p), false);
  assert.equal(dentroIlPeriodo({ da: alle('2026-11-21T10:00:00') }, p), true);
});

test('il tragitto appena dopo la mezzanotte dell’ultimo giorno resta in gioco', () => {
  // La tappa del 22 che parte alle 23:40 e arriva alle 00:20 ha la finestra
  // dentro il 23. Buttare il tragitto delle 00:10 le avrebbe dato mezza
  // traccia, contata come intera.
  const p = periodoDelViaggio({ start_date: '2026-11-20', end_date: '2026-11-22' }, []);
  assert.equal(dentroIlPeriodo({ da: alle('2026-11-23T00:10:00') }, p), true);
  // Un giorno di margine, non due: oltre, si lascia perdere.
  assert.equal(dentroIlPeriodo({ da: alle('2026-11-24T10:00:00') }, p), false);
  assert.equal(dentroIlPeriodo({ da: alle('2026-11-19T23:50:00') }, p), true);
  assert.equal(dentroIlPeriodo({ da: alle('2026-11-18T10:00:00') }, p), false);
});

test('il margine non apre il periodo a chi non c’entra: resta un giorno', () => {
  assert.equal(MARGINE_MS, 86400000);
});

test('un tragitto senza orologio leggibile non entra nel periodo', () => {
  // `da` nullo vuol dire «non so quando»: non e' «dentro».
  const p = periodoDelViaggio({ start_date: '2026-11-20', end_date: '2026-11-22' }, []);
  assert.equal(dentroIlPeriodo({ da: null }, p), false);
  assert.equal(dentroIlPeriodo({}, p), false);
});

test('senza periodo non si guarda niente, invece di guardare tutto', () => {
  assert.equal(dentroIlPeriodo({ da: alle('2026-11-21T10:00:00') }, null), false);
});

// ---------------------------------------------------------------------------
// Il resoconto: ogni tappa in un secchio, e il secchio dice il perche'
// ---------------------------------------------------------------------------
//
// Revisione del 24/11/2026. `senza_traccia` metteva insieme quattro cose
// diverse -- una tappa in camper che nel file non c'e', un traghetto, una
// tappa scritta a mano senza orari, una tappa datata fuori dal viaggio -- e
// la pagina ne raccontava una sola: «nel file non c'e' un tragitto che le
// copra». Per il traghetto e' falso, e lascia credere che con un file
// migliore si sistemerebbe.
//
// E una tappa che aveva gia' la traccia ma stavolta non si e' agganciata
// finiva in nessun secchio: i conti tornavano a zero e di quella tappa non si
// diceva niente.
import { resoconto } from '../src/lib/tracciati.js';

const inCamper = (id, date, da, a) => ({ id, mezzo: 'camper', date, start_time: da, end_time: a });

test('chi aveva la traccia e chi ce l’ha adesso sono due conti diversi', () => {
  const tappe = [inCamper(1, '2026-11-21', '09:00', '12:00'),
                 { ...inCamper(2, '2026-11-21', '14:00', '16:00'), tracciato_vero: true }];
  const r = resoconto(tappe, new Map([[1, [{}]], [2, [{}]]]));
  assert.equal(r.attaccati, 1, 'la tappa nuova');
  assert.equal(r.gia_veri, 1, 'la tappa che l’aveva gia’');
  assert.equal(r.senza_traccia, 0);
});

test('un traghetto non e’ una tappa «senza traccia»: non ne avra’ mai una', () => {
  const tappe = [inCamper(1, '2026-11-21', '09:00', '12:00'),
                 { id: 2, mezzo: 'traghetto', date: '2026-11-21', start_time: '20:00', end_time: '23:00' }];
  const r = resoconto(tappe, new Map());
  assert.equal(r.senza_traccia, 1, 'solo la tappa in camper puo’ aspettarsi una traccia');
  assert.equal(r.senza_finestra, 1, 'il traghetto sta nel suo secchio, con la sua ragione');
});

test('una tappa scritta a mano, senza orari, non si puo’ cercare nel file', () => {
  const r = resoconto([{ id: 1, mezzo: 'camper', date: '2026-11-21', start_time: null, end_time: null }], new Map());
  assert.equal(r.senza_finestra, 1);
  assert.equal(r.senza_traccia, 0, 'dire «nel file non c’e’» sarebbe la ragione sbagliata');
});

test('una tappa che aveva la traccia e stavolta non si aggancia si dice', () => {
  const tappe = [{ ...inCamper(1, '2026-11-21', '09:00', '12:00'), tracciato_vero: true }];
  const r = resoconto(tappe, new Map());
  assert.equal(r.vere_intatte, 1);
  assert.equal(r.senza_traccia, 0, 'la traccia ce l’ha: non e’ senza');
  assert.equal(r.gia_veri, 0, 'ma stavolta non e’ stata riscritta');
});

test('i secchi tornano col numero delle tappe, sempre', () => {
  const tappe = [inCamper(1, '2026-11-21', '09:00', '12:00'),
                 { ...inCamper(2, '2026-11-21', '14:00', '16:00'), tracciato_vero: true },
                 { ...inCamper(3, '2026-11-21', '17:00', '18:00'), tracciato_vero: true },
                 { id: 4, mezzo: 'aereo', date: '2026-11-21', start_time: '08:00', end_time: '09:00' },
                 inCamper(5, '2026-11-21', '19:00', '20:00')];
  const r = resoconto(tappe, new Map([[1, [{}]], [2, [{}]]]));
  assert.equal(r.tappe, 5);
  assert.equal(r.attaccati + r.gia_veri + r.vere_intatte + r.senza_traccia + r.senza_finestra, 5,
    'una tappa in nessun secchio e’ una tappa di cui non si dice niente');
});

// ---------------------------------------------------------------------------
// Una traccia che copre un pezzo della tappa non e' la strada della tappa
// ---------------------------------------------------------------------------
//
// Trovato provando sulla pagina vera il 24/11/2026: una tappa di 192 km e'
// nata con 48 punti -- gli 8 km del primo dei due spezzoni uniti -- e sopra il
// bollino «strada vera». La causa (gli uuid che non si unisero) e' corretta,
// ma mancava la **rete**: niente si accorgeva che la riga coprisse il 4% del
// percorso.
//
// `tracciaPiuLunga`, in pagina, guarda il caso opposto -- una riga molto piu'
// lunga dei chilometri veri. Questo e' il verso rassicurante, ed e' il
// pericoloso: una riga corta non insospettisce nessuno.
import { copreLaTappa } from '../src/lib/tracciati.js';

test('una traccia che misura quanto la tappa va bene', () => {
  // Una riga di punti a un grado di latitudine l'uno: ~111 km per passo.
  const riga = [[45, 11], [45.9, 11], [46.8, 11]];  // ~200 km
  assert.equal(copreLaTappa(riga, 192.1), true);
});

test('una traccia che copre un pezzo della tappa non si prende il bollino', () => {
  const corta = [[45, 11], [45.07, 11]];  // ~8 km
  assert.equal(copreLaTappa(corta, 192.1), false,
    'una riga che copre il 4% del percorso si chiamava «strada vera»');
});

test('il campionamento accorcia un po’, e quel po’ non e’ un difetto', () => {
  // `samplePoints` taglia le curve, quindi la riga disegnata misura sempre un
  // filo meno del contachilometri. La soglia e' larga di conseguenza.
  const riga = [[45, 11], [45.8, 11]];  // ~89 km
  assert.equal(copreLaTappa(riga, 100), true, 'si scarta una traccia buona per l’11% di scarto');
});

test('senza una riga o senza chilometri non si giudica', () => {
  // `true` e non `false`: qui non si sta dicendo «la traccia e' buona», si sta
  // dicendo «non ho motivo di scartarla». Scartarla sarebbe buttare l'unico
  // dato misurato che c'e'.
  assert.equal(copreLaTappa([], 100), false, 'una riga vuota non e’ una strada');
  assert.equal(copreLaTappa([[45, 11], [45.8, 11]], null), true);
  assert.equal(copreLaTappa([[45, 11], [45.8, 11]], 0), true);
});
