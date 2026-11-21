// Le due serie delle uscite, nel tempo.
//
// Disegno: docs/superpowers/specs/2026-11-21-storia-uscite-design.md
//
// Il fatto che decide la forma di tutto: **le righe non hanno mai lo stesso
// istante**. Si scrivono una per volta, quindi `uscita_ac_w` e `uscita_dc_w`
// della stessa lettura distano millisecondi, e le due Ective distano secondi.
// Sommare per istante esatto non da' niente. Si raggruppa per intervalli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serieUscite, passoDelGrafico } from '../src/lib/storico.js';

const T = (min, s = 0) => new Date(Date.UTC(2026, 10, 21, 0, min, s)).toISOString();
const r = (quando, apparecchio, grandezza, valore) => ({ quando, apparecchio, grandezza, valore });
const DA = T(0), A = T(60);
const fai = (righe, extra = {}) =>
  serieUscite(righe, { da: DA, a: A, passo: 10, batterie: ['NWJ1', 'NWJ2'], ...extra });

// ---------- il passo ----------

test('il passo cresce col periodo, e resta su valori tondi', () => {
  const uno = passoDelGrafico(1), sette = passoDelGrafico(7), novanta = passoDelGrafico(90);
  assert.ok(uno < sette && sette < novanta, `${uno} ${sette} ${novanta}`);
  for (const p of [uno, sette, novanta]) {
    assert.ok([5, 15, 30, 60, 120, 240, 360, 720, 1440].includes(p), `passo strano: ${p}`);
  }
});

test('nessun periodo fa piu’ di qualche centinaio di punti', () => {
  // Un grafico con piu' punti che pixel non e' piu' preciso, e' solo piu'
  // lento da disegnare su un telefono.
  for (const g of [1, 3, 7, 30, 90, 180]) {
    assert.ok(g * 24 * 60 / passoDelGrafico(g) <= 400, `${g} giorni fanno troppi punti`);
  }
});

// ---------- la Bluetti ----------

test('la 220 e la 12 V della stessa lettura si ritrovano nello stesso intervallo', () => {
  // E' il punto: due righe scritte a mezzo secondo di distanza.
  const s = fai([
    r(T(2, 0), 'EL300', 'uscita_ac_w', 300),
    r(T(2, 1), 'EL300', 'uscita_dc_w', 40),
  ]);
  const p = s.bluetti.punti.find(x => x.ac != null);
  assert.equal(p.ac, 300);
  assert.equal(p.dc, 40);
  assert.equal(p.tot, 340);
});

test('dentro l’intervallo si fa la media, non il massimo', () => {
  // La media e' l'energia diviso il tempo: e' l'unica che rende coerenti il
  // grafico e i kWh scritti sotto.
  const s = fai([
    r(T(1), 'EL300', 'uscita_ac_w', 100),
    r(T(5), 'EL300', 'uscita_ac_w', 300),
  ]);
  assert.equal(s.bluetti.punti.find(x => x.ac != null).ac, 200);
});

test('i kWh sono i watt medi per il tempo, e il periodo e’ tutto', () => {
  // Sei intervalli da dieci minuti a 600 W = 0,6 kWh in un'ora.
  const righe = [];
  for (let m = 1; m < 60; m += 10) righe.push(r(T(m), 'EL300', 'uscita_ac_w', 600));
  const s = fai(righe);
  assert.ok(Math.abs(s.bluetti.kwh - 0.6) < 0.001, `kwh = ${s.bluetti.kwh}`);
});

test('un buco non si attraversa, e nei kWh non conta', () => {
  // Una riga dritta sopra mezz'ora di silenzio e' la bugia piu' facile da
  // disegnare e la piu' difficile da accorgersene.
  const s = fai([
    r(T(1), 'EL300', 'uscita_ac_w', 600),
    r(T(51), 'EL300', 'uscita_ac_w', 600),
  ]);
  const vuoti = s.bluetti.punti.filter(x => x.tot == null);
  assert.equal(vuoti.length, 4, 'quattro intervalli senza letture');
  // Due intervalli da dieci minuti a 600 W, non un'ora intera.
  assert.ok(Math.abs(s.bluetti.kwh - 0.2) < 0.001, `kwh = ${s.bluetti.kwh}`);
});

test('il picco e’ il massimo di un intervallo, e si sa di che larghezza', () => {
  const s = fai([
    r(T(1), 'EL300', 'uscita_ac_w', 100),
    r(T(21), 'EL300', 'uscita_ac_w', 900),
  ]);
  assert.equal(s.bluetti.picco_w, 900);
  assert.equal(s.passo_minuti, 10);
});

test('due Bluetti si sommano, non si mediano fra loro', () => {
  // Non ce n'e' due oggi. Ma mediare due apparecchi diversi darebbe meta'
  // dell'uscita vera, ed e' l'errore ottimista.
  const s = fai([
    r(T(1), 'EL300', 'uscita_ac_w', 200),
    r(T(2), 'ALTRA', 'uscita_ac_w', 100),
  ]);
  assert.equal(s.bluetti.punti.find(x => x.ac != null).ac, 300);
});

// ---------- le Ective ----------

test('il netto del pacco: quel che esce, non la somma delle negative', () => {
  // Stessa regola del vivo: +3 A da una parte e il resto dall'altra vogliono
  // dire che esce la differenza.
  const s = fai([
    r(T(1), 'NWJ1', 'watt', 40),
    r(T(2), 'NWJ2', 'watt', -340),
  ]);
  assert.equal(s.ective.punti.find(x => x.watt != null).watt, 300);
});

test('in carica non esce niente: zero, e lo zero non e’ un buco', () => {
  const s = fai([
    r(T(1), 'NWJ1', 'watt', 150),
    r(T(2), 'NWJ2', 'watt', 120),
  ]);
  const p = s.ective.punti.find(x => x.watt != null);
  assert.equal(p.watt, 0);
});

test('se in un intervallo ha parlato una batteria sola, quell’intervallo e’ un buco', () => {
  // Mezzo pacco spacciato per il pacco intero e' un consumo dimezzato: e'
  // l'errore ottimista, lo stesso gia' scansato nel vivo.
  const s = fai([r(T(1), 'NWJ1', 'watt', -200)]);
  assert.equal(s.ective.punti.every(x => x.watt == null), true);
  assert.equal(s.ective.kwh, 0);
});

test('chi non e’ una batteria non entra nel pacco, anche se manda watt', () => {
  const s = fai([
    r(T(1), 'NWJ1', 'watt', -100),
    r(T(1), 'NWJ2', 'watt', -100),
    r(T(1), 'SmartSolar', 'watt', 500),
  ]);
  assert.equal(s.ective.punti.find(x => x.watt != null).watt, 200);
});

test('senza batterie conosciute non si inventa una serie', () => {
  const s = fai([r(T(1), 'NWJ1', 'watt', -100)], { batterie: [] });
  assert.equal(s.ective, null);
});

// ---------- le due serie insieme ----------

test('i due lati hanno gli stessi intervalli, cosi’ si confrontano', () => {
  const s = fai([
    r(T(1), 'EL300', 'uscita_ac_w', 100),
    r(T(31), 'NWJ1', 'watt', -50), r(T(31), 'NWJ2', 'watt', -50),
  ]);
  assert.equal(s.bluetti.punti.length, s.ective.punti.length);
  assert.equal(s.bluetti.punti[0].t, s.ective.punti[0].t);
  assert.equal(s.bluetti.punti.length, 6);
});

test('niente letture: le serie ci sono, vuote, e i totali sono zero', () => {
  // La sezione non sparisce: spiega. Sparire direbbe «non hai storico».
  const s = fai([]);
  assert.equal(s.bluetti.punti.length, 6);
  assert.equal(s.bluetti.punti.every(x => x.tot == null), true);
  assert.equal(s.bluetti.kwh, 0);
  assert.equal(s.bluetti.picco_w, null);
});

test('una riga fuori dal periodo non entra', () => {
  const s = fai([r(T(-5), 'EL300', 'uscita_ac_w', 999)]);
  assert.equal(s.bluetti.punti.every(x => x.tot == null), true);
});

test('una grandezza che non c’entra si ignora', () => {
  const s = fai([r(T(1), 'EL300', 'carica', 88)]);
  assert.equal(s.bluetti.punti.every(x => x.tot == null), true);
});

// ---------- il difetto del 21/11: il netto si annulla da solo ----------

test('notte che scarica e giorno che carica non si annullano a vicenda', () => {
  // Trovato guardando i numeri veri, non le prove: a novanta giorni l'uscita
  // delle Ective crollava a un quindicesimo di quella di trenta giorni.
  //
  // La causa e' il metodo. Con un intervallo da dodici ore, la media del
  // **netto** mette insieme la notte che scarica e il giorno che carica: i due
  // si annullano, e `max(0, -netto)` di quasi zero e' quasi zero. Il consumo
  // della notte sparisce.
  //
  // Il taglio va fatto **prima** della media: si guarda il verso su intervalli
  // corti, e si mediano i risultati -- non si media il verso.
  const da = new Date(Date.UTC(2026, 10, 21, 0, 0)).toISOString();
  const a = new Date(Date.UTC(2026, 10, 21, 12, 0)).toISOString();
  const righe = [];
  // Sei ore a -100 W per batteria (escono 200 W), poi sei ore a +100 W.
  for (let m = 0; m < 720; m += 10) {
    const w = m < 360 ? -100 : 100;
    const q = new Date(Date.UTC(2026, 10, 21, 0, m)).toISOString();
    righe.push(r(q, 'NWJ1', 'watt', w), r(q, 'NWJ2', 'watt', w));
  }
  // Un intervallo solo da dodici ore: e' il caso dei novanta giorni.
  const s = serieUscite(righe, { da, a, passo: 720, batterie: ['NWJ1', 'NWJ2'] });
  // Sei ore a 200 W = 1,2 kWh usciti. Non zero.
  assert.ok(Math.abs(s.ective.kwh - 1.2) < 0.05, `kwh = ${s.ective.kwh}`);
  // E il punto del grafico e' la media di quel che esce: 200 W per meta' del
  // tempo fanno 100 W medi.
  assert.ok(Math.abs(s.ective.punti[0].watt - 100) < 5, `watt = ${s.ective.punti[0].watt}`);
});

test('anche con un intervallo lungo, un buco resta un buco', () => {
  const da = new Date(Date.UTC(2026, 10, 21, 0, 0)).toISOString();
  const a = new Date(Date.UTC(2026, 10, 21, 12, 0)).toISOString();
  const s = serieUscite([], { da, a, passo: 720, batterie: ['NWJ1', 'NWJ2'] });
  assert.equal(s.ective.punti[0].watt, null);
  assert.equal(s.ective.kwh, 0);
});

test('i kWh della Bluetti non cambiano per via del doppio raggruppamento', () => {
  // La Bluetti non ha il problema del verso -- le sue uscite sono sempre
  // positive -- ma passa dalla stessa macchina, e il totale deve restare lo
  // stesso.
  const da = new Date(Date.UTC(2026, 10, 21, 0, 0)).toISOString();
  const a = new Date(Date.UTC(2026, 10, 21, 12, 0)).toISOString();
  const righe = [];
  for (let m = 0; m < 720; m += 15) {
    righe.push(r(new Date(Date.UTC(2026, 10, 21, 0, m)).toISOString(), 'EL300', 'uscita_ac_w', 400));
  }
  const s = serieUscite(righe, { da, a, passo: 720, batterie: [] });
  // Dodici ore a 400 W = 4,8 kWh.
  assert.ok(Math.abs(s.bluetti.kwh - 4.8) < 0.05, `kwh = ${s.bluetti.kwh}`);
});
