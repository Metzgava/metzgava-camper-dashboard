// Le note lunghe si chiudono, così la pagina scorre meno.
//
// Chiesto il 28/11/2026: «comprimi le note nei box in scuro ed espandibili in
// modo che la pagina si debba scrollare il meno possibile... fai questa cosa
// anche sulle altre pagine».
//
// Le `.nota` sono ventiquattro, e sono le scatole ambrate: tre, cinque, otto
// righe di spiegazione ciascuna. Spiegano bene, e **la prima volta servono**.
// Dalla seconda in poi stanno fra te e il numero che sei venuto a vedere.
//
// I `.perche` invece restano come sono: sono cinquantaquattro, una riga sotto
// ogni voce, e chiuderli non guadagnerebbe spazio -- costerebbe un tocco per
// non risparmiare niente.
//
// Qui si prova quel che si può sbagliare senza accorgersene: la soglia, il
// taglio del riassunto e la chiave che fa sopravvivere una nota aperta al
// ridisegno. Il movimento nel DOM si guarda nel browser, come per `scorri`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riassunto, vaCompressa, chiaveNota, SOGLIA_CARATTERI } from '../public/note.js';

const CORTA = 'Non è di adesso: la lettura è di prima.';
const LUNGA = 'Gli ampere della presa si scelgono qui sopra, in Quanto ci vuole a '
  + 'caricarla: cambiano a ogni piazzola, e per questo non stanno fra i dati fissi '
  + 'dell’Impianto.';

test('una nota corta si lascia stare', () => {
  // **La prova che impedisce di esagerare.** Chiudere due righe dentro un
  // riassunto di una riga costa un tocco e risparmia una riga sola: si è
  // guadagnato niente e si è nascosto qualcosa.
  assert.equal(vaCompressa(CORTA), false);
});

test('una nota lunga si chiude', () => {
  assert.equal(vaCompressa(LUNGA), true);
});

test('la soglia sta sopra le due righe di un telefono', () => {
  // A 13.5px dentro una scatola larga come un telefono ci stanno circa 55
  // caratteri per riga. Sotto le tre righe non vale la pena.
  assert.ok(SOGLIA_CARATTERI >= 110, `soglia troppo bassa: ${SOGLIA_CARATTERI}`);
});

test('il riassunto porta le parole della nota, non un’etichetta generica', () => {
  // Se tutte dicessero «spiegazione», non sapresti mai quale aprire, e non ne
  // apriresti più nessuna. Il riassunto deve far riconoscere **questa** nota.
  const r = riassunto(LUNGA);
  assert.match(r, /ampere della presa/,
    `il riassunto non dice di cosa parla: «${r}»`);
});

test('il riassunto non taglia una parola a metà', () => {
  const r = riassunto(LUNGA).replace(/…$/, '').trimEnd();
  assert.ok(LUNGA.startsWith(r), 'il riassunto non è l’inizio della nota');
  assert.ok(LUNGA[r.length] === undefined || /\s/.test(LUNGA[r.length]),
    `taglia dentro una parola: «${r}|${LUNGA.slice(r.length, r.length + 8)}»`);
});

test('il riassunto è più corto della nota, e si vede che continua', () => {
  const r = riassunto(LUNGA);
  assert.ok(r.length < LUNGA.length, 'il riassunto non è più corto');
  assert.match(r, /…$/, 'niente dice che la nota continua');
});

test('una nota vuota o assente non fa esplodere niente', () => {
  for (const niente of ['', '   ', null, undefined]) {
    assert.equal(vaCompressa(niente), false);
    assert.equal(typeof riassunto(niente), 'string');
  }
});

// ---------------------------------------------------------------------------
// La chiave: perché una nota aperta non deve richiudersi da sola
// ---------------------------------------------------------------------------
//
// `#/adesso` ed `#/energia` si rifanno **ogni due secondi e mezzo**,
// sostituendo tutto. Senza un modo di riconoscere la stessa nota fra un
// ridisegno e l'altro, una nota aperta si richiuderebbe in faccia dopo due
// secondi -- e sembrerebbe un difetto del tasto, non una scelta.

test('la stessa nota ha la stessa chiave', () => {
  assert.equal(chiaveNota(LUNGA), chiaveNota(LUNGA));
});

test('note diverse hanno chiavi diverse', () => {
  assert.notEqual(chiaveNota(LUNGA), chiaveNota(CORTA));
});

test('un numero che cambia dentro la nota non cambia la chiave', () => {
  // **La prova che regge tutta la faccenda.** Qualche nota porta dentro un
  // valore vivo. Se la chiave cambiasse con lui, quella nota si
  // richiuderebbe da sé a ogni ridisegno: due secondi e mezzo e via.
  const a = 'La scatoletta legge ogni 10 secondi e la pagina si rifà da sé, '
    + 'quindi non serve toccare niente per vedere il numero muoversi.';
  const b = a.replace('10 secondi', '120 secondi');
  assert.equal(chiaveNota(a), chiaveNota(b));
});

test('la chiave regge anche una nota cortissima', () => {
  assert.equal(typeof chiaveNota('ok'), 'string');
  assert.ok(chiaveNota('ok').length > 0);
});

// ---------------------------------------------------------------------------
// Si chiude il TESTO, non il DOM
// ---------------------------------------------------------------------------
//
// Prima avevo scritto la versione che modificava il DOM dopo il disegno. E'
// sbagliata qui: la pagina **non sostituisce, confronta** -- `rifondi` tocca
// solo quel che e' cambiato, e al giro dopo avrebbe rimesso le note com'erano,
// ogni due secondi e mezzo.
//
// Quindi le note si chiudono **nel testo**, prima di darlo a `rifondi`: una
// chiamata sola in `disegna`, e il confronto vede sempre la forma definitiva.
import { comprimiNelTesto } from '../public/note.js';

const BOX = (dentro, attr = '') => `<div class="nota"${attr}>${dentro}</div>`;
const TESTO_LUNGO = 'Gli ampere della presa si scelgono qui sopra, in <b>Quanto ci '
  + 'vuole a caricarla</b>: cambiano a ogni piazzola, e per questo non stanno fra i '
  + 'dati fissi dell’Impianto.';

test('una nota lunga diventa una sezione richiudibile', () => {
  const r = comprimiNelTesto(BOX(TESTO_LUNGO), new Set());
  assert.match(r, /<details class="nota"/);
  assert.match(r, /<summary/);
});

test('il contenuto della nota non si perde, grassetti compresi', () => {
  const r = comprimiNelTesto(BOX(TESTO_LUNGO), new Set());
  assert.match(r, /<b>Quanto ci vuole a caricarla<\/b>/,
    'il grassetto dentro la nota e’ sparito');
  assert.match(r, /dati fissi dell’Impianto\./, 'la coda della nota e’ sparita');
});

test('il riassunto nel sommario non porta i tag dentro', () => {
  const r = comprimiNelTesto(BOX(TESTO_LUNGO), new Set());
  const s = r.slice(r.indexOf('<summary'), r.indexOf('</summary>'));
  assert.doesNotMatch(s, /<b>/, 'il sommario porta dentro del markup');
});

test('una nota corta resta una nota', () => {
  const corta = BOX('Non è di adesso: la lettura è di prima.');
  assert.equal(comprimiNelTesto(corta, new Set()), corta);
});

test('una nota che era aperta resta aperta dopo il ridisegno', () => {
  // **Il punto di tutta la faccenda.** Senza questo, aprire una nota su
  // «Adesso» durerebbe due secondi e mezzo e sembrerebbe un tasto rotto.
  const chiusa = comprimiNelTesto(BOX(TESTO_LUNGO), new Set());
  const chiave = chiusa.match(/data-chiave="([^"]*)"/)[1];
  const aperta = comprimiNelTesto(BOX(TESTO_LUNGO), new Set([chiave]));
  assert.match(aperta, /<details[^>]*\sopen/, 'la nota aperta si e’ richiusa da sola');
  assert.doesNotMatch(chiusa, /<details[^>]*\sopen/, 'nasce aperta: non serve a niente');
});

test('lo stile scritto sulla nota viaggia con lei', () => {
  const r = comprimiNelTesto(BOX(TESTO_LUNGO, ' style="margin-top:8px"'), new Set());
  assert.match(r, /style="margin-top:8px"/, 'lo stile della nota e’ andato perso');
});

test('una nota con un div dentro si lascia stare invece di storpiarla', () => {
  // Oggi nessuna delle ventiquattro ha un `<div>` dentro, e il taglio al
  // primo `</div>` e' quindi giusto. Ma se un giorno qualcuno ne annida uno,
  // il taglio cadrebbe nel punto sbagliato e **spezzerebbe la pagina**.
  // Meglio una nota non chiusa che una pagina rotta.
  const strana = '<div class="nota">Una spiegazione lunga abbastanza da superare '
    + 'la soglia dei centoquaranta caratteri, con dentro <div>un altro blocco</div> '
    + 'e poi ancora del testo che continua.</div>';
  assert.equal(comprimiNelTesto(strana, new Set()), strana);
});

test('non tocca il resto della pagina', () => {
  const pagina = `<div class="scheda">valori</div>${BOX(TESTO_LUNGO)}<div class="perche">piccolo</div>`;
  const r = comprimiNelTesto(pagina, new Set());
  assert.match(r, /<div class="scheda">valori<\/div>/);
  assert.match(r, /<div class="perche">piccolo<\/div>/);
});

test('passarci due volte non raddoppia niente', () => {
  const una = comprimiNelTesto(BOX(TESTO_LUNGO), new Set());
  assert.equal(comprimiNelTesto(una, new Set()), una);
});

// ---------------------------------------------------------------------------
// I due blocchi grossi: la calcolatrice e gli apparecchi attesi
// ---------------------------------------------------------------------------
//
// Misurati il 28/11/2026 a larghezza di telefono: la calcolatrice di Energia
// e' **835 px**, un quarto della pagina; i cinque riquadri degli apparecchi
// attesi su Adesso sono **640 px**, cioe' centotrenta pixel a testa per dire
// che non hanno niente da dire.
//
// Chiuderli vale piu' di mille pixel in due -- una schermata e mezza. Ma
// chiudere non deve voler dire **nascondere**: il riassunto porta fuori quel
// che si andava a leggere li' dentro.
import { riassuntoAttesi, riassuntoCalcolo } from '../public/note.js';
import { readFileSync } from 'node:fs';

test('il riassunto della calcolatrice porta fuori la risposta', () => {
  // Chiusa deve dire **il numero**, non «calcolatrice»: altrimenti bisogna
  // aprirla per sapere una cosa che si sapeva gia' guardando.
  const r = riassuntoCalcolo({ da: 30, a: 100, wh: 1930 });
  assert.match(r, /30/);
  assert.match(r, /100/);
  assert.match(r, /1,93|1\.93/, `manca i kWh: «${r}»`);
});

test('se manca la capacita’ la calcolatrice non inventa un numero', () => {
  const r = riassuntoCalcolo({ da: 30, a: 100, wh: null });
  assert.doesNotMatch(r, /\d+[,.]\d+ kWh/, `si e’ inventato i kWh: «${r}»`);
  assert.match(r, /30/, 'ha perso anche quel che sapeva');
});

test('gli apparecchi che TACCIONO si dicono per primi, e non si confondono con gli altri', () => {
  // **La prova che impedisce di nascondere un allarme.** Un apparecchio che
  // ha parlato e ora tace e' una notizia; uno che non ha mai parlato e' un
  // pezzo che non c'e' ancora. Metterli nello stesso mucchio chiuso
  // sotterrerebbe il primo sotto il secondo.
  const r = riassuntoAttesi([
    { nome: 'Ective', tace_da_minuti: 40 },
    { nome: 'Blink', tace_da_minuti: null },
    { nome: 'Tuya', tace_da_minuti: null },
  ]);
  assert.match(r, /2 tacciono|tacciono.*2|1 tace/, `non conta quelli che tacciono: «${r}»`);
  assert.match(r, /\b1\b|\b2\b/, 'non dice quanti sono');
  assert.ok(r.indexOf('tace') < r.indexOf('collegat') || !/collegat/.test(r),
    `quelli che tacciono non vengono per primi: «${r}»`);
});

test('quando nessuno tace si dice soltanto quanti mancano', () => {
  const r = riassuntoAttesi([{ nome: 'Blink', tace_da_minuti: null },
                             { nome: 'Tuya', tace_da_minuti: null }]);
  assert.doesNotMatch(r, /tace|tacciono/, `parla di silenzi che non ci sono: «${r}»`);
  assert.match(r, /2/);
});

test('con un apparecchio solo non si scrive al plurale', () => {
  const r = riassuntoAttesi([{ nome: 'Blink', tace_da_minuti: null }]);
  assert.doesNotMatch(r, /apparecchi\b/, `plurale con uno solo: «${r}»`);
});

test('senza nessun atteso il riassunto e’ vuoto, cosi’ il blocco non si disegna', () => {
  assert.equal(riassuntoAttesi([]), '');
  assert.equal(riassuntoAttesi(null), '');
});

test('ogni details con una chiave sa anche RIAPRIRSI dopo il ridisegno', () => {
  // Trovato guardando, il 28/11/2026: la calcolatrice aveva la chiave e il
  // gestore del tocco la registrava — ma il suo markup non consultava mai
  // `NOTE_APERTE`, quindi a ogni ridisegno rinasceva chiusa. Da fuori e'
  // identico a un tasto che non funziona.
  //
  // La chiave da sola non basta: dare la chiave e leggere la chiave sono due
  // cose, e la prima senza la seconda non si vede finche' non si guarda.
  // Questa prova vale per **tutti** i details con chiave, anche quelli che
  // verranno.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const con = [...app.matchAll(/<details[^>]*data-chiave="([^"$]+)"([^>]*)>/g)];
  assert.ok(con.length >= 2, `trovati solo ${con.length} details con chiave`);
  for (const [intero, chiave, resto] of con) {
    assert.match(intero + resto, /apertoSe|NOTE_APERTE|\$\{.*open/,
      `«${chiave}» non si riapre dopo il ridisegno: ${intero.slice(0, 70)}`);
  }
});
