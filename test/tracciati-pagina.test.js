// Il tasto dei tracciati, e la strada che smette di essere dedotta.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// Il puntinato sulla mappa vuol dire «questa strada e' una ricostruzione».
// Con il tracciato vero non lo e' piu', e lasciarlo direbbe il falso nella
// direzione prudente -- ma pur sempre il falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const fra = (ancora, quanti) => {
  const i = app.indexOf(ancora);
  assert.ok(i > 0, `non si trova piu’: ${ancora}`);
  return app.slice(i, i + quanti);
};

test('nella scheda Tappe c’e’ il tasto dei tracciati', () => {
  assert.match(fra('<h2>Tappe</h2>', 1400), /id="tracciati"/,
    'non c’e’ modo di caricare i tracciati veri');
});

// Il riquadro e quel che fa, presi da dove il tasto viene agganciato: il
// tasto sta nella scheda Tappe, il riquadro mille righe piu’ in là.
const riquadro = fra("$('#tracciati')?.addEventListener", 3400);

test('il riquadro dice che guarda solo i giorni del viaggio', () => {
  assert.match(riquadro, /giorni di questo viaggio|periodo di questo viaggio/i,
    'non si capisce che il resto del file viene ignorato');
});

test('una tappa col tracciato vero non si disegna piu’ puntinata', () => {
  const i = app.indexOf('const stradaDedotta');
  assert.ok(i > 0, 'la regola del puntinato non si trova piu’');
  assert.match(app.slice(i, i + 320), /tracciato_vero/,
    'il puntinato resta su una strada che non e’ piu’ dedotta');
});

// Il blocco che racconta la riga della tappa, preso dal suo inizio: una
// finestra contata a ritroso da una frase in mezzo taglia via il pezzo che
// decide, ed e’ proprio quello che si vuole provare.
const racconto = (() => {
  const i = app.indexOf('daCarlock(l) ? (() => {');
  assert.ok(i > 0, 'il racconto della riga non si trova piu’');
  return app.slice(i, i + 3400);
})();

test('la riga della tappa dice che la strada e’ vera', () => {
  assert.match(racconto, /tracciato_vero/, 'la riga racconta ancora una ricostruzione');
  assert.match(racconto, /strada veri|strada vera|percorsa davvero/i);
});

test('su una traccia vera, un luogo non toccato non e’ un ridisegno fallito', () => {
  // Oggi la frase dice «il ridisegno non e' riuscito, riprova da Modifica»:
  // su un tracciato vero e' falso, non c'e' niente da ridisegnare. E' la
  // traccia che smentisce quel che era stato dichiarato, ed e' un fatto.
  assert.match(racconto, /La strada percorsa non passa per/,
    'con la traccia vera si continua a dire che il ridisegno non e’ riuscito');
});

test('il resoconto si legge, compreso quel che e’ rimasto fuori', () => {
  for (const campo of ['attaccati', 'senza_traccia', 'capi_lontani'])
    assert.match(riquadro, new RegExp(campo), `il resoconto non legge ${campo}`);
});

// ---------------------------------------------------------------------------
// Su un tracciato vero non si consiglia di ridisegnare
// ---------------------------------------------------------------------------
//
// Trovato guardando la pagina, il 24/11/2026: la riga diceva «Chilometri,
// orari e strada veri dal tracker» e subito dopo «la strada ricostruita non e'
// quella percorsa -- prova Ridisegna».
//
// Il confronto fra la lunghezza della riga e i chilometri veri e' un indizio
// che serve **quando la strada l'ha scelta il programma**. Con la traccia vera
// non c'e' niente da ridisegnare, e premere quel tasto sostituirebbe la verita'
// con una supposizione. E' la stessa regola gia' applicata ai pedaggi
// dichiarati: dove c'e' un fatto, l'indizio si fa da parte.
test('il confronto coi chilometri non sgrida una strada vera', () => {
  const i = app.indexOf('const stradaSospetta');
  assert.ok(i > 0, 'la regola della strada sospetta non si trova piu’');
  assert.match(app.slice(i, i + 700), /tracciato_vero/,
    'su un tracciato vero si continua a consigliare di ridisegnare');
});
