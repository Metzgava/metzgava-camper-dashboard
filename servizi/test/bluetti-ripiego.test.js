// Quando il cloud Bluetti rifiuta il permesso, la pagina non deve perdere il
// manometro: l'ultima lettura buona e' in archivio, e mostrarla con la sua
// eta' e' meglio di un errore rosso.
//
// E' il guasto che il proprietario ha visto tre volte il 16/11 e due il 17:
// non il collegamento perso — quello e' corretto — ma la pagina che si
// svuotava per un rifiuto passeggero del loro cloud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivio } from './aiuto/archivio-finto.js';

const RIFIUTO = JSON.stringify({ msgCode: 805, message: 'login scaduto (finto)' });
const resp = c => ({ ok: true, status: 200, text: async () => c, json: async () => JSON.parse(c) });

function cloudCheRifiuta() {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth2/token')) {
      return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
    }
    return resp(RIFIUTO);
  };
}

const GETTONI = [['SELECT nome, valore, scade, aggiornato FROM gettoni_cloud', [
  { nome: 'bluetti_accesso', valore: 'ACCESSO', scade: null, aggiornato: new Date(Date.now() - 20 * 60000) },
  { nome: 'bluetti_rinnovo', valore: 'RINNOVO', scade: null, aggiornato: new Date(Date.now() - 20 * 60000) },
]]];

test('rifiutato dal cloud, ma in archivio c’e’ una lettura: si mostra quella con la sua eta’', async () => {
  cloudCheRifiuta();
  archivio([
    ...GETTONI,
    ["FROM istantanee WHERE fonte='bluetti'", [
      { apparecchio: 'SN1', dati: { nome: 'AC180', sn: 'SN1', carica: 72, uscita_ac_w: 140 },
        quando: new Date(Date.now() - 14 * 60000) },
    ]],
  ]);
  const { statoBluetti } = await import('../src/lib/bluetti.js');
  const s = await statoBluetti({ fresco: true });

  assert.equal(s.collegato, true);
  // Il manometro vive di `apparecchi`: se non ci sono, la pagina si svuota.
  assert.equal(s.apparecchi?.length, 1);
  assert.equal(s.apparecchi[0].carica, 72);
  // E deve dire che e' vecchia, senza mentire sul fatto che sia di adesso.
  assert.equal(s.vecchia, true);
  assert.ok(s.minuti >= 13 && s.minuti <= 16, `minuti=${s.minuti}`);
  // `errore` svuota la scheda nella pagina: qui non ci va.
  assert.equal(s.errore, undefined);
  assert.ok(s.avviso && /rifiuta/i.test(s.avviso), `avviso=${s.avviso}`);
});

test('senza niente in archivio, l’errore resta un errore', async () => {
  cloudCheRifiuta();
  archivio([...GETTONI]);                       // nessuna istantanea
  const { statoBluetti } = await import('../src/lib/bluetti.js');
  const s = await statoBluetti({ fresco: true });
  assert.equal(s.collegato, true);
  assert.ok(s.errore && /rifiuta/i.test(s.errore), `errore=${s.errore}`);
  assert.equal(s.apparecchi, undefined);
});

test('una lettura di ripiego NON si riscrive in archivio come se fosse fresca', async () => {
  // Senza questo paletto il giro periodico riscriverebbe ogni quarto d'ora la
  // stessa lettura vecchia con `quando = adesso`, e dopo un'ora la pagina
  // direbbe «letto un minuto fa» di un dato di ieri. Il grafico diventerebbe
  // una riga piatta inventata.
  cloudCheRifiuta();
  const fatte = archivio([
    ...GETTONI,
    ["FROM istantanee WHERE fonte='bluetti'", [
      { apparecchio: 'SN1', dati: { nome: 'AC180', sn: 'SN1', carica: 72 },
        quando: new Date(Date.now() - 14 * 60000) },
    ]],
  ]);
  const { registra } = await import('../src/lib/bluetti.js');
  const esito = await registra();
  assert.equal(esito.quante, 0);
  assert.equal(fatte.some(x => x.s.startsWith('INSERT INTO istantanee')), false,
    'non deve scrivere istantanee');
  assert.equal(fatte.some(x => x.s.startsWith('INSERT INTO misure')), false,
    'non deve scrivere misure');
});

// ---------------------------------------------------------------------------
// Uno zero vecchio non e' uno zero
// ---------------------------------------------------------------------------
//
// Disegno: docs/superpowers/specs/2026-11-21-zero-vecchio-design.md
//
// Il 21/11/2026 il proprietario, col 220 aperto dalla Bluetti: «in questo
// momento e' aperto il 220 da bluetti e app non lo rileva e i flussi delle
// animazioni pure». Il cloud rifiutava da venticinque minuti e la pagina
// mostrava l'ultima lettura buona con la sua eta', in ambra -- la cosa
// giusta. Alle 15:22 il servizio ha scritto «travaso in corso, 436 W da
// 2 min»: i watt c'erano. Per quei venticinque minuti la pagina ha mostrato
// l'uscita 220 a **zero** mentre dalla Bluetti uscivano quattrocento watt. E
// il 19/11, identico, con 400 W.
//
// La fascia dell'eta' c'era tutte e due le volte, e ha perso tutte e due le
// volte. Non e' la fascia da rifare: qui dentro `—` vuol dire «non so» e `0`
// vuol dire «uno zero che conosco», e **uno zero vecchio non e' un valore
// vecchio: e' un'affermazione vecchia**, e l'affermazione e' «non sta
// succedendo niente». Un 436 W di cinque minuti fa lo leggi per quel che e';
// uno zero no -- lo zero non sembra un numero, sembra lo stato del mondo.

test('oltre l’eta’, uno zero diventa «non so»; un numero vero resta', async () => {
  cloudCheRifiuta();
  archivio([
    ...GETTONI,
    ["FROM istantanee WHERE fonte='bluetti'", [
      { apparecchio: 'SN1',
        dati: { nome: 'AC180', sn: 'SN1', carica: 100,
                fotovoltaico_w: 0, rete_w: 0, uscita_ac_w: 0, uscita_dc_w: 12 },
        quando: new Date(Date.now() - 25 * 60000) },
    ]],
  ]);
  const { statoBluetti } = await import('../src/lib/bluetti.js');
  const s = await statoBluetti({ fresco: true });
  const a = s.apparecchi[0];

  // Il caso vero del 21/11: l'uscita 220 a zero da venticinque minuti.
  assert.equal(a.uscita_ac_w, null, 'uno zero di venticinque minuti afferma troppo');
  assert.equal(a.fotovoltaico_w, null);
  assert.equal(a.rete_w, null);
  // Un valore **diverso da zero** resta: quello si legge gia' per quel che e'.
  assert.equal(a.uscita_dc_w, 12);
  // E la carica non si tocca: uno zero di carica non e' un caso reale sulla
  // Bluetti, e una regola applicata dove non serve e' solo un posto in piu'
  // dove sbagliare.
  assert.equal(a.carica, 100);
});

test('uno zero fresco resta zero: e’ uno zero che conosciamo', async () => {
  cloudCheRifiuta();
  archivio([
    ...GETTONI,
    ["FROM istantanee WHERE fonte='bluetti'", [
      { apparecchio: 'SN1',
        dati: { nome: 'AC180', sn: 'SN1', carica: 100, uscita_ac_w: 0, uscita_dc_w: 0 },
        quando: new Date(Date.now() - 60000) },
    ]],
  ]);
  const { statoBluetti } = await import('../src/lib/bluetti.js');
  const s = await statoBluetti({ fresco: true });

  // Un giro saltato e' normale: la pagina non deve lampeggiare per quello.
  assert.equal(s.apparecchi[0].uscita_ac_w, 0);
  assert.equal(s.apparecchi[0].uscita_dc_w, 0);
});
