// Il 17/11/2026 il proprietario ha visto 430 W in uscita dal Bluetti e ha
// spento il 220 per prudenza. Non era un guasto: era un travaso, cioe' il
// caricabatterie del camper che ricaricava le batterie di servizio
// prendendo corrente dall'inverter del Bluetti, senza colonnina attaccata.
//
// Il travaso non e' vietato, ma costa: un quinto dell'energia si perde fra
// inverter e caricatore. E con batterie al litio non cala da se' dopo poco,
// come farebbe il piombo: resta a pieno carico per ore. Quindi va visto.
//
// Queste prove fissano quando l'app deve parlare e quando deve tacere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raggruppa, travasoInCorso, leggiTravaso } from '../src/lib/travaso.js';

const T0 = new Date('2026-11-17T12:30:00Z');
const min = n => new Date(T0.getTime() + n * 60000);

// Come arrivano dal database: una riga per grandezza, scritte nello stesso
// istante ma non al millesimo uguale, le piu' recenti prima.
const righe = (...letture) => letture.flatMap(([quando, uscita, rete]) => [
  { quando, grandezza: 'uscita_ac_w', valore: uscita },
  { quando: new Date(quando.getTime() + 300), grandezza: 'rete_w', valore: rete },
]);

test('raggruppa: due righe scritte nello stesso istante sono una lettura sola', () => {
  const l = raggruppa(righe([min(0), 430, 0]));
  assert.equal(l.length, 1);
  assert.equal(l[0].uscita_ac_w, 430);
  assert.equal(l[0].rete_w, 0);
});

test('raggruppa: letture a un quarto d’ora di distanza restano separate', () => {
  const l = raggruppa(righe([min(15), 430, 0], [min(0), 410, 0]));
  assert.equal(l.length, 2);
});

test('una sola lettura alta non basta: potrebbe essere il bollitore', () => {
  assert.equal(travasoInCorso(raggruppa(righe([min(15), 430, 0]))), null);
});

test('due letture alte di fila senza rete: e’ un travaso', () => {
  const t = travasoInCorso(raggruppa(righe([min(15), 430, 0], [min(0), 410, 0])));
  assert.ok(t, 'ci si aspetta un avviso');
  assert.equal(t.watt, 430);
  assert.equal(t.minuti, 15);
  assert.equal(t.letture, 2);
});

test('con la colonnina attaccata non si avvisa: la corrente la paga la rete', () => {
  const t = travasoInCorso(raggruppa(righe([min(15), 430, 450], [min(0), 410, 430])));
  assert.equal(t, null);
});

test('il conto si ferma alla prima lettura che non e’ un travaso', () => {
  // Mezz'ora di travaso, e prima la quiete: l'avviso parla della mezz'ora,
  // non di tutta la giornata.
  const t = travasoInCorso(raggruppa(righe(
    [min(30), 430, 0], [min(15), 430, 0], [min(0), 5, 0],
  )));
  assert.ok(t);
  assert.equal(t.minuti, 15);
  assert.equal(t.letture, 2);
});

test('l’energia: quel che esce dalla presa, quel che parte dalla batteria, quel che arriva', () => {
  const t = travasoInCorso(raggruppa(righe([min(30), 430, 0], [min(15), 430, 0], [min(0), 430, 0])));
  assert.equal(t.minuti, 30);
  // 430 W per mezz'ora = 215 Wh alla presa
  assert.equal(Math.round(t.wh), 215);
  // dalla batteria ne escono di piu': l'inverter non e' gratis
  assert.ok(t.wh_dalla_batteria > t.wh, 'dalla batteria deve uscire piu’ di quel che arriva alla presa');
  // e alle batterie di servizio ne arriva meno
  assert.ok(t.wh_alle_servizio < t.wh, 'al caricatore si perde ancora qualcosa');
  assert.equal(Math.round(t.persi_wh), Math.round(t.wh_dalla_batteria - t.wh_alle_servizio));
});

test('senza misure non si inventa niente', () => {
  assert.equal(travasoInCorso([]), null);
  assert.equal(travasoInCorso(raggruppa([])), null);
});

test('una uscita piccola non e’ un travaso: e’ un caricatore del telefono', () => {
  assert.equal(travasoInCorso(raggruppa(righe([min(15), 40, 0], [min(0), 35, 0]))), null);
});

test('un travaso vecchio non e’ un travaso in corso: se il cloud e’ caduto, si tace', () => {
  // Due letture alte, ma di tre ore fa: il collegamento e’ caduto subito dopo
  // e nessuno sa piu’ cosa stia facendo l’inverter. Un avviso qui resterebbe
  // appeso per sempre, e direbbe di un fatto finito.
  const vecchie = raggruppa(righe([min(-180), 430, 0], [min(-195), 430, 0]));
  assert.equal(travasoInCorso(vecchie, { ora: T0 }), null);
});

test('la soglia dell’eta’ e’ tre letture: a mezz’ora si parla ancora', () => {
  const t = travasoInCorso(raggruppa(righe([min(-30), 430, 0], [min(-45), 430, 0])), { ora: T0 });
  assert.ok(t, 'mezz’ora fa e’ ancora attuale');
  assert.equal(t.watt, 430);
});

test('leggiTravaso: chiede le tre grandezze giuste e torna il verdetto', async () => {
  let vista = null;
  const q = async (sql, par) => {
    vista = { sql, par };
    return { rows: righe([min(15), 430, 0], [min(0), 410, 0]) };
  };
  const t = await leggiTravaso(q, 'SN123', { ora: min(20) });
  assert.ok(vista.sql.includes('uscita_ac_w'), 'deve chiedere l’uscita 220');
  assert.ok(vista.sql.includes('rete_w'), 'deve chiedere la rete, o non sa distinguere la colonnina');
  assert.deepEqual(vista.par, ['SN123']);
  assert.equal(t.watt, 430);
});

test('leggiTravaso: archivio vuoto, nessun verdetto', async () => {
  const t = await leggiTravaso(async () => ({ rows: [] }), 'SN123');
  assert.equal(t, null);
});
