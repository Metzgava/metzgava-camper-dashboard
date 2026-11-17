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
