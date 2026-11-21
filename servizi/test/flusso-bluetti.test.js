// La stessa figura, per la Bluetti: due ingressi a sinistra (fotovoltaico e
// rete), due uscite a destra (220 V e 12 V), e lei in mezzo con la sua carica.
//
// Rispetto alle Ective cambia una cosa sola, ed e' il motivo di meta' di
// queste prove: **tutti e quattro i numeri sono misurati**. Nessun ramo
// dedotto, nessun bollino di stima. Arrivano dal cloud di Bluetti cosi' come
// sono, e la figura non deve aggiungere incertezza dove non ce n'e'.
//
// La soglia dei cinque watt non e' inventata qui: sta gia' in `app.js` come
// `VERSO_W`, con la sua ragione -- «un apparecchio acceso che non fa niente
// consuma qualche watt, e non e' una scarica». Un ramo che si muove per il
// rumore direbbe che sta succedendo qualcosa quando non succede niente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ramiDellaBluetti, SOGLIA_W } from '../src/lib/flusso.js';

const b = (x = {}) => ({
  carica: 73, fotovoltaico_w: 0, rete_w: 0, uscita_ac_w: 0, uscita_dc_w: 0, ...x,
});
const ramo = (lato, id) => lato.rami.find(r => r.id === id);

test('due rami in entrata e due in uscita, sempre', () => {
  const f = ramiDellaBluetti(b());
  assert.deepEqual(f.entrata.rami.map(r => r.id), ['fotovoltaico', 'rete']);
  assert.deepEqual(f.uscita.rami.map(r => r.id), ['ac', 'dc']);
});

test('porta con se’ la carica, per scriverla al centro', () => {
  assert.equal(ramiDellaBluetti(b({ carica: 73 })).carica, 73);
});

test('nessun ramo della Bluetti e’ dedotto', () => {
  // Li misura tutti il loro cloud: la figura non deve mettere bollini di
  // stima dove non servono.
  const f = ramiDellaBluetti(b({ fotovoltaico_w: 100, uscita_ac_w: 200 }));
  for (const r of [...f.entrata.rami, ...f.uscita.rami]) {
    assert.notEqual(r.certezza, 'dedotto');
  }
});

test('un ramo che porta corrente si muove', () => {
  const f = ramiDellaBluetti(b({ rete_w: 300, uscita_ac_w: 250 }));
  assert.equal(ramo(f.entrata, 'rete').attivo, true);
  assert.equal(ramo(f.uscita, 'ac').attivo, true);
});

test('sotto i cinque watt e’ rumore, non un ramo attivo', () => {
  // Il caso vero: la Bluetti accesa che non fa niente dichiara qualche watt.
  const f = ramiDellaBluetti(b({ uscita_dc_w: SOGLIA_W - 1 }));
  assert.equal(ramo(f.uscita, 'dc').attivo, false);
  assert.equal(ramo(f.uscita, 'dc').watt, SOGLIA_W - 1, 'il numero si scrive comunque');
});

test('i due lati hanno ciascuno la propria scala', () => {
  // Trecento watt in uscita e dieci in entrata: se la scala fosse una sola,
  // il ramo dell'entrata sarebbe un filo invisibile. Ma in entrata quei dieci
  // watt sono tutto quel che entra, e vanno visti.
  const f = ramiDellaBluetti(b({ fotovoltaico_w: 10, uscita_ac_w: 300 }));
  assert.equal(f.entrata.totale, 10);
  assert.equal(f.uscita.totale, 300);
  assert.ok(ramo(f.entrata, 'fotovoltaico').spessore > 6,
    'dieci watt su dieci sono un ramo grosso');
});

test('un valore assente non diventa zero', () => {
  const f = ramiDellaBluetti(b({ fotovoltaico_w: null }));
  const r = ramo(f.entrata, 'fotovoltaico');
  assert.equal(r.watt, null);
  assert.equal(r.ignoto, true);
  assert.equal(r.attivo, false);
});

test('senza Bluetti non c’e’ niente da disegnare', () => {
  assert.equal(ramiDellaBluetti(null), null);
  assert.equal(ramiDellaBluetti(undefined), null);
});

test('ferma del tutto: la figura c’e’, nessun ramo si muove', () => {
  // Come per le Ective: sparire direbbe «non lo so», e invece lo sappiamo --
  // non sta entrando ne' uscendo niente.
  const f = ramiDellaBluetti(b());
  assert.ok(f);
  assert.equal([...f.entrata.rami, ...f.uscita.rami].filter(r => r.attivo).length, 0);
});

test('spessore e velocita’ restano nei limiti con numeri assurdi', () => {
  for (const x of [{ fotovoltaico_w: 1e9 }, { uscita_ac_w: -500 }, { rete_w: Infinity }]) {
    const f = ramiDellaBluetti(b(x));
    for (const r of [...f.entrata.rami, ...f.uscita.rami]) {
      assert.ok(r.spessore >= 2 && r.spessore <= 8, `spessore ${r.spessore}`);
      if (r.secondi != null) assert.ok(r.secondi >= 0.8 && r.secondi <= 3, `secondi ${r.secondi}`);
    }
  }
});

test('una potenza negativa non e’ un ramo attivo', () => {
  assert.equal(ramo(ramiDellaBluetti(b({ uscita_ac_w: -200 })).uscita, 'ac').attivo, false);
});

// ---------------------------------------------------------------------------
// Quando gli zeri vecchi sono stati togliuti
// ---------------------------------------------------------------------------
//
// Disegno: docs/superpowers/specs/2026-11-21-zero-vecchio-design.md
//
// Oltre cinque minuti `bluetti.js` porta a `null` le potenze che valevano
// zero: uno zero che ha saltato cinque letture non lo conosciamo piu'. Qui si
// chiude l'anello -- la figura deve disegnarli **ignoti**, cioe' lo stato che
// sapeva gia' fare, e non spenti.
//
// La differenza si vede e conta: un ramo spento dice «qui non passa niente»,
// un ramo ignoto dice «non lo so». Il 19 e il 21/11/2026 la Bluetti erogava
// quattrocento watt e la figura mostrava rami spenti.

test('potenze a «non so»: i rami sono IGNOTI, non spenti', () => {
  const f = ramiDellaBluetti(b({ carica: 100, fotovoltaico_w: null, rete_w: null,
                                 uscita_ac_w: null, uscita_dc_w: null }));
  for (const lato of [f.entrata, f.uscita]) {
    for (const r of lato.rami) {
      assert.equal(r.ignoto, true, `${r.id} non e’ ignoto`);
      assert.equal(r.attivo, false);
      assert.equal(r.watt, null, `${r.id} ha un numero che non dovrebbe avere`);
    }
  }
  // E la carica resta: la regola degli zeri vecchi non la tocca, perche' uno
  // zero di carica non e' un caso reale sulla Bluetti.
  assert.equal(f.carica, 100);
});

test('uno zero conosciuto resta un ramo SPENTO, non ignoto', () => {
  // La distinzione e' tutta qui, e deve reggere nei due versi.
  const f = ramiDellaBluetti(b({ carica: 100, fotovoltaico_w: 0, rete_w: 0,
                                 uscita_ac_w: 0, uscita_dc_w: 0 }));
  for (const lato of [f.entrata, f.uscita]) {
    for (const r of lato.rami) {
      assert.notEqual(r.ignoto, true, `${r.id} e’ ignoto e invece lo sappiamo`);
      assert.equal(r.attivo, false);
      assert.equal(r.watt, 0);
    }
  }
});
