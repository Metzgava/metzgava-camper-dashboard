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
import { comeIlFile, comePunti, oraDaParete, comeIlLettore } from '../src/lib/carlock-api.js';
import { mergeTrips, parseCarlockCsv } from '../src/lib/carlock.js';

const FORME = JSON.parse(readFileSync(new URL('./fixtures/carlock-api-forme.json', import.meta.url), 'utf8'));
const ROMA = 'Europe/Rome';

// Un tragitto grezzo come lo manda la loro interfaccia, con gli istanti che
// servono alla prova. Le coordinate sono inventate.
// Gli uuid veri sono esadecimali con dei trattini: niente `+`, che e' il
// separatore con cui si uniscono quelli delle tappe unite. Un uuid finto che
// ne contenesse uno proverebbe un'altra cosa.
let contatore = 0;
const tragitto = (inizio, fine, extra = {}) => ({
  uuid: `0000000${(++contatore).toString(16)}-1111-4111-8111-111111111111`,
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
  // `da` non e' piu' il millisecondo grezzo dell'interfaccia: e' lo stesso
  // istante nella scala del lettore del file (vedi la prova sulla scala qui
  // sotto). Questa asserzione pinzava il contratto di prima, e passava solo
  // nel fuso in cui le due scale coincidono.
  assert.equal(p.da, comeIlLettore(FORME.trip_singolo.start_time, ROMA));
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

// ---------------------------------------------------------------------------
// Trovati provando sulla pagina vera, il 24/11/2026
// ---------------------------------------------------------------------------
//
// Accettando il tragitto del 21 novembre -- 192,1 km, due tragitti uniti da
// cinque minuti di sosta -- e' nata una tappa con **48 punti** e il bollino
// «strada vera». Quarantotto punti sono gli 8 km del primo spezzone: il
// 96% del percorso non c'era, e la riga diceva di essere quella percorsa.
//
// Causa: `mergeTrips` unisce `external_id` ma non gli `uuid`, e gli uuid sono
// quelli con cui si chiedono i punti. Ne chiedevo uno solo.
test('unendo due tragitti, gli uuid si uniscono come gli identificativi', () => {
  const uno = comeIlFile([tragitto('2026-11-21T11:02:00+01:00', '2026-11-21T11:13:00+01:00')], ROMA)[0];
  const due = comeIlFile([tragitto('2026-11-21T11:18:00+01:00', '2026-11-21T14:02:00+01:00')], ROMA)[0];
  const [unita] = mergeTrips([uno, due], 30);
  assert.equal(unita.merged, 2, 'i due non si sono uniti: la prova non guarda niente');
  assert.deepEqual(String(unita.uuid).split('+'), [uno.uuid, due.uuid],
    'si chiederebbero i punti di un solo spezzone, e la riga coprirebbe un pezzo della tappa');
});

test('il file non ha uuid, e unire non ne inventa', () => {
  const senza = [
    { date: '2026-11-21', start: '11:02', end: '11:13', from: 'A', to: 'B', km: 8, duration_min: 11, external_id: 'carlock:2026-11-21:11:02:11:13' },
    { date: '2026-11-21', start: '11:18', end: '14:02', from: 'B', to: 'C', km: 184, duration_min: 164, external_id: 'carlock:2026-11-21:11:18:14:02' },
  ];
  const [unita] = mergeTrips(senza, 30);
  assert.equal(unita.merged, 2);
  assert.equal(unita.uuid, undefined, 'si e’ inventato un identificativo che non c’era');
});

// L'altro difetto della stessa prova: la tappa si chiamava «Italy → Italy».
//
// L'interfaccia scrive l'indirizzo in tre pezzi col **paese** in coda --
// «via, CAP citta provincia, Italy» -- mentre il file lo scrive in due e
// senza paese. `nomeTappa` prende l'ultimo pezzo per il nome del posto, e
// l'ultimo pezzo era il paese.
test('il paese in coda si toglie: la forma e’ quella del file', () => {
  const [a] = comeIlFile([tragitto('2026-11-21T11:00:00+01:00', '2026-11-21T12:00:00+01:00', {
    start_location: { latitude: 45.8, longitude: 12.2, address: 'Via Cavour 9, 31058 Susegana Treviso, Italy' },
    end_location: { latitude: 46.0, longitude: 13.2, address: 'Piazza Primo Maggio, 33100 Udine, Italy' },
  })], ROMA);
  assert.equal(a.from, 'Via Cavour 9, 31058 Susegana Treviso');
  assert.equal(a.to, 'Piazza Primo Maggio, 33100 Udine');
});

test('un indirizzo straniero in due pezzi perde il paese e tiene il posto', () => {
  // Come lo scrive il file: «Tolmin Tolmin Municipality». CarLock ci aggiunge
  // il paese, e senza toglierlo la tappa si chiamerebbe «Slovenia».
  const [a] = comeIlFile([tragitto('2026-11-21T11:00:00+01:00', '2026-11-21T12:00:00+01:00', {
    start_location: { latitude: 46.1, longitude: 13.7, address: 'Tolmin Tolmin Municipality, Slovenia' },
  })], ROMA);
  assert.equal(a.from, 'Tolmin Tolmin Municipality');
});

test('un indirizzo di un pezzo solo resta com’e’', () => {
  // Non si butta l'unica cosa che c'e'.
  const [a] = comeIlFile([tragitto('2026-11-21T11:00:00+01:00', '2026-11-21T12:00:00+01:00', {
    start_location: { latitude: 46.1, longitude: 13.7, address: 'Italy' },
  })], ROMA);
  assert.equal(a.from, 'Italy');
});

test('un tragitto senza la misura non diventa zero chilometri', () => {
  // La revisione finale: `?? 0` sui metri e' lo stesso difetto che il
  // 24/11 era stato togliato dalle coordinate -- `Number(null)` e' zero, che
  // e' finito -- rimesso sulla misura che diventa gasolio e totali. E un
  // tragitto da «0 km» finiva fra quelli «sotto i 3 km», che e' la ragione
  // sbagliata per «non ho la misura».
  const [a] = comeIlFile([tragitto('2026-11-21T11:00:00+01:00', '2026-11-21T12:00:00+01:00',
    { distance: null })], ROMA);
  assert.equal(a.km, null, 'un tragitto senza distanza dichiara zero chilometri');
});

test('un tragitto con l’orologio illeggibile si salta, e gli altri si salvano', () => {
  // `oraDaParete(undefined)` lancia: **un** tragitto malformato faceva
  // perdere gli altri sei, e la rotta rispondeva 502 «Invalid time value».
  // L'interfaccia non e' documentata: non ci si fida della sua forma.
  const buoni = comeIlFile([
    tragitto('2026-11-21T11:00:00+01:00', '2026-11-21T12:00:00+01:00'),
    { uuid: 'rotto', start_time: null, end_time: null, distance: 1000, locations: [] },
    tragitto('2026-11-21T15:00:00+01:00', '2026-11-21T16:00:00+01:00'),
  ], ROMA);
  assert.equal(buoni.length, 2, 'un tragitto rotto porta giu’ tutti gli altri');
});

// ---------------------------------------------------------------------------
// L'identificativo: la stessa cosa dal file e dal rubinetto
// ---------------------------------------------------------------------------
//
// Su questo poggia tutto il disegno dei doppioni, e la revisione finale ha
// trovato che **non era provato contro il file**: la prova pinzava il valore
// dell'interfaccia contro una stringa scritta a mano, e `parseCarlockCsv` non
// girava in nessuna prova. Se l'export scrivesse gli orari coi secondi,
// **ogni** identificativo sarebbe diverso e ogni viaggio gia' importato dal
// file diventerebbe una seconda tappa coi chilometri raddoppiati.
test('lo stesso tragitto dal file e dal rubinetto ha lo stesso identificativo', () => {
  const csv = [
    '"Data","Orario di inizio","Orario di fine","Posizione di inizio","Posizione di fine","Distanza ( km )","Durata","Punteggio di guida","Tipo"',
    '"21/11/2026","11:18","14:02","Via Lungo Monti 10, 38027 Novaledo Trentino","Via Floriano Candonio, 33100 Udine","184,0km","2h 44min","100","Personale"',
  ].join('\n');
  const [dalFile] = parseCarlockCsv(csv);
  const [dalRubinetto] = comeIlFile([tragitto('2026-11-21T11:18:29+01:00', '2026-11-21T14:02:04+01:00')], ROMA);
  assert.equal(dalRubinetto.external_id, dalFile.external_id,
    `il file dice ${dalFile.external_id}, il rubinetto ${dalRubinetto.external_id}: ogni viaggio diventerebbe due tappe`);
  assert.equal(dalRubinetto.date, dalFile.date);
  assert.equal(dalRubinetto.start, dalFile.start);
  assert.equal(dalRubinetto.end, dalFile.end);
});

// ---------------------------------------------------------------------------
// I punti nella scala che `leggiTracciati` produce
// ---------------------------------------------------------------------------
//
// La revisione finale, come difetto **latente**: `comePunti` tornava
// millisecondi assoluti, mentre `leggiTracciati` legge una data senza fuso nel
// fuso del processo. `cuci` ordina soltanto, quindi oggi non si vede -- ma
// `assegna` e `finestraDellaTappa` costruiscono le loro finestre dalla
// mezzanotte locale, con tre minuti di tolleranza: dandogli questi punti su
// Railway non si aggancerebbe **niente, mai, senza un errore**. E il piano
// dichiara che questa funzione produce «la forma di `leggiTracciati` così
// `assegna` e `cuci` funzionano come col file»: il prossimo lo fara'.
test('i punti sono sulla stessa scala che produce il lettore del file', () => {
  const p = comePunti({ uuid: 'x', start_time: Date.parse('2026-11-21T11:18:29+01:00'),
    end_time: Date.parse('2026-11-21T11:18:44+01:00'),
    locations: [{ timestamp: Date.parse('2026-11-21T11:18:29+01:00'), latitude: 45, longitude: 11 }] }, ROMA);
  // Quel che `leggiTracciati` produrrebbe per lo stesso istante, cioe'
  // «2026-11-21 11:18:29» letto nel fuso del processo.
  const comeIlLettore = new Date('2026-11-21T11:18:29').getTime();
  assert.equal(p.punti[0].t, comeIlLettore,
    'i punti sono su una scala che `assegna` non sa confrontare');
  assert.equal(p.da, comeIlLettore);
});
