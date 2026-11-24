// Il traduttore: dai campi di CarLock alle forme che il programma ha già.
//
// Disegno: docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md
//
// L'interfaccia non porta una strada nuova dentro il programma: porta gli
// stessi dati nella stessa forma, e da lì in poi passano per il codice che
// c'è -- `mergeTrips`, `min_km`, `assegna`, `cuci`. Se questo file facesse
// riscrivere una di quelle cose, sarebbe il disegno a essere sbagliato.
//
// **L'orologio è la trappola di tutto il lavoro.** Oggi i due lati del
// confronto usano orari senza fuso: `leggiTracciati` legge «2026-07-31
// 17:20:26» nel fuso del processo e `finestraDellaTappa` costruisce la
// mezzanotte nello stesso fuso, quindi sono storti uguale e l'errore si
// annulla. Il Mac è a Roma, Railway è a UTC, e col file va bene in entrambi.
// L'interfaccia invece dà **istanti assoluti**: con la tolleranza di tre
// minuti, un'ora di scarto vuol dire che nessuna traccia si aggancia a
// nessuna tappa, mai, e senza un errore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { comeIlFile, comePunti, oraDaParete } from '../src/lib/carlock-api.js';
import { mergeTrips } from '../src/lib/carlock.js';

const FORME = JSON.parse(readFileSync(new URL('./fixtures/carlock-api-forme.json', import.meta.url), 'utf8'));
const ROMA = 'Europe/Rome';

// Un tragitto grezzo come lo manda la loro interfaccia, con gli istanti che
// servono alla prova. Le coordinate sono inventate.
const tragitto = (inizio, fine, extra = {}) => ({
  uuid: 'T-' + inizio,
  start_time: Date.parse(inizio),
  end_time: Date.parse(fine),
  distance: 183979,
  tag: 'PERSONAL',
  start_location: { latitude: 45.1, longitude: 11.1, address: 'Via Finta 1, 30000 Paese' },
  end_location: { latitude: 46.0, longitude: 13.0, address: 'Piazza Inesistente 3, 30002 Terzo' },
  locations: [],
  ...extra,
});

test('i metri diventano chilometri, con un decimale come nel file', () => {
  const [a] = comeIlFile([FORME.trips_elenco.trips[1]], ROMA);
  assert.equal(a.km, 184.0);  // 183979 metri
});

test('l’identificativo e’ identico a quello che costruisce il file', () => {
  // `carlock:<data>:<inizio>:<fine>` con gli orari a minuti, come nel CSV.
  // Se i due non coincidono, lo stesso tragitto preso dal file e dal
  // rubinetto diventa DUE tappe, e il vincolo unico non se ne accorge.
  const [a] = comeIlFile([tragitto('2026-11-21T11:18:29+01:00', '2026-11-21T14:02:04+01:00')], ROMA);
  assert.equal(a.external_id, 'carlock:2026-11-21:11:18:14:02');
});

test('i capi portano le coordinate, cosi’ non si geocodifica un indirizzo che c’e’ gia’', () => {
  const [a] = comeIlFile([FORME.trips_elenco.trips[1]], ROMA);
  assert.equal(typeof a.da_lat, 'number');
  assert.equal(typeof a.a_lon, 'number');
  assert.ok(a.from.length > 0, 'il nome serve ancora: e’ quello che si legge');
});

test('la forma e’ quella del file, campo per campo', () => {
  // `mergeTrips`, `min_km` e la rotta dell'import leggono questi nomi. Un
  // campo che manca qui e' un campo che manca li', senza un errore.
  const [a] = comeIlFile([tragitto('2026-11-21T11:18:00+01:00', '2026-11-21T14:02:00+01:00')], ROMA);
  for (const campo of ['date', 'start', 'end', 'from', 'to', 'km', 'duration_min', 'type', 'external_id'])
    assert.ok(campo in a, `manca ${campo}, che il codice del file si aspetta`);
  assert.equal(a.date, '2026-11-21');
  assert.equal(a.start, '11:18');
  assert.equal(a.end, '14:02');
  assert.equal(a.duration_min, 164);
});

test('i punti escono nella forma dei tracciati, in ordine di tempo', () => {
  const p = comePunti(FORME.trip_singolo, ROMA);
  assert.equal(p.punti.length, FORME.trip_singolo.locations.length);
  assert.equal(typeof p.punti[0].t, 'number');
  assert.ok(p.punti[0].t <= p.punti[p.punti.length - 1].t);
  assert.equal(typeof p.punti[0].lat, 'number');
  assert.equal(p.id, FORME.trip_singolo.uuid);
  assert.equal(p.da, FORME.trip_singolo.start_time);
});

test('un punto senza coordinate si salta, il tragitto resta', () => {
  // La stessa regola di `leggiTracciati` col file: buttare settecento punti
  // buoni per un refuso vorrebbe dire perdere la strada per niente.
  const p = comePunti({ ...FORME.trip_singolo, locations: [
    { timestamp: 1, latitude: 45, longitude: 11 },
    { timestamp: 2, latitude: null, longitude: 11 },
    { timestamp: 3, latitude: 45.1, longitude: 11.1 },
  ] }, ROMA);
  assert.equal(p.punti.length, 2);
});

// ---------------------------------------------------------------------------
// L'orologio
// ---------------------------------------------------------------------------

test('la conversione non dipende dal fuso del processo', () => {
  // La prova che conta davvero e' il passo 5 del piano: tutta la suite con
  // `TZ=UTC`, cioe' come gira su Railway. Qui si pinza il valore noto, che e'
  // la protezione vera: un'implementazione che usa `new Date(ms)` e i getter
  // locali sbaglia questa asserzione appena il processo non e' a Roma.
  assert.equal(oraDaParete(Date.parse('2026-11-21T10:18:29Z'), ROMA).ora, '11:18',
    'le 10:18 UTC a Roma sono le 11:18');
  assert.equal(oraDaParete(Date.parse('2026-11-21T10:18:29Z'), ROMA).giorno, '2026-11-21');
  // E lo stesso istante letto in un altro fuso da' un'altra ora: se questa
  // passasse comunque, la funzione starebbe ignorando il fuso che le si da'.
  assert.equal(oraDaParete(Date.parse('2026-11-21T10:18:29Z'), 'America/New_York').ora, '05:18');
});

test('l’ora legale non sposta gli orari di un’ora', () => {
  // Review Focus 2. Il 25/10/2026 l'Italia torna all'ora solare: quel giorno
  // ha 25 ore. Prima del cambio +02:00, dopo +01:00. Un calcolo a mano
  // sull'offset sbaglia uno dei due.
  assert.equal(oraDaParete(Date.parse('2026-10-25T00:30:00Z'), ROMA).ora, '02:30');
  assert.equal(oraDaParete(Date.parse('2026-10-25T02:30:00Z'), ROMA).ora, '03:30');
  // E in primavera, il giorno da 23 ore.
  assert.equal(oraDaParete(Date.parse('2026-03-29T00:30:00Z'), ROMA).ora, '01:30');
  assert.equal(oraDaParete(Date.parse('2026-03-29T01:30:00Z'), ROMA).ora, '03:30');
});

test('la mezzanotte si scrive 00, non 24', () => {
  // `hourCycle: 'h23'`: con quello di suo, mezzanotte diventa «24:00» e
  // l'identificativo del tragitto non combacerebbe piu' con quello del file.
  assert.equal(oraDaParete(Date.parse('2026-11-21T23:10:00Z'), ROMA).ora, '00:10');
  assert.equal(oraDaParete(Date.parse('2026-11-21T23:10:00Z'), ROMA).giorno, '2026-11-22');
});

test('un tragitto che scavalca la mezzanotte resta leggibile', () => {
  // Review Focus 3. 23:50 -> 00:20: la data e' quella della PARTENZA (come
  // nel file, dove la riga ha una data sola) e la durata e' positiva.
  const [a] = comeIlFile([tragitto('2026-11-21T23:50:00+01:00', '2026-11-22T00:20:00+01:00')], ROMA);
  assert.equal(a.date, '2026-11-21');
  assert.equal(a.start, '23:50');
  assert.equal(a.end, '00:20');
  assert.equal(a.duration_min, 30, 'la durata e’ venuta negativa o enorme');
});

test('la durata viene dagli istanti, non dagli orari da parete', () => {
  // A cavallo del ritorno all'ora solare, fra le 02:30 e le 02:30 passa un'ora
  // vera. Contando sugli orari scritti verrebbe zero.
  const [a] = comeIlFile([tragitto('2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z')], ROMA);
  assert.equal(a.duration_min, 60, `ne ha contati ${a.duration_min}`);
});

// ---------------------------------------------------------------------------
// Le tappe unite: il capo d'arrivo deve seguire
// ---------------------------------------------------------------------------
//
// Trovato nella scansione prima di cominciare. `mergeTrips` unendo due
// tragitti fa `last.to = t.to` -- il NOME del capo d'arrivo -- ma le
// coordinate nella forma del file non esistevano, quindi non le porta
// appresso. Con quelle del rubinetto, una tappa unita terrebbe le coordinate
// d'arrivo del PRIMO tragitto: un capo nel posto sbagliato, e muto.
test('unendo due tragitti, il capo d’arrivo porta appresso le sue coordinate', () => {
  const uno = comeIlFile([tragitto('2026-11-21T11:00:00+01:00', '2026-11-21T11:20:00+01:00')], ROMA)[0];
  const due = comeIlFile([tragitto('2026-11-21T11:30:00+01:00', '2026-11-21T14:00:00+01:00', {
    end_location: { latitude: 46.0634, longitude: 13.2345, address: 'Udine' },
  })], ROMA)[0];
  const [unita] = mergeTrips([uno, due], 30);
  assert.equal(unita.merged, 2, 'i due tragitti non si sono uniti: la prova non guarda niente');
  assert.equal(unita.a_lat, 46.0634, 'la tappa unita arriva dove arrivava il primo tragitto');
  assert.equal(unita.a_lon, 13.2345);
  assert.equal(unita.da_lat, uno.da_lat, 'e parte da dove partiva il primo');
});

test('il file continua a non avere coordinate, e non se ne accorge', () => {
  // `mergeTrips` la usa anche l'import da file, dove quei campi non ci sono.
  const senza = [
    { date: '2026-11-21', start: '11:00', end: '11:20', from: 'A', to: 'B', km: 10, duration_min: 20, external_id: 'carlock:2026-11-21:11:00:11:20' },
    { date: '2026-11-21', start: '11:30', end: '14:00', from: 'B', to: 'C', km: 180, duration_min: 150, external_id: 'carlock:2026-11-21:11:30:14:00' },
  ];
  const [unita] = mergeTrips(senza, 30);
  assert.equal(unita.merged, 2);
  assert.equal(unita.to, 'C');
  assert.equal(unita.a_lat, undefined, 'si e’ inventata una coordinata che non c’era');
});
