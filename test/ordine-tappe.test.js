// Rimettere le tappe in fila per data e ora.
//
// La regola c'era gia', ma viveva **dentro** l'import di CarLock come una
// `ORDER BY` in mezzo a una rotta: si poteva subire, non chiedere. E nessuna
// prova la eseguiva.
//
// L'ordine di una tappa e' un numero a parte (`position`), e **non** si
// ricalcola quando si corregge una data: per questo una tappa puo' avere la
// data giusta e stare lo stesso nel posto sbagliato dentro «Rivedi il
// percorso». Chi se ne accorge deve poterlo rimettere a posto in un colpo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordineDelleTappe } from '../src/lib/tappe.js';

const t = (id, date, start_time, position) => ({ id, date, start_time, position });

test('le tappe vanno in fila per data', () => {
  const ordine = ordineDelleTappe([
    t(3, '2026-10-05', null, 1), t(1, '2026-10-01', null, 2), t(2, '2026-10-03', null, 3),
  ]);
  assert.deepEqual(ordine, [1, 2, 3]);
});

test('nello stesso giorno comanda l’orario di partenza', () => {
  const ordine = ordineDelleTappe([
    t(2, '2026-10-01', '14:30', 1), t(1, '2026-10-01', '08:15', 2),
  ]);
  assert.deepEqual(ordine, [1, 2]);
});

test('a parita’ di data e ora non si tocca niente: li’ l’ordine lo sai solo tu', () => {
  // Due tratti nello stesso momento li ha messi in fila una persona, e
  // riordinarli a caso sarebbe buttare via l'unica informazione che c'e'.
  const ordine = ordineDelleTappe([
    t(7, '2026-10-01', '09:00', 1), t(4, '2026-10-01', '09:00', 2), t(9, '2026-10-01', '09:00', 3),
  ]);
  assert.deepEqual(ordine, [7, 4, 9]);
});

test('una tappa senza data va in fondo, non in cima', () => {
  // Una data che manca non e' «il primo gennaio»: e' «non so quando».
  // Metterla all'inizio direbbe una cosa che nessuno ha detto.
  const ordine = ordineDelleTappe([
    t(2, null, null, 1), t(1, '2026-10-01', null, 2),
  ]);
  assert.deepEqual(ordine, [1, 2]);
});

test('e un orario che manca va dopo quelli che ci sono, nello stesso giorno', () => {
  const ordine = ordineDelleTappe([
    t(2, '2026-10-01', null, 1), t(1, '2026-10-01', '07:00', 2),
  ]);
  assert.deepEqual(ordine, [1, 2]);
});

test('le date arrivano dal database come oggetti, non come testo', () => {
  // `pg` restituisce una colonna DATE come Date: letta come stringa diventa
  // «Thu Oct 01 2026 …», e l'ordine alfabetico di quei nomi non e' l'ordine
  // dei giorni -- «Thu» viene prima di «Wed» qualunque sia la settimana.
  const ordine = ordineDelleTappe([
    t(2, new Date('2026-10-07T00:00:00Z'), null, 1),
    t(1, new Date('2026-10-01T00:00:00Z'), null, 2),
  ]);
  assert.deepEqual(ordine, [1, 2]);
});

test('senza tappe non si inventa niente', () => {
  assert.deepEqual(ordineDelleTappe([]), []);
  assert.deepEqual(ordineDelleTappe(null), []);
});

// ---------------------------------------------------------------------------
// Il cablaggio: una regola sola, e un tasto per chiederla
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
const rotta = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('c’e’ una rotta per rimettere in ordine un viaggio', () => {
  assert.match(rotta, /router\.post\('\/trips\/:id\/riordina'/,
    'l’ordine si puo’ ancora solo subire, non chiedere');
});

test('l’import di CarLock e il tasto usano la stessa regola', () => {
  // Due copie della stessa regola un giorno divergono, e il giorno dopo due
  // strade diverse riordinano lo stesso viaggio in due modi. Quindi: la
  // regola si applica in **un** posto solo, e chi la vuole lo chiama.
  // Quel che conta non e' **quante volte** si applica, ma che non ne esistano
  // copie: una regola scritta due volte un giorno diverge, e il giorno dopo
  // due strade riordinano lo stesso viaggio in due modi.
  assert.doesNotMatch(rotta, /ORDER BY date NULLS LAST/,
    'da qualche parte l’ordine e’ ancora riscritto in SQL');
  const chiamanti = (rotta.match(/rimettiInOrdine\(/g) || []).length;
  assert.ok(chiamanti >= 3, `solo ${chiamanti - 1} rotte la chiedono: l’altra ha la sua copia`);
});

test('il tasto c’e’, dice cosa fa, e chiede conferma', () => {
  assert.match(app, /data-riordina|id="riordina"/, 'nessun tasto per rimettere in ordine');
  const i = app.search(/data-riordina|id="riordina"/);
  const intorno = app.slice(Math.max(0, i - 600), i + 2600);
  assert.match(intorno, /ordine/i);
});

test('dopo il riordino si dice quante tappe si sono mosse', () => {
  // Zero spostate e' una risposta: vuol dire che erano gia' in ordine, e
  // merita di essere detta invece di lasciar credere che non sia successo
  // niente.
  assert.match(rotta, /spostate/, 'la rotta non dice quante tappe ha mosso');
  assert.match(app, /spostate/, 'la pagina non legge quante tappe si sono mosse');
});
