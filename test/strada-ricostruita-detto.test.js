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
// L'ancora e' qualcosa di **unico** di questa riga: `badge ok` compare anche
// altrove nel file, a centotrentasettemila caratteri di distanza, e ancorarsi
// li' significava guardare un pezzo di pagina che non c'entra.
const rigaDellaTappa = blocco(app, 'strada da ridisegnare');

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
