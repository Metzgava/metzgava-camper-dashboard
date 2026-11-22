// Una connessione ferma che scade non deve far morire il programma.
//
// Trovato il 22/11/2026 pubblicando: nel registro del server, due morti su
// cinque avvii.
//
//   Error: read ETIMEDOUT
//   Emitted 'error' event on BoundPool instance
//
// Il database di produzione sta su Railway e ci si arriva dal proxy pubblico,
// che chiude le connessioni ferme. `pg` lo segnala emettendo un evento
// `error` sulla **riserva** di connessioni; se nessuno lo ascolta, Node
// considera l'errore non gestito e **abbatte il processo intero**.
//
// launchd lo riaccende, quindi dal di fuori sembra che non succeda niente --
// ma per qualche secondo l'app non c'e', e chi stava salvando una tappa si
// prende un errore senza capire perche'. Ascoltare quell'evento basta: la
// riserva butta la connessione morta e tira avanti con le altre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');

test('qualcuno ascolta gli errori della riserva di connessioni', () => {
  assert.match(db, /pool\.on\(\s*'error'/,
    'nessuno ascolta: una connessione scaduta abbatte il programma');
});

test('l’errore si scrive, non si ingoia in silenzio', () => {
  const i = db.search(/pool\.on\(\s*'error'/);
  const blocco = db.slice(i, i + 400);
  assert.match(blocco, /console\.(warn|error)/,
    'un errore ingoiato senza una riga nel registro e’ un guasto che non si trova piu’');
});
