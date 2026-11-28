// La taratura: richiudibile, e in fondo alla pagina Impianto.
//
// Chiesto il 28/11/2026: «lasciala ma rendi la sezione espandibile ma in
// fondo alla pagina».
//
// Stava **per prima**, in cima a Impianto, aperta sempre. Ma e' la cosa che
// si usa una sera ogni tanto -- la serata in cui si accende un carico per
// volta -- mentre i dati fissi e il collegamento al cloud si guardano di
// continuo. Metterla per prima costringeva a scorrerla ogni volta per
// arrivare a quel che serve davvero.
//
// Resta perche' e' **l'unica strada per misurare i consumi a 12 V**: frigo,
// pompa, luci, Starlink. La strada della Bluetti, che il 28/11 ha misurato i
// watt della Truma, vede solo quel che passa dai suoi 230 V.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

// La vista Impianto, dal suo `return` alla graffa che la chiude.
function vistaImpianto() {
  const i = app.indexOf('const taratura = await bloccoTaratura();');
  assert.ok(i > 0, 'non trovo la vista Impianto');
  const fine = app.indexOf('\n}', i);
  return app.slice(i, fine);
}

test('la taratura sta in fondo, non in cima', () => {
  const v = vistaImpianto();
  const dove = v.indexOf('${taratura}');
  const fissi = v.indexOf('I dati fissi');
  const collegamenti = v.indexOf('Collegamenti');
  assert.ok(dove > 0, 'la taratura non viene disegnata');
  assert.ok(dove > fissi, 'la taratura viene prima dei dati fissi');
  assert.ok(dove > collegamenti, 'la taratura viene prima dei collegamenti');
});

test('la taratura e’ richiudibile', () => {
  // `<details>` invece di un interruttore scritto a mano: si apre e si chiude
  // da se', funziona senza JavaScript, e la tastiera ci arriva gratis. Un
  // `div` con un `onclick` sarebbe piu' codice e meno accessibile.
  assert.match(app, /<details[^>]*class="[^"]*taratura/,
    'la taratura non e’ dentro un <details>');
  assert.match(app, /<summary/, 'manca l’intestazione su cui premere');
});

test('e’ chiusa quando apri la pagina', () => {
  // **Il punto della richiesta.** Un `<details open>` sarebbe espandibile e
  // non cambierebbe niente: resterebbe aperta in mezzo ai piedi.
  const i = app.indexOf('<details');
  // Senza questa riga la prova passerebbe **a vuoto** finche' il `<details>`
  // non esiste: `indexOf` torna -1 e la fetta e' spazzatura.
  assert.ok(i > 0, 'non c’e’ nessun <details>: la prova girerebbe a vuoto');
  const d = app.slice(i, i + 120);
  assert.doesNotMatch(d, /\bopen\b/,
    'la sezione si apre da sola: cosi’ spostarla in fondo non serve a niente');
});

test('l’intestazione dice cos’e’ e quando serve, senza doverla aprire', () => {
  // Una sezione chiusa che si chiama solo «Taratura» non si apre mai, perche'
  // nessuno ricorda cosa c'e' dentro.
  // Ancorata **al suo blocco**, non al primo `<summary>` del file: dal
  // 28/11/2026 ce ne sono altri prima (gli apparecchi attesi, la
  // calcolatrice), e questa prova guardava il sommario sbagliato — passando
  // o fallendo per dove stava nel file, non per quel che dice.
  const d = app.indexOf('<details class="scheda taratura"');
  assert.ok(d > 0, 'non trovo il blocco della taratura');
  const s = app.slice(app.indexOf('<summary', d), app.indexOf('</summary>', d));
  assert.match(s, /12 V|una sera|carico per volta/i,
    `l’intestazione non dice a cosa serve: «${s.slice(0, 120)}»`);
});

test('i tasti della taratura restano agganciati', () => {
  // Dentro un `<details>` chiuso gli elementi **esistono** nel documento, e
  // `querySelector` li trova: il cablaggio dei tasti non cambia. Questa prova
  // c'e' perche' la domanda viene naturale, e la risposta va scritta una
  // volta invece di riscoprirla.
  for (const id of ['taratura-chiudi', 'taratura-nome'])
    assert.ok(app.includes(id), `manca il tasto «${id}»`);
});

test('l’istruzione non manda a guardare la testata vecchia', () => {
  // Trovato guardando la sezione aperta, subito dopo averla spostata. Dentro
  // c'era scritto «comincia quando **l'ora in alto a destra** diventa fresca
  // di meno di un minuto»: parlava della testata di prima, che mostrava
  // `letto alle HH:MM`. Quella testata non esiste piu' — adesso dice «dati di
  // adesso» o «dati di N fa» — quindi l'istruzione mandava a fissare una cosa
  // che non si comporta piu' cosi'.
  //
  // E' il costo nascosto di cambiare un pezzo di interfaccia: le frasi che lo
  // nominano altrove restano indietro, e nessuna prova sui valori le vede.
  assert.doesNotMatch(app, /l'ora in alto a destra/,
    'c’e’ ancora un’istruzione che parla dell’orario della testata vecchia');
});
