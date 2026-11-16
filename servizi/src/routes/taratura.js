// La taratura: come si scoprono i consumi di QUESTO camper.
//
// Si spegne tutto, poi si accende un carico per volta e si guarda lo scalino
// nella corrente delle batterie di servizio. Ne esce una tabella vera — luci
// cucina 0,4 A, pompa 5,4 A — invece di numeri da catalogo.
//
// Tre scelte che vale la pena spiegare, perche' non sono ovvie.
//
// 1. **La sessione scade, non si spegne.** Durante la taratura la scatoletta
//    legge ogni dieci secondi invece di ogni cinque minuti: consuma piu'
//    corrente e scrive di piu' sulla scheda di memoria. Se dipendesse da un
//    interruttore, basterebbe una rete caduta per lasciarla accesa per giorni.
//    Con una scadenza, il caso peggiore e' mezz'ora.
//
// 2. **Lo scalino non si archivia: si ricalcola.** In archivio restano il nome
//    del carico e l'istante in cui l'hai acceso. Il numero si ottiene dalle
//    misure ogni volta che serve, quindi se domani il modo di calcolarlo
//    migliora, i segni di ieri valgono ancora. Un numero congelato invece
//    resterebbe sbagliato per sempre.
//
// 3. **Mediana e non media.** Dentro una finestra di due minuti il frigo puo'
//    partire, e una sua punta trascinerebbe la media. La mediana se ne accorge
//    appena.
import { Router } from 'express';
import { q, segna } from '../lib/db.js';
import { serveAccesso } from './auth.js';

export const router = Router();
router.use(serveAccesso);
const wrap = f => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);

// Quanto dura al massimo una sessione, e ogni quanto legge la scatoletta
// mentre e' aperta. Dieci secondi sono il compromesso: abbastanza fitti per
// vedere uno scalino, abbastanza larghi da non tenere la radio sempre accesa.
const MINUTI_MAX = 60;
const MINUTI_PREDEFINITI = 30;
const SECONDI_GIRO = 10;

// Le finestre attorno al segno. Si salta la ventina di secondi subito dopo
// l'accensione: un frigo che parte ha uno spunto, una lampada un transitorio,
// e il valore che ci interessa e' quello a regime.
const PRIMA_DA = 150, PRIMA_A = 20;
const DOPO_DA = 25, DOPO_A = 180;
const CAMPIONI_MINIMI = 3;

// ---------------------------------------------------------------------------
// La sessione
// ---------------------------------------------------------------------------

export async function sessioneAttiva() {
  const r = await q(`SELECT id, scade FROM taratura_sessione
                      WHERE chiusa IS NULL AND scade > now()
                      ORDER BY id DESC LIMIT 1`);
  if (!r.rows.length) return { attiva: false };
  return { attiva: true, id: r.rows[0].id, scade: r.rows[0].scade, secondi: SECONDI_GIRO };
}

// Chi sono le batterie di servizio: quelle che mandano le tensioni delle
// celle. Nessun altro apparecchio lo fa, quindi non serve indovinare dai nomi
// — e i nomi delle Ective contengono un byte invisibile, quindi e' meglio
// cosi'.
async function banco() {
  const r = await q(`SELECT apparecchio FROM istantanee WHERE dati ? 'celle_mv'`);
  return r.rows.map(x => x.apparecchio);
}

async function mediane(apparecchi, da, a) {
  if (!apparecchi.length) return { somma: null, campioni: 0, quanti: 0 };
  const r = await q(
    `SELECT apparecchio,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY valore) AS mediana,
            count(*)::int AS campioni
       FROM misure
      WHERE grandezza = 'ampere' AND apparecchio = ANY($1)
        AND quando BETWEEN $2 AND $3
      GROUP BY apparecchio`, [apparecchi, da, a]);
  const buone = r.rows.filter(x => x.campioni >= CAMPIONI_MINIMI);
  if (!buone.length) {
    return { somma: null, campioni: r.rows.reduce((s, x) => s + x.campioni, 0), quanti: 0 };
  }
  return {
    somma: buone.reduce((s, x) => s + Number(x.mediana), 0),
    campioni: buone.reduce((s, x) => s + x.campioni, 0),
    quanti: buone.length,
  };
}

// Lo scalino. La corrente delle batterie e' negativa quando si scaricano,
// quindi accendere un carico la rende piu' negativa: prima meno dopo da' un
// numero positivo, che e' quanto mangia il carico.
async function scalino(quando) {
  const app = await banco();
  const t = new Date(quando).getTime();
  const fin = (secondi) => new Date(t + secondi * 1000).toISOString();
  const prima = await mediane(app, fin(-PRIMA_DA), fin(-PRIMA_A));
  const dopo = await mediane(app, fin(DOPO_DA), fin(DOPO_A));

  if (!app.length) {
    return { base: 'incompleto', perche: 'Nessuna batteria di servizio ha ancora mandato letture.' };
  }
  if (prima.somma == null || dopo.somma == null) {
    const quale = prima.somma == null && dopo.somma == null ? 'prima e dopo'
      : prima.somma == null ? 'prima' : 'dopo';
    return {
      base: 'incompleto',
      perche: `Troppe poche letture ${quale} del segno: servono almeno ${CAMPIONI_MINIMI} campioni per batteria. `
        + `Trovati ${prima.campioni} prima e ${dopo.campioni} dopo.`,
    };
  }
  const valore = prima.somma - dopo.somma;
  return {
    base: 'misurato',
    ampere: valore,
    prima: prima.somma,
    dopo: dopo.somma,
    campioni: prima.campioni + dopo.campioni,
    batterie: Math.min(prima.quanti, dopo.quanti),
    perche: `${prima.somma.toFixed(2)} A prima, ${dopo.somma.toFixed(2)} A dopo, `
      + `su ${prima.campioni + dopo.campioni} letture di ${Math.min(prima.quanti, dopo.quanti)} batterie`,
  };
}

// ---------------------------------------------------------------------------
// Le rotte
// ---------------------------------------------------------------------------

router.get('/taratura', wrap(async (req, res) => {
  const s = await sessioneAttiva();
  const r = await q(`SELECT g.id, g.nome, g.quando
                       FROM taratura_segni g
                      ORDER BY g.quando DESC LIMIT 40`);
  const segni = [];
  for (const g of r.rows) segni.push({ ...g, misura: await scalino(g.quando) });
  res.json({ sessione: s, minuti_predefiniti: MINUTI_PREDEFINITI, minuti_max: MINUTI_MAX, segni });
}));

router.post('/taratura/apri', wrap(async (req, res) => {
  const minuti = Math.min(MINUTI_MAX, Math.max(5, Number(req.body?.minuti) || MINUTI_PREDEFINITI));
  // Una sessione per volta: se ce n'e' una aperta la si prolunga invece di
  // affiancarne un'altra, cosi' la scatoletta non deve scegliere.
  await q(`UPDATE taratura_sessione SET chiusa = now() WHERE chiusa IS NULL`);
  const r = await q(`INSERT INTO taratura_sessione (scade) VALUES (now() + ($1 || ' minutes')::interval)
                     RETURNING id, scade`, [String(minuti)]);
  await segna('taratura', `Sessione aperta per ${minuti} minuti`, 'persona');
  res.json({ ok: true, sessione: { attiva: true, ...r.rows[0], secondi: SECONDI_GIRO } });
}));

router.post('/taratura/chiudi', wrap(async (req, res) => {
  await q(`UPDATE taratura_sessione SET chiusa = now() WHERE chiusa IS NULL`);
  await segna('taratura', 'Sessione chiusa', 'persona');
  res.json({ ok: true, sessione: { attiva: false } });
}));

router.post('/taratura/segna', wrap(async (req, res) => {
  const nome = String(req.body?.nome || '').trim().slice(0, 60);
  if (!nome) return res.status(400).json({ error: 'Serve il nome del carico' });
  const s = await sessioneAttiva();
  if (!s.attiva) return res.status(409).json({ error: 'Nessuna sessione di taratura aperta' });
  const r = await q(`INSERT INTO taratura_segni (sessione, nome) VALUES ($1, $2) RETURNING id, nome, quando`,
    [s.id, nome]);
  res.json({ ok: true, segno: r.rows[0] });
}));

router.delete('/taratura/segni/:id', wrap(async (req, res) => {
  await q('DELETE FROM taratura_segni WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// Accettare e' un atto esplicito: il numero misurato lo guarda una persona e
// decide se e' credibile. Un valore sbagliato scritto in automatico sporcherebbe
// tutti i conti che lo usano, e nessuno saprebbe da dove viene.
router.post('/taratura/accetta/:id', wrap(async (req, res) => {
  const r = await q('SELECT id, nome, quando FROM taratura_segni WHERE id = $1', [Number(req.params.id)]);
  if (!r.rows.length) return res.status(404).json({ error: 'Segno non trovato' });
  const g = r.rows[0];
  const m = await scalino(g.quando);
  if (m.base !== 'misurato') return res.status(409).json({ error: 'Questo segno non ha una misura: ' + m.perche });

  const chiave = 'carico_' + g.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40).replace(/_+$/, '') + '_a';
  const nota = `Misurato in taratura il ${new Date(g.quando).toLocaleDateString('it-IT')}: ${m.perche}.`;
  await q(`INSERT INTO impianto (chiave, valore, unita, nota, misurato, aggiornato)
           VALUES ($1, $2, 'A', $3, true, now())
           ON CONFLICT (chiave) DO UPDATE SET valore = $2, nota = $3, misurato = true, aggiornato = now()`,
    [chiave, Number(m.ampere.toFixed(2)), nota]);
  await segna('taratura', `${g.nome}: ${m.ampere.toFixed(2)} A accettati in impianto`, 'persona');
  res.json({ ok: true, chiave, ampere: Number(m.ampere.toFixed(2)) });
}));
