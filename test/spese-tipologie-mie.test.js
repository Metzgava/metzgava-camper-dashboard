// Le tipologie di spesa che se le aggiunge lui.
//
// Chiesto il 24/11/2026: «e lasciami inserire nuove tipologie di spesa».
// Fino a oggi l'elenco veniva dalle impostazioni ma non c'era **nessun posto**
// dove modificarlo: si aggiungevano a mano nel programma, cioe' chiedendole a
// me.
//
// Due cose stanno insieme: la chiave (che finisce nel database, su ogni spesa
// scritta) e come si mostra (simbolo e nome). Se arrivasse solo la chiave, la
// sua categoria comparirebbe come `cose_strane` in ogni grafico, perche' il
// nome leggibile sta nella mappa del programma.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chiaveCategoria, categoriaNuova } from '../src/lib/categorie.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const rotte = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');

test('la chiave nasce dal nome, leggibile e stabile', () => {
  // Finisce nel database su ogni spesa scritta: deve restare la stessa se
  // domani lui riscrive il nome con un accento diverso.
  assert.equal(chiaveCategoria('Lavanderia'), 'lavanderia');
  assert.equal(chiaveCategoria('Gas e bombole'), 'gas_e_bombole');
  assert.equal(chiaveCategoria('  Città  '), 'citta');
  assert.equal(chiaveCategoria('Pedaggi!!'), 'pedaggi');
});

test('un nome che non da’ nessuna chiave si rifiuta', () => {
  // «???» diventerebbe una chiave vuota, e una spesa con la categoria vuota
  // non si ritrova piu'.
  assert.equal(chiaveCategoria('???'), null);
  assert.equal(chiaveCategoria(''), null);
  assert.equal(chiaveCategoria(null), null);
});

test('una tipologia nuova porta chiave, simbolo e nome', () => {
  const r = categoriaNuova('Lavanderia', '🧺', { categories: ['altro'], categorie_mie: {} });
  assert.equal(r.chiave, 'lavanderia');
  assert.deepEqual(r.mie.lavanderia, ['🧺', 'Lavanderia']);
  assert.deepEqual(r.elenco, ['altro', 'lavanderia'], 'la nuova va in coda');
});

test('senza simbolo se ne mette uno, invece di lasciare un buco', () => {
  const r = categoriaNuova('Lavanderia', '', { categories: [], categorie_mie: {} });
  assert.ok(r.mie.lavanderia[0], 'la categoria resterebbe senza simbolo in ogni elenco');
});

test('un simbolo si tiene corto: e’ un’icona, non una frase', () => {
  const r = categoriaNuova('Lavanderia', 'una lavatrice grande', { categories: [], categorie_mie: {} });
  assert.ok([...r.mie.lavanderia[0]].length <= 2, `simbolo di ${r.mie.lavanderia[0].length} caratteri`);
});

test('una tipologia che c’e’ gia’ non si duplica', () => {
  // Ne' fra le sue, ne' fra quelle del programma: «Gasolio» battuto a mano
  // non deve diventare una seconda voce accanto a quella vera.
  const r = categoriaNuova('Lavanderia', '🧺',
    { categories: ['lavanderia'], categorie_mie: { lavanderia: ['🧺', 'Lavanderia'] } });
  assert.equal(r.gia, true);
  assert.deepEqual(r.elenco, ['lavanderia'], 'la chiave e’ comparsa due volte nell’elenco');
});

test('non si puo’ ribattezzare una categoria del programma', () => {
  // `gasolio` ha un significato nel codice -- la stima automatica lo cerca per
  // nome -- e lasciargli cambiare simbolo e nome da qui sarebbe darle un
  // doppio senso.
  const r = categoriaNuova('Gasolio', '⛽', { categories: ['gasolio'], categorie_mie: {} });
  assert.equal(r.gia, true);
  assert.deepEqual(r.mie, {}, 'una categoria del programma e’ stata riscritta dalle sue');
});

test('la pagina assorbe le sue dentro la mappa delle categorie', () => {
  // Cosi' simbolo, nome e colore funzionano in ogni grafico, filtro e
  // riquadro senza toccarli uno per uno. In **coda**, come le categorie nuove
  // del programma: il colore viene dalla posizione.
  assert.match(app, /Object\.assign\(CAT,[^)]*categorie_mie/,
    'le sue categorie non entrano nella mappa: comparirebbero come chiavi grezze');
});

test('il riquadro della spesa ha la voce per aggiungerne una', () => {
  const i = app.indexOf('function expenseForm');
  assert.ok(i > 0, 'il riquadro della spesa non si trova piu’');
  assert.match(app.slice(i, i + 2600), /__nuova__/,
    'nel menu delle categorie non c’e’ modo di aggiungerne una');
});

test('la rotta che la salva esiste, e salva le due cose insieme', () => {
  const i = rotte.indexOf("'/settings/categorie'");
  assert.ok(i > 0, 'non c’e’ una rotta per salvare le tipologie');
  const r = rotte.slice(i, i + 1200);
  assert.match(r, /categorie_mie/, 'si salva la chiave senza come si mostra');
  assert.match(r, /categoriaNuova\(/, 'la rotta decide da se’ invece di usare la regola provata');
});

test('un errore dal server porta appresso il suo corpo, non solo la frase', () => {
  // Il server, quando la tipologia c'era gia', manda anche **quale** e': con
  // quello la tendina si posiziona su quella giusta invece di lasciare l'utente
  // su «Nuova tipologia…» con un messaggio e nient'altro. Prima `api()`
  // teneva solo `data.error` e quel dato si perdeva.
  const i = app.indexOf('async function api(');
  assert.ok(i > 0, 'la funzione che chiama il server non si trova piu’');
  assert.match(app.slice(i, i + 900), /\.dati = data/,
    'il corpo dell’errore si butta: un dato utile mandato dal server non arriva a chi chiama');
});
