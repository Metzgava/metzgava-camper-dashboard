// `/api/health` deve dire anche **quale codice** sta girando.
//
// `versione` e' l'impronta dei file di `public/`: cambia quando cambia una
// pagina, e **non cambia** quando la modifica tocca solo il server. Il
// 24/11/2026 si e' pubblicata una modifica al solo server -- la registrazione
// delle avarie del cloud -- e non c'era modo di verificare da fuori che fosse
// davvero arrivata.
//
// Railway mette il commit in `RAILWAY_GIT_COMMIT_SHA`. Sette caratteri bastano
// a riconoscerlo, e in locale non c'e': li' resta `null`, che e' la verita'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const health = (() => {
  const i = server.indexOf("'/api/health'");
  assert.ok(i > 0, 'la rotta della salute non si trova piu’');
  // Anche un pezzo **prima**: la costante col commit si legge una volta sola,
  // sopra la rotta, invece di rileggere l’ambiente a ogni richiesta.
  return server.slice(Math.max(0, i - 700), i + 320);
})();

test('la salute dice il commit, oltre all’impronta delle pagine', () => {
  assert.match(health, /RAILWAY_GIT_COMMIT_SHA/,
    'una modifica al solo server resta invisibile da fuori');
  assert.match(health, /versione/, 'l’impronta delle pagine non si e’ persa');
});

test('in locale, dove il commit non c’e’, non si inventa niente', () => {
  // `null` vuol dire «non lo so», ed e' giusto: in locale non si costruisce
  // da un commit. Una stringa vuota o uno «sconosciuto» sembrerebbero un dato.
  assert.match(health, /\|\| null|\?\? null/,
    'senza la variabile si finirebbe per scrivere qualcosa che non e’ un commit');
});
