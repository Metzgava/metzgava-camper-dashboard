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
  const riga = app.slice(i - 900, i + 300);
  assert.match(riga, /senza autostrada/);
  assert.match(riga, /in autostrada/);
});
