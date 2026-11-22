// Il tasto che prende il programma nuovo.
//
// Un'app aggiunta alla schermata Home **non si puo' chiudere da sola**: iOS
// non da' nessun modo di farlo, e `window.close()` su una pagina che non ha
// aperto nessuno script non fa niente. Un tasto che dicesse «Chiudi app»
// senza chiudere niente sarebbe la cosa peggiore che questo programma possa
// fare.
//
// Ma chiudere l'app non e' l'obiettivo: l'obiettivo e' **prendere il
// programma nuovo**, e quello un tasto lo fa davvero. Ricaricare rifa' la
// richiesta della pagina, che il server serve senza cache, con dentro
// l'impronta nuova: da li' il programma nuovo si scarica da se'.
//
// Il 22/11/2026 e' successo per la seconda volta: «Ridisegna» nuovo sul
// server, quello di prima in mano, e l'avviso di versione non poteva aiutare
// perche' vive **dentro** il programma nuovo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
// La scheda del programma dentro Impostazioni, delimitata da quel che viene
// dopo invece che da un numero di caratteri.
const scheda = (() => {
  const i = app.indexOf('data-ricarica-programma');
  assert.ok(i > 0, 'in Impostazioni non c’e’ nessun tasto per prendere il programma nuovo');
  return app.slice(Math.max(0, i - 1800), i + 1800);
})();

test('il tasto ricarica davvero, non fa finta', () => {
  assert.match(app, /data-ricarica-programma[\s\S]{0,900}location\.reload/,
    'il tasto non ricarica niente');
});

test('non promette di chiudere l’app, perche’ iOS non lo permette', () => {
  assert.doesNotMatch(scheda, /Chiudi l.{0,3}app|chiudere l.{0,3}app<|window\.close/i,
    'promette di chiudere l’app, che su iPhone non si puo’ fare');
});

test('dice quale versione hai in mano', () => {
  assert.match(scheda, /MIA_VERSIONE/,
    'il tasto c’e’ ma non si vede quale programma si sta usando');
});

test('e dice se ce n’e’ una piu’ nuova sul server', () => {
  // Senza il confronto il numero e' solo un numero: non risponde alla domanda
  // che ci si fa davvero, cioe' «sto usando l'ultimo?».
  assert.match(scheda, /versione[\s\S]{0,400}health|health[\s\S]{0,400}versione/i,
    'la versione si mostra senza chiedere al server quale sta servendo');
});

test('la scheda sta in Impostazioni, dove si va a cercarla', () => {
  // Delimitata dalla sezione che viene dopo, non da un numero di caratteri:
  // la pagina delle Impostazioni e' lunga tredicimila caratteri e cresce.
  const i = app.indexOf('Impostazioni</h1>');
  const fine = app.indexOf('// ---------- Router', i);
  const j = app.indexOf('data-ricarica-programma');
  assert.ok(i > 0 && fine > i, 'non si delimita piu\u2019 la pagina delle Impostazioni');
  assert.ok(j > i && j < fine, 'il tasto non sta nella pagina delle Impostazioni');
});
