// La frase sulla strada ricostruita si legge anche senza mouse.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// La frase c'era, ed era giusta: «Chilometri e orari veri dal tracker. La
// strada sulla mappa e' ricostruita: CarLock non registra il percorso». Ma
// stava in un `title=`, cioe' in un suggerimento che compare passando il
// mouse. **Sull'iPad il mouse non c'e': quella frase non esiste.**
//
// E' la stessa classe di difetto dello zero vecchio della Bluetti, sistemato
// lo stesso giorno nell'altra app: il dato onesto c'era, la pagina lo diceva
// dove non si legge, e la forma ha vinto sulla riga piccola.
//
// L'ospite poi e' l'unico che guarda quella mappa **senza sapere niente di un
// tracker**: la mappa del viaggio e' condivisa, quindi il tratto a punti gli
// arriva da se', ma senza una parola che lo spieghi e' solo una riga strana.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const ospite = readFileSync(new URL('../public/ospite.js', import.meta.url), 'utf8');
// Quel che resta togliendo i suggerimenti: e' quel che si legge su un iPad.
const senzaSuggerimenti = s => s.replace(/title="[^"]*"/g, '');

// La riga della tappa, dove sta il bollino CarLock: e' li' che si guarda per
// capire cos'e' quella tappa, non nel fumetto che si apre toccando la mappa.
// Si delimita per **blocco**, non a tot caratteri: la riga della tappa e' un
// modello lungo quasi duemila caratteri, e una finestra fissa taglia proprio
// dove serve guardare.
const blocco = (testo, dentro, quanti = 3000) => {
  const i = testo.indexOf(dentro);
  assert.ok(i > 0, `non si trova piu: ${dentro}`);
  return testo.slice(Math.max(0, i - 1200), i + quanti);
};
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

test('la frase non vive soltanto in un suggerimento', () => {
  assert.match(senzaSuggerimenti(app), /ricostruit/i,
    'la strada ricostruita si spiega ancora solo passando il mouse');
});

test('la frase sta nella riga della tappa, non solo nel fumetto della mappa', () => {
  // Un fumetto si apre toccando la riga sulla mappa: chi scorre l'elenco
  // delle tappe non lo vede mai. La frase deve stare dove si guarda.
  assert.match(senzaSuggerimenti(rigaDellaTappa), /ricostruit/i,
    'la riga della tappa non dice che la strada e’ ricostruita');
});

test('anche l’ospite la legge', () => {
  assert.match(senzaSuggerimenti(ospite), /ricostruit/i,
    'chi guarda il viaggio da fuori non ha modo di sapere che quella riga non e’ una traccia');
});

test('la frase dice le due cose separate: i numeri veri e la strada dedotta', () => {
  // Confonderle sarebbe peggio che tacere: i chilometri e gli orari sono la
  // parte **misurata**, ed e' quella che da' valore al resto.
  const dove = senzaSuggerimenti(app);
  const i = dove.search(/ricostruit/i);
  const intorno = dove.slice(Math.max(0, i - 300), i + 300);
  assert.match(intorno, /chilometri|km/i,
    'la frase non dice che i chilometri invece sono veri');
});

test('la legenda della mappa distingue la strada ricostruita', () => {
  // La legenda e' sotto la mappa e la guarda anche chi il viaggio lo vede da
  // fuori: se dice «In camper» con un segno pieno mentre la riga e' a punti,
  // il segno e la riga si smentiscono.
  // La prima occorrenza di «In camper» sta nell'elenco dei mezzi, non nella
  // legenda: si cerca la voce della legenda, che ha il suo `data-strato`.
  assert.match(blocco(app, 'data-strato="camper"'), /ricostruit/i,
    'la legenda non dice niente della strada ricostruita');
});

// ---------------------------------------------------------------------------
// La frase non deve parlare di strada ricostruita sotto un aereo
// ---------------------------------------------------------------------------
//
// Trovato dalla revisione del 21/11/2026. `stradaDedotta` guardava solo
// `source === 'carlock'`, mentre la legenda e la polilinea guardavano anche il
// mezzo. Due regole per la stessa cosa -- cioe' quel che la guardia con un
// nome doveva evitare.
//
// Su una tappa del tracker marcata «Traghetto» la riga sulla mappa e' una
// linea fra due punti e i chilometri sono la distanza in linea d'aria, eppure
// sotto la tappa si leggeva «Chilometri e orari veri, strada ricostruita».
// Due affermazioni false in una riga sola.

test('la guardia guarda anche il mezzo, come fanno la legenda e la riga', () => {
  // **24/11/2026:** la guardia si e' spaccata in due -- `daCarlock` dice da
  // dove viene la tappa, `stradaDedotta` aggiunge che la strada e' ancora
  // dedotta. Il mezzo si controlla dove stava, dentro la prima.
  assert.match(app, /const daCarlock = l => l\?\.source === 'carlock' && inCamper\(l\)/,
    'la guardia non guarda il mezzo');
});

test('l’ospite usa la stessa guardia, non una copia scritta a mano', () => {
  // `ospite.js` prende tutto il resto da `app.js`: una condizione ricopiata
  // e' una terza regola che un giorno diverge dalle altre due.
  assert.match(ospite, /stradaDedotta/,
    'la pagina dell’ospite ripete la condizione invece di usare la guardia');
  assert.doesNotMatch(ospite, /l\.source === 'carlock'/,
    'nell’ospite c’e’ ancora una copia della condizione');
});

// ---------------------------------------------------------------------------
// Col tracciato vero, le frasi sui pedaggi parlano di una riga che non c'e'
// ---------------------------------------------------------------------------
//
// Revisione del 24/11/2026. `pedaggio_km` sono i chilometri di autostrada
// **sulla riga calcolata**. Attaccando il tracciato vero quella riga viene
// sostituita, ma il numero resta -- e la frase della tappa lo attribuisce
// alla riga di adesso, che e' la traccia registrata:
//
//   - «Avevi detto senza autostrada, ma la riga ne fa 54 km» su una traccia
//     vera e' un'affermazione precisa su un dato misurato, presa da una
//     supposizione buttata via;
//   - peggio: con «niente autostrada» dichiarato e un `pedaggio_km` vecchio
//     maggiore di zero, la frase dell'autostrada diventava vuota e **la
//     dichiarazione del proprietario spariva dalla riga**. Il disegno
//     promette il contrario: «I luoghi dichiarati restano scritti».
//
// Il numero **non si cancella dal database**: il pedaggio e la sua stima di
// costo non si rifanno attaccando una traccia, ed e' un non-obiettivo del
// disegno. Quel che cambia e' a chi viene attribuito.
const racconto = rigaDellaTappa;

test('su una traccia vera i chilometri di autostrada non si attribuiscono alla riga', () => {
  const m = racconto.match(/const pedKm = ([^;]+);/);
  assert.ok(m, 'il numero dei chilometri di autostrada non si trova piu’');
  assert.match(m[1], /vero/,
    'la riga parla di 54 km di autostrada misurati su una strada che e’ stata sostituita');
});

test('su una traccia vera non si smentisce nessuno con un numero vecchio', () => {
  const m = racconto.match(/const smentita = ([\s\S]*?);\n/);
  assert.ok(m, 'la smentita non si trova piu’');
  assert.match(m[1], /^\s*vero \?/,
    'si dà torto a chi ha guidato citando una strada che il programma ha buttato');
});

test('la dichiarazione del proprietario resta scritta anche sulla traccia vera', () => {
  // Con `pedKm` nullo il ramo del confronto non si apre, e «senza autostrada»
  // torna a comparire. Qui si esegue la condizione vera, coi valori.
  const m = racconto.match(/const autostrada = ([\s\S]*?);\n/);
  assert.ok(m, 'la frase dell’autostrada non si trova piu’');
  const autostrada = new Function('l', 'pedKm', `return (${m[1]});`);
  assert.equal(autostrada({ pedaggi_dichiarati: 'no' }, null), 'senza autostrada',
    'il «niente autostrada» che aveva dichiarato spariva dalla riga');
  assert.equal(autostrada({ pedaggi_dichiarati: 'si' }, null), 'in autostrada');
  // E sulla strada ricostruita il confronto resta: li’ la riga e’ del programma.
  assert.equal(autostrada({ pedaggi_dichiarati: 'no' }, 54), '',
    'sulla ricostruzione il confronto coi chilometri disegnati deve restare');
});

test('la targhetta CarLock non dice «ricostruita» sopra una strada misurata', () => {
  // Due frasi a quaranta pixel di distanza che si contraddicono: la riga dice
  // «strada veri dal tracker», la targhetta sopra «la strada e' ricostruita».
  const i = app.indexOf('CarLock</span>');
  assert.ok(i > 0, 'la targhetta CarLock non si trova piu’');
  const targhetta = app.slice(Math.max(0, i - 400), i);
  assert.match(targhetta, /tracciato_vero|stradaDedotta/,
    'la targhetta continua a dire che la strada e’ una ricostruzione');
});
