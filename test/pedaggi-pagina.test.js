// Le tre risposte sull'autostrada, e quel che la pagina dice di loro.
//
// Disegno: docs/superpowers/specs/2026-11-22-pedaggi-dichiarati-design.md
//
// Le ancore sono **precise** di proposito: in questo progetto prove con ancore
// larghe sono passate senza provare niente -- «In camper» che pescava la
// tabella dei mezzi, un «badge ok» a centotrentasettemila caratteri di
// distanza, «passando per» che trovava il campo della pianificazione.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// La riga della tappa, delimitata dai suoi due capi veri
// ---------------------------------------------------------------------------
//
// Dall'inizio del modello della riga fino a dove ricominciano i costi.
//
// **Non si contano i caratteri.** Il 24/11/2026 quattro prove sono cadute
// tutte insieme per una ragione che non c'entrava niente con quel che
// provavano: erano state aggiunte dentro il blocco delle righe di commento, e
// la finestra contata a mano non arrivava piu' fino alla frase. Una prova che
// cade quando si spiega meglio il codice non sta misurando il codice.
const rigaDellaTappa = (() => {
  const i = app.indexOf('const legRow =');
  const j = app.indexOf('${rigaCosti(l)}', i);
  assert.ok(i > 0 && j > i, 'il modello della riga della tappa non si trova piu\u2019');
  return app.slice(i, j);
})();
// Il riquadro del ridisegno, dalla domanda sui luoghi alla fine della funzione
// che lo apre: il confine e' la funzione dopo, non un numero di caratteri che
// coi commenti cresce e un giorno sfonda altrove.
const riquadro = (() => {
  const i = app.indexOf('Per dove siete passati davvero?');
  assert.ok(i > 0, 'il riquadro del ridisegno non si trova piu’');
  const fine = app.indexOf('\nfunction ', i);
  assert.ok(fine > i, 'il riquadro non ha una funzione dopo: finestra non delimitabile');
  return app.slice(i, fine);
})();

test('il riquadro chiede dell’autostrada, con tre risposte', () => {
  // Le risposte si generano da una lista, quindi gli attributi scritti a mano
  // non ci sono: la prova guarda **la lista**, che e' dove le tre risposte
  // vivono davvero. Cercare `value="si"` passerebbe solo riscrivendo il
  // riquadro a mano, cioe' proverebbe la forma del codice invece del
  // comportamento.
  assert.match(riquadro, /name="pedaggi"/, 'il campo dell’autostrada non c’e’');
  const lista = riquadro.slice(riquadro.indexOf('Avete fatto'), riquadro.indexOf('.map('));
  assert.match(lista, /\['si',/, 'manca la risposta «si’»');
  assert.match(lista, /\['no',/, 'manca la risposta «no»');
  assert.match(lista, /\['',/, 'manca «non lo so», che non e’ «no»');
  assert.match(riquadro, /type="radio"/, 'le tre risposte non si escludono fra loro');
});

test('«si» non promette piu’ di quel che fa', () => {
  // Nessun servizio ha un «preferisci i pedaggi»: la piu' rapida e' quel che
  // in pratica usa l'autostrada, e raccontarla come autostrada richiesta
  // sarebbe una promessa piu' grande del dato.
  assert.match(riquadro, /più rapida/,
    '«si» viene raccontato come se l’autostrada fosse stata chiesta');
});

test('la risposta di adesso e’ quella spuntata', () => {
  // Riaprendo il riquadro si deve vedere quel che si era detto: altrimenti
  // ogni correzione dei luoghi ridichiarerebbe «non lo so».
  assert.match(riquadro, /pedaggi_dichiarati/,
    'il riquadro si apre senza sapere cosa avevi dichiarato');
});

test('la dichiarazione si manda insieme ai posti', () => {
  const invio = riquadro.slice(riquadro.indexOf('/via`'));
  assert.ok(invio.length > 0, 'il riquadro non chiama piu’ la rotta del ridisegno');
  assert.match(invio.slice(0, 300), /pedaggi/, 'si mandano i posti e non l’autostrada');
});

test('quando quel che esce non torna, lo si legge', () => {
  assert.match(riquadro, /pedaggi_avviso/, 'l’avviso arriva dalla rotta e nessuno lo mostra');
  for (const caso of ['ne_fa_comunque', 'non_ne_fa', 'non_chiedibile'])
    assert.match(riquadro, new RegExp(caso), `il caso ${caso} arriva e resta zitto`);
});

test('la riga della tappa dice l’autostrada dichiarata', () => {
  // L'ancora porta il carattere che chiude il pezzo di testo: senza, la prima
  // occorrenza di questa frase e' **un commento** sessanta righe prima del
  // codice, e la prova guardava la finestra sbagliata.
  const i = app.indexOf('come hai detto tu`');
  assert.ok(i > 0, 'la frase dei luoghi dichiarati non si trova piu’');
  const riga = rigaDellaTappa;
  assert.match(riga, /senza autostrada/);
  assert.match(riga, /in autostrada/);
});

// ---------------------------------------------------------------------------
// La riga non ripete per sempre quel che un avviso ha detto una volta sola
// ---------------------------------------------------------------------------
//
// Trovato il 22/11/2026 dalla revisione, ed e' il difetto peggiore del ramo.
// La frase «senza autostrada, come hai detto tu» usciva dalla **sola**
// dichiarazione, senza guardare la strada che era stata davvero disegnata. Se
// la strada senza pedaggi non si otteneva, un avviso di passaggio lo diceva --
// e poi, per sempre, la riga diceva «senza autostrada» sopra una riga di costi
// che diceva «🛣️ 4,86 € (54 km)». Due righe attaccate che si smentiscono, e
// quella nella voce del programma, attribuita a chi ha guidato, e' la
// rassicurante.
//
// Un avviso che passa non puo' reggere un'affermazione che la riga ripete a
// ogni apertura. La riga deve dire la verita' da se', e i due dati che le
// servono -- la dichiarazione e i chilometri a pedaggio -- ce li ha gia'
// tutti e due addosso.
test('la frase sull’autostrada guarda anche la strada che e’ stata disegnata', () => {
  const riga = rigaDellaTappa;
  assert.match(riga, /pedaggio_km/,
    'la frase esce dalla sola dichiarazione, senza guardare la strada disegnata');
});

test('quando la strada smentisce la dichiarazione, la riga lo dice', () => {
  const riga = rigaDellaTappa;
  assert.match(riga, /ma la riga ne fa|ma la strada ne fa/,
    'una strada con pedaggi sotto un «niente autostrada» non viene smentita');
});

test('e quando dei pedaggi non si sa niente, non si fa finta di saperlo', () => {
  const riga = rigaDellaTappa;
  assert.match(riga, /non so dire|non lo so/,
    'pedaggi sconosciuti vengono raccontati come una dichiarazione onorata');
});

test('una dichiarazione non si fa sgridare dal confronto coi chilometri', () => {
  // La strada senza pedaggi e' piu' lunga: e' il motivo per cui la si sceglie.
  // Il confronto coi chilometri veri -- che serve quando il programma ha
  // indovinato da solo -- su una strada dichiarata diceva «strada da
  // ridisegnare» subito sotto «senza autostrada, come hai detto tu»: il
  // programma si smentiva da solo nello stesso paragrafo, e consigliava di
  // rifare una cosa appena fatta bene.
  const i = app.indexOf('const stradaSospetta');
  assert.ok(i > 0, 'la regola della strada sospetta non si trova piu’');
  assert.match(app.slice(i, i + 600), /pedaggi_dichiarati/,
    'il confronto coi chilometri sgrida anche una strada dichiarata');
});
