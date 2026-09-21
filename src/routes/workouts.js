import { Router } from 'express';
import multer from 'multer';
import { q } from '../lib/db.js';
import { wrap, encrypt, decrypt, num } from '../lib/util.js';
import { parseGpx } from '../lib/gpx.js';
import * as komoot from '../lib/komoot.js';
import * as strava from '../lib/strava.js';
import crypto from 'node:crypto';
import { requireAuth, requireDevice } from './auth.js';
import { agganciaAllenamenti } from './trips.js';

export const router = Router();
export const ingest = Router(); // montato PRIMA delle rotte con sessione: usa il token dispositivo
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
// L'export di mesi di allenamenti puo' superare il limite pensato per un singolo GPX
const uploadJson = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function saveWorkout(userId, w, tripId = null) {
  const r = await q(`INSERT INTO workouts(user_id,trip_id,source,external_id,sport,name,started_at,duration_s,distance_m,elevation_up_m,calories,hr_avg,hr_max,speed_avg_kmh,track,meta)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (user_id,source,external_id) DO UPDATE SET
      sport=coalesce(EXCLUDED.sport,workouts.sport), name=coalesce(EXCLUDED.name,workouts.name), duration_s=coalesce(EXCLUDED.duration_s,workouts.duration_s),
      distance_m=coalesce(EXCLUDED.distance_m,workouts.distance_m), elevation_up_m=coalesce(EXCLUDED.elevation_up_m,workouts.elevation_up_m),
      calories=coalesce(EXCLUDED.calories,workouts.calories), hr_avg=coalesce(EXCLUDED.hr_avg,workouts.hr_avg), hr_max=coalesce(EXCLUDED.hr_max,workouts.hr_max),
      speed_avg_kmh=coalesce(EXCLUDED.speed_avg_kmh,workouts.speed_avg_kmh), track=coalesce(EXCLUDED.track,workouts.track), meta=coalesce(workouts.meta,'{}')::jsonb || coalesce(EXCLUDED.meta,'{}')::jsonb,
      trip_id=coalesce(workouts.trip_id, EXCLUDED.trip_id)
    RETURNING *`,
    [userId, tripId ?? await guessTrip(w.started_at), w.source, w.external_id || `${w.source}-${new Date(w.started_at).toISOString()}`, w.sport || null, w.name || null, w.started_at,
      w.duration_s ?? null, w.distance_m ?? null, w.elevation_up_m ?? null, w.calories ?? null, w.hr_avg ?? null, w.hr_max ?? null, w.speed_avg_kmh ?? null,
      w.track ? JSON.stringify(w.track) : null, w.meta ? JSON.stringify(w.meta) : null]);
  return r.rows[0];
}

// Associa automaticamente l'allenamento al viaggio in corso in quella data
async function guessTrip(startedAt) {
  const d = new Date(startedAt);
  const r = await q(`SELECT id FROM trips WHERE (start_date IS NULL OR start_date <= $1::date) AND (end_date IS NULL OR end_date >= $1::date) AND (status='open' OR end_date IS NOT NULL) ORDER BY status='open' DESC, start_date DESC LIMIT 1`, [d]);
  return r.rows[0]?.id || null;
}

// Abbina un allenamento Salute (senza GPS) a uno Komoot/GPX vicino nel tempo, unendo battito/calorie
async function mergeHealthIntoTrack(userId, w) {
  const start = new Date(w.started_at);
  const r = await q(`SELECT * FROM workouts WHERE user_id=$1 AND source IN ('komoot','gpx','strava') AND abs(extract(epoch FROM (started_at - $2::timestamptz))) < 900 ORDER BY abs(extract(epoch FROM (started_at - $2::timestamptz))) LIMIT 1`, [userId, start]);
  const match = r.rows[0];
  if (!match) return null;
  await q(`UPDATE workouts SET calories=coalesce($2,calories), hr_avg=coalesce($3,hr_avg), hr_max=coalesce($4,hr_max), meta=coalesce(meta,'{}')::jsonb || $5::jsonb WHERE id=$1`,
    [match.id, w.calories ?? null, w.hr_avg ?? null, w.hr_max ?? null, JSON.stringify({ health: w.meta || {}, merged_from_health: true })]);
  return match.id;
}

// HAE dichiara la durata in secondi: quando ci sono inizio e fine usiamo quelli, che non dipendono dall’unità
function healthDuration(w) {
  const start = new Date(w.start), end = w.end ? new Date(w.end) : null;
  if (end && !isNaN(start) && !isNaN(end) && end > start) return Math.round((end - start) / 1000);
  return w.duration != null ? Math.round(num(w.duration)) : null;
}

// Converte la distanza nell’unità dichiarata da HAE (km, miglia, iarde, piedi; altrimenti metri)
function healthDistance(d) {
  if (!d || d.qty == null) return null;
  const u = String(d.units || '').trim().toLowerCase();
  const f = u.startsWith('km') ? 1000 : u.startsWith('mi') ? 1609.344 : u.startsWith('yd') ? 0.9144 : u.startsWith('ft') ? 0.3048 : 1;
  return Math.round(num(d.qty) * f);
}

// I punti della traccia arrivano come lat/lon oppure latitude/longitude secondo la versione di HAE
function healthTrack(route) {
  if (!Array.isArray(route)) return null;
  const pts = route
    .map(p => [Number(p?.lat ?? p?.latitude), Number(p?.lon ?? p?.longitude)])
    .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo))
    .map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]);
  return pts.length ? pts : null;
}

// ---------- arrivo dei dati da iPhone ----------
// Ricava gli allenamenti dal pacchetto: sia il formato di "Health Auto Export"
// (data.workouts[]) sia quello semplice dei Comandi Rapidi
function itemsDaPacchetto(body, origine) {
  if (Array.isArray(body.data?.workouts)) {
    return body.data.workouts.map(w => ({
      source: 'health', external_id: w.id || `${w.name}-${w.start}`, sport: w.name, name: w.name,
      started_at: new Date(w.start), duration_s: healthDuration(w),
      distance_m: healthDistance(w.distance),
      calories: w.activeEnergy?.qty != null ? Math.round(num(w.activeEnergy.qty)) : (w.activeEnergyBurned?.qty != null ? Math.round(num(w.activeEnergyBurned.qty)) : null),
      hr_avg: w.avgHeartRate?.qty != null ? Math.round(num(w.avgHeartRate.qty)) : (w.heartRate?.avg?.qty != null ? Math.round(num(w.heartRate.avg.qty)) : null),
      hr_max: w.maxHeartRate?.qty != null ? Math.round(num(w.maxHeartRate.qty)) : (w.heartRate?.max?.qty != null ? Math.round(num(w.heartRate.max.qty)) : null),
      elevation_up_m: w.elevationUp?.qty != null ? Math.round(num(w.elevationUp.qty)) : null,
      track: healthTrack(w.route),
      meta: { device: origine, steps: w.stepCount?.qty ?? null, temperature: w.temperature?.qty ?? null, raw_units: { distance: w.distance?.units } },
    }));
  }
  const list = Array.isArray(body) ? body : Array.isArray(body.workouts) ? body.workouts : [body];
  return list.filter(w => w && (w.start || w.started_at)).map(w => ({
    source: 'health', external_id: w.id || w.uuid || null, sport: w.type || w.sport || null, name: w.name || w.type || 'Allenamento',
    started_at: new Date(w.start || w.started_at), duration_s: w.duration_s != null ? num(w.duration_s) : (w.duration_min != null ? Math.round(num(w.duration_min) * 60) : null),
    distance_m: w.distance_m != null ? num(w.distance_m) : (w.distance_km != null ? Math.round(num(w.distance_km) * 1000) : null),
    calories: w.calories != null ? Math.round(num(w.calories)) : null, hr_avg: w.hr_avg != null ? Math.round(num(w.hr_avg)) : null, hr_max: w.hr_max != null ? Math.round(num(w.hr_max)) : null,
    elevation_up_m: w.elevation_up_m != null ? num(w.elevation_up_m) : null,
    track: Array.isArray(w.track) ? w.track : null, meta: { device: origine, ...(w.meta || {}) },
  }));
}
// Salva gli allenamenti, fondendo quelli senza GPS con l'attivita' Komoot/GPX corrispondente
async function archivia(userId, items) {
  const saved = [], merged = [];
  for (const w of items) {
    const m = w.track ? null : await mergeHealthIntoTrack(userId, w);
    if (m) { merged.push(m); continue; }
    saved.push((await saveWorkout(userId, w)).id);
  }
  return { saved: saved.length, merged: merged.length };
}

const formaPacchetto = body => Array.isArray(body.data?.workouts) ? `data.workouts[${body.data.workouts.length}]`
  : `non riconosciuta (chiavi: ${Object.keys(body).join(',') || 'nessuna'}${body.data ? '; dentro data: ' + Object.keys(body.data).join(',') : ''})`;

ingest.post('/health', requireDevice, wrap(async (req, res) => {
  const body = req.body || {};
  const items = itemsDaPacchetto(body, req.device.name);
  const r = await archivia(req.user.id, items);
  // Traccia l'esito: un invio accettato ma vuoto altrimenti non lascerebbe alcun segno.
  // Registriamo solo la forma del pacchetto e i conteggi, mai i dati sanitari.
  console.log(`ingest: forma=${formaPacchetto(body)} elementi=${items.length} salvati=${r.saved} uniti=${r.merged} dispositivo=${req.device.name}`);
  res.json({ ok: true, ...r, device: req.device.name });
}));

// ---------- rotte autenticate ----------
router.use(requireAuth);

// Il tapis roulant: Salute lo esporta come corsa o camminata "al chiuso", e Health
// Auto Export traduce i nomi nella lingua del telefono ("Interno Esegui" e' Indoor
// Run). Riconosciamo le varianti italiane e inglesi, cosi' il filtro vale anche per
// gli allenamenti che arriveranno in futuro.
const CONDIZIONE_TAPIS = `(
  lower(w.sport) ~ '(interno|indoor|coperto).*(camminat|esegui|cors|walk|run)'
  OR lower(w.sport) ~ '(camminat|esegui|cors|walk|run).*(interno|indoor|coperto)'
  OR lower(w.sport) LIKE '%tapis%' OR lower(w.sport) LIKE '%treadmill%'
)`;

router.get('/workouts', wrap(async (req, res) => {
  const { from, to, user_id, trip_id } = req.query;
  // Quante attivita' restituire: il vecchio tetto fisso di 300 tagliava fuori gli
  // archivi piu' lunghi anche senza filtri. Resta comunque un limite, per non
  // spedire l'intero storico a ogni apertura della pagina.
  const tetto = Math.min(Math.max(1, Number(req.query.limit) || 1000), 5000);
  const conds = [], params = [];
  if (from) { params.push(from); conds.push(`started_at >= $${params.length}`); }
  if (to) { params.push(to); conds.push(`started_at < $${params.length}::date + 1`); }
  if (user_id) { params.push(+user_id); conds.push(`w.user_id = $${params.length}`); }
  // trip_id accetta piu' valori separati da virgola; 'none' sono i non associati
  // tapis=1 mostra solo il tapis roulant, tapis=0 lo esclude
  if (req.query.tapis === '1') conds.push(CONDIZIONE_TAPIS);
  else if (req.query.tapis === '0') conds.push(`NOT ${CONDIZIONE_TAPIS}`);
  if (trip_id) {
    const voci = String(trip_id).split(',').map(v => v.trim()).filter(Boolean);
    const ids = voci.filter(v => v !== 'none').map(Number).filter(Number.isInteger);
    const pezzi = [];
    if (ids.length) { params.push(ids); pezzi.push(`w.trip_id = ANY($${params.length}::int[])`); }
    if (voci.includes('none')) pezzi.push('w.trip_id IS NULL');
    if (pezzi.length) conds.push('(' + pezzi.join(' OR ') + ')');
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = (await q(`SELECT w.id,w.user_id,w.trip_id,w.source,w.sport,w.name,w.started_at,w.duration_s,w.distance_m,w.elevation_up_m,w.calories,w.hr_avg,w.hr_max,w.speed_avg_kmh,w.meta,(w.track IS NOT NULL) AS has_track,u.name AS athlete,t.title AS trip_title
    FROM workouts w JOIN users u ON u.id=w.user_id LEFT JOIN trips t ON t.id=w.trip_id ${where} ORDER BY started_at DESC LIMIT $${params.length + 1}`, [...params, tetto])).rows;
  res.json(rows);
}));
// ---------- doppioni ----------
// Stessa uscita registrata due volte, di solito una da Komoot o da un GPX e una
// da Salute: capita quando su iPhone e' acceso l'invio del percorso, perche' con
// una traccia propria l'allenamento non si fonde con quello esistente.

// Komoot e Salute chiamano lo stesso sport in modi diversi: riconduciamoli a famiglie
const FAMIGLIE = { escursione: ['hike', 'hiking'], camminata: ['walk', 'walking'], corsa: ['run', 'running', 'jogging'],
  bici: ['bike', 'cycling', 'touringbicycle', 'mtb', 'racebike', 'ebike', 'ride'], nuoto: ['swim', 'swimming'], sci: ['ski', 'skitour'] };
function famigliaSport(s) {
  const t = String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return 'ignoto';
  for (const [fam, voci] of Object.entries(FAMIGLIE)) if (voci.some(v => t.includes(v))) return fam;
  return 'altro:' + t;
}

// Quanto e' completo un record: a parita' di uscita teniamo quello che dice di piu'
const ricchezza = w => (w.has_track ? 4 : 0) + (['komoot', 'gpx', 'strava'].includes(w.source) ? 2 : 0)
  + (w.calories ? 1 : 0) + (w.hr_avg ? 1 : 0) + (w.elevation_up_m ? 1 : 0);

// Due record sono lo stesso allenamento se stesso atleta, stessa famiglia di sport,
// inizio a meno di 15 minuti e distanze compatibili (o entrambe assenti)
function stessoAllenamento(a, b) {
  if (a.user_id !== b.user_id) return false;
  if (Math.abs(new Date(a.started_at) - new Date(b.started_at)) > 15 * 60 * 1000) return false;
  const fa = famigliaSport(a.sport), fb = famigliaSport(b.sport);
  if (fa !== fb && fa !== 'ignoto' && fb !== 'ignoto') return false;
  const da = a.distance_m, db = b.distance_m;
  if (da == null && db == null) return true;
  if (da == null || db == null) return false;
  return Math.abs(da - db) <= 0.15 * Math.max(da, db);
}

// Anni in cui esiste almeno un allenamento, per il selettore del periodo
router.get('/workouts/anni', wrap(async (req, res) => {
  const rows = (await q(`SELECT DISTINCT extract(year FROM started_at AT TIME ZONE 'Europe/Rome')::int AS anno FROM workouts ORDER BY anno DESC`)).rows;
  res.json(rows.map(r => r.anno));
}));

router.get('/workouts/duplicates', wrap(async (req, res) => {
  const rows = (await q(`SELECT w.id,w.user_id,w.source,w.sport,w.name,w.started_at,w.duration_s,w.distance_m,w.elevation_up_m,w.calories,w.hr_avg,
      (w.track IS NOT NULL) AS has_track, u.name AS athlete, t.title AS trip_title
    FROM workouts w JOIN users u ON u.id=w.user_id LEFT JOIN trips t ON t.id=w.trip_id ORDER BY w.started_at`)).rows;
  const visti = new Set(), gruppi = [];
  for (let i = 0; i < rows.length; i++) {
    if (visti.has(rows[i].id)) continue;
    const gruppo = [rows[i]];
    for (let j = i + 1; j < rows.length; j++) {
      if (visti.has(rows[j].id)) continue;
      if (new Date(rows[j].started_at) - new Date(rows[i].started_at) > 15 * 60 * 1000) break;
      if (gruppo.some(g => stessoAllenamento(g, rows[j]))) gruppo.push(rows[j]);
    }
    if (gruppo.length < 2) continue;
    gruppo.forEach(g => visti.add(g.id));
    const ordinati = [...gruppo].sort((a, b) => ricchezza(b) - ricchezza(a) || a.id - b.id);
    gruppi.push({ tieni: ordinati[0], elimina: ordinati.slice(1) });
  }
  res.json({ gruppi, totale_da_eliminare: gruppi.reduce((a, g) => a + g.elimina.length, 0) });
}));

// Elimina solo gli id indicati, e solo se sono davvero doppioni di qualcosa che resta
router.post('/workouts/duplicates/remove', wrap(async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return res.status(400).json({ error: 'Nessun allenamento indicato' });
  const r = await q('DELETE FROM workouts WHERE id = ANY($1::int[]) AND (user_id=$2 OR $3)', [ids, req.user.id, req.user.role === 'admin']);
  console.log(`doppioni: eliminati ${r.rowCount} allenamenti su ${ids.length} richiesti, utente=${req.user.id}`);
  res.json({ ok: true, eliminati: r.rowCount });
}));

router.get('/workouts/:id', wrap(async (req, res) => {
  const r = (await q('SELECT w.*, u.name AS athlete, t.title AS trip_title FROM workouts w JOIN users u ON u.id=w.user_id LEFT JOIN trips t ON t.id=w.trip_id WHERE w.id=$1', [req.params.id])).rows[0];
  r ? res.json(r) : res.status(404).json({ error: 'Non trovato' });
}));
router.put('/workouts/:id', wrap(async (req, res) => {
  const b = req.body || {};
  // trip_auto: torna all'abbinamento automatico in base alle date del viaggio.
  // Altrimenti il viaggio si tocca solo se il chiamante lo manda davvero, cosi'
  // rinominare non lo slega; e una scelta esplicita resta tale, anche "nessun viaggio".
  const tornaAutomatico = b.trip_auto === true;
  const cambiaViaggio = tornaAutomatico || Object.prototype.hasOwnProperty.call(b, 'trip_id');
  const nome = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : null;
  let r = (await q(`UPDATE workouts SET
      trip_id=CASE WHEN $2 THEN $3::int ELSE trip_id END,
      trip_manual=CASE WHEN $11 THEN false WHEN $2 THEN true ELSE trip_manual END,
      name=coalesce($4,name), sport=coalesce($5,sport),
      calories=coalesce($6,calories), hr_avg=coalesce($7,hr_avg), hr_max=coalesce($8,hr_max)
    WHERE id=$1 AND (user_id=$9 OR $10) RETURNING *`,
    [req.params.id, cambiaViaggio, tornaAutomatico ? null : (b.trip_id || null), nome, b.sport, b.calories, b.hr_avg, b.hr_max, req.user.id, req.user.role === 'admin', tornaAutomatico])).rows[0];
  if (!r) return res.status(404).json({ error: 'Allenamento non trovato, o non tuo' });
  if (tornaAutomatico) {
    await agganciaAllenamenti();
    r = (await q('SELECT * FROM workouts WHERE id=$1', [req.params.id])).rows[0];
  }
  res.json(r);
}));
router.delete('/workouts/:id', wrap(async (req, res) => {
  await q('DELETE FROM workouts WHERE id=$1 AND (user_id=$2 OR $3)', [req.params.id, req.user.id, req.user.role === 'admin']); res.json({ ok: true });
}));

// Importazione manuale del JSON di Health Auto Export: serve per recuperare lo
// storico, visto che l'automazione sul telefono copre al massimo sette giorni.
router.post('/workouts/health-json', uploadJson.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File JSON mancante' });
  let body;
  try { body = JSON.parse(req.file.buffer.toString('utf8')); }
  catch { return res.status(400).json({ error: 'Il file non e\u2019 un JSON valido' }); }
  const items = itemsDaPacchetto(body, `file ${req.file.originalname}`);
  if (!items.length) return res.status(400).json({ error: `Nessun allenamento nel file (forma: ${formaPacchetto(body)}). Esporta il tipo di dato "Allenamenti", non le metriche.` });
  const r = await archivia(req.user.id, items);
  console.log(`importazione file: elementi=${items.length} salvati=${r.saved} uniti=${r.merged} utente=${req.user.id}`);
  res.json({ ok: true, letti: items.length, ...r });
}));

// Upload GPX manuale
router.post('/workouts/gpx', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File GPX mancante' });
  const w = parseGpx(req.file.buffer.toString('utf8'));
  w.source = 'gpx'; w.external_id = `${req.file.originalname}-${w.started_at.toISOString()}`;
  const saved = await saveWorkout(req.user.id, w, req.body.trip_id ? +req.body.trip_id : null);
  res.json(saved);
}));

// ---------- Komoot ----------
router.get('/komoot', wrap(async (req, res) => {
  const r = (await q(`SELECT external_user_id, last_sync_at FROM integrations WHERE user_id=$1 AND provider='komoot'`, [req.user.id])).rows[0];
  res.json({ connected: !!r, ...(r || {}) });
}));
router.post('/komoot/connect', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email e password Komoot obbligatorie' });
  let login;
  try { login = await komoot.login(email, password); }
  catch (e) { return res.status(400).json({ error: 'Login Komoot fallito: ' + (e.status === 401 || e.status === 403 ? 'credenziali errate' : e.message) }); }
  await q(`INSERT INTO integrations(user_id,provider,external_user_id,secret_enc) VALUES($1,'komoot',$2,$3)
           ON CONFLICT (user_id,provider) DO UPDATE SET external_user_id=$2, secret_enc=$3`, [req.user.id, login.userId, encrypt(login.token)]);
  res.json({ connected: true, external_user_id: login.userId, displayName: login.displayName });
}));
router.delete('/komoot', wrap(async (req, res) => { await q(`DELETE FROM integrations WHERE user_id=$1 AND provider='komoot'`, [req.user.id]); res.json({ ok: true }); }));

// Il token e' cifrato con una chiave derivata da SESSION_SECRET: se l'app viene
// spostata su un'installazione con un segreto diverso, il token non e' piu'
// leggibile e l'unica via e' rifare il collegamento.
function leggiSegreto(r, servizio) {
  try { return decrypt(r.secret_enc); }
  catch { throw new Error(`collegamento ${servizio} non piu' leggibile su questa installazione: scollega e ricollega ${servizio}`); }
}

export async function syncKomootFor(userId, { full = false } = {}) {
  const r = (await q(`SELECT * FROM integrations WHERE user_id=$1 AND provider='komoot'`, [userId])).rows[0];
  if (!r) return { skipped: true };
  const token = leggiSegreto(r, 'Komoot');
  const since = full ? null : (r.last_sync_at ? new Date(new Date(r.last_sync_at).getTime() - 86400000 * 2) : null);
  const tours = await komoot.listTours(r.external_user_id, token, { limit: full ? 200 : 30, since });
  let n = 0;
  for (const t of tours) {
    const exists = (await q(`SELECT id FROM workouts WHERE user_id=$1 AND source='komoot' AND external_id=$2 AND track IS NOT NULL`, [userId, String(t.id)])).rows[0];
    if (exists && !full) continue;
    await saveWorkout(userId, await komoot.tourToWorkout(r.external_user_id, token, t)); n++;
  }
  await q('UPDATE integrations SET last_sync_at=now() WHERE id=$1', [r.id]);
  return { imported: n, checked: tours.length };
}
router.post('/komoot/sync', wrap(async (req, res) => {
  try { res.json(await syncKomootFor(req.user.id, { full: req.body?.full === true })); }
  catch (e) {
    // Senza questa riga la causa resta solo nel messaggio a schermo e i log non aiutano
    console.warn(`Komoot sync a richiesta fallito, utente ${req.user.id}: ${e.message}`);
    res.status(502).json({ error: 'Sincronizzazione Komoot fallita: ' + e.message });
  }
}));

// Sync periodico per tutti gli utenti collegati (chiamato dal server ogni 6 ore)
// ---------- Strava ----------
const redirectStrava = req => `${req.protocol}://${req.get('host')}/api/strava/callback`;

router.get('/strava', wrap(async (req, res) => {
  const r = (await q(`SELECT external_user_id, last_sync_at FROM integrations WHERE user_id=$1 AND provider='strava'`, [req.user.id])).rows[0];
  res.json({ connected: !!r, configurato: strava.configurato(), ...(r || {}) });
}));

// Porta l'utente su Strava; lo stato casuale evita che la risposta venga contraffatta
router.get('/strava/connect', wrap(async (req, res) => {
  if (!strava.configurato()) return res.status(400).json({ error: 'Strava non e\u2019 configurato: mancano STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET' });
  const stato = crypto.randomBytes(16).toString('hex');
  req.session.stravaStato = stato;
  res.redirect(strava.urlAutorizzazione(redirectStrava(req), stato));
}));

router.get('/strava/callback', wrap(async (req, res) => {
  const { code, state, error } = req.query;
  const esito = m => res.redirect('/#/impostazioni?strava=' + encodeURIComponent(m));
  if (error) return esito('negato');
  if (!code || !state || state !== req.session.stravaStato) return esito('stato-non-valido');
  req.session.stravaStato = null;
  try {
    const t = await strava.scambiaCodice(String(code));
    await q(`INSERT INTO integrations(user_id,provider,external_user_id,secret_enc) VALUES($1,'strava',$2,$3)
             ON CONFLICT (user_id,provider) DO UPDATE SET external_user_id=$2, secret_enc=$3`,
      [req.user.id, String(t.atleta?.id || ''), encrypt(JSON.stringify(t))]);
    syncStravaFor(req.user.id, { full: true }).catch(e => console.warn('primo scarico Strava fallito:', e.message));
    return esito('collegato');
  } catch (e) { console.warn('collegamento Strava fallito:', e.message); return esito('errore'); }
}));

router.delete('/strava', wrap(async (req, res) => {
  await q(`DELETE FROM integrations WHERE user_id=$1 AND provider='strava'`, [req.user.id]);
  res.json({ ok: true });
}));

// Strava concede 100 chiamate ogni quarto d'ora: le calorie stanno solo sul dettaglio,
// quindi ne chiediamo al massimo 40 per giro e le restanti arrivano alla sincronizzazione dopo
const MAX_DETTAGLI = 40;

export async function syncStravaFor(userId, { full = false } = {}) {
  const r = (await q(`SELECT * FROM integrations WHERE user_id=$1 AND provider='strava'`, [userId])).rows[0];
  if (!r) return { skipped: true };
  const { tok, rinnovato } = await strava.tokenValido(JSON.parse(leggiSegreto(r, 'Strava')));
  if (rinnovato) await q('UPDATE integrations SET secret_enc=$2 WHERE id=$1', [r.id, encrypt(JSON.stringify(tok))]);
  const dopo = full ? null : (r.last_sync_at ? new Date(new Date(r.last_sync_at).getTime() - 2 * 86400000) : null);
  const attivita = await strava.listaAttivita(tok.access_token, { dopo });
  let n = 0, dettagliChiesti = 0;
  for (const a of attivita) {
    const gia = (await q(`SELECT id FROM workouts WHERE user_id=$1 AND source='strava' AND external_id=$2`, [userId, String(a.id)])).rows[0];
    if (gia && !full) continue;
    let dettaglio = null;
    if (dettagliChiesti < MAX_DETTAGLI) {
      dettagliChiesti++;
      try { dettaglio = await strava.dettaglioAttivita(tok.access_token, a.id); } catch { /* restano i dati di riepilogo */ }
    }
    await saveWorkout(userId, strava.attivitaToWorkout(a, dettaglio));
    n++;
  }
  await q('UPDATE integrations SET last_sync_at=now() WHERE id=$1', [r.id]);
  return { imported: n, checked: attivita.length };
}

router.post('/strava/sync', wrap(async (req, res) => {
  try { res.json(await syncStravaFor(req.user.id, { full: req.body?.full === true })); }
  catch (e) {
    console.warn(`Strava sync a richiesta fallito, utente ${req.user.id}: ${e.message}`);
    res.status(502).json({ error: 'Sincronizzazione Strava fallita: ' + e.message });
  }
}));

// Sincronizzazione periodica per tutti gli utenti collegati
export async function syncAllStrava() {
  for (const r of (await q(`SELECT user_id FROM integrations WHERE provider='strava'`)).rows) {
    try { await syncStravaFor(r.user_id); } catch (e) { console.warn('Strava sync utente', r.user_id, e.message); }
  }
}

export async function syncAllKomoot() {
  for (const r of (await q(`SELECT user_id FROM integrations WHERE provider='komoot'`)).rows) {
    try { await syncKomootFor(r.user_id); } catch (e) { console.warn('Komoot sync utente', r.user_id, e.message); }
  }
}
