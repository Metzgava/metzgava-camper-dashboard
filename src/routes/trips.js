import { Router } from 'express';
import multer from 'multer';
import { q } from '../lib/db.js';
import { wrap, num } from '../lib/util.js';
import { route, geocode, poisAlongRoute } from '../lib/geo.js';
import { readCarlockFile, mergeTrips, addressCandidates, shortName } from '../lib/carlock.js';
import { requireAuth } from './auth.js';

export const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// I viaggi sono condivisi tra tutti gli utenti autorizzati (equipaggio del camper)

async function getSettings() {
  const rows = (await q('SELECT key,value FROM settings')).rows;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// Ricalcola la spesa gasolio automatica di una tappa (se non modificata a mano)
async function syncFuelExpense(legId) {
  const leg = (await q('SELECT l.*, t.fuel_price AS trip_fuel_price, t.km_per_liter FROM legs l JOIN trips t ON t.id=l.trip_id WHERE l.id=$1', [legId])).rows[0];
  if (!leg) return;
  const s = await getSettings();
  const price = num(leg.fuel_price) || num(leg.trip_fuel_price) || num(s.vehicle?.fuel_price, 1.75);
  const kml = num(leg.km_per_liter, 10) || 10;
  const liters = num(leg.distance_km) / kml;
  const amount = +(liters * price).toFixed(2);
  const meta = { km: num(leg.distance_km), km_per_liter: kml, liters: +liters.toFixed(2), price };
  const desc = `Gasolio ${leg.from_name.split(',')[0]} → ${leg.to_name.split(',')[0]} (${num(leg.distance_km)} km, ${liters.toFixed(1)} l × ${price} €/l)`;
  const ex = (await q('SELECT * FROM expenses WHERE leg_id=$1 AND auto=true', [legId])).rows[0];
  if (!ex) await q('INSERT INTO expenses(trip_id,leg_id,date,category,description,amount,auto,meta) VALUES($1,$2,$3,$4,$5,$6,true,$7)',
    [leg.trip_id, legId, leg.date || new Date(), 'gasolio', desc, amount, meta]);
  else if (!ex.edited) await q('UPDATE expenses SET amount=$2,description=$3,meta=$4,date=COALESCE($5,date) WHERE id=$1', [ex.id, amount, desc, meta, leg.date]);
}

async function tripTotals(tripId) {
  const byCat = (await q('SELECT category, sum(amount)::float AS total, count(*)::int AS n FROM expenses WHERE trip_id=$1 GROUP BY category ORDER BY total DESC', [tripId])).rows;
  const legs = (await q('SELECT coalesce(sum(distance_km),0)::float AS km, coalesce(sum(duration_min),0)::int AS minutes, count(*)::int AS n FROM legs WHERE trip_id=$1', [tripId])).rows[0];
  const fuel = (await q(`SELECT coalesce(sum((meta->>'liters')::float),0) AS liters FROM expenses WHERE trip_id=$1 AND category='gasolio' AND auto=true`, [tripId])).rows[0];
  const total = byCat.reduce((a, b) => a + b.total, 0);
  return { total: +total.toFixed(2), by_category: byCat, km: +legs.km.toFixed(1), minutes: legs.minutes, legs: legs.n, liters: +(+fuel.liters).toFixed(1), cost_per_km: legs.km ? +(total / legs.km).toFixed(3) : null };
}

// ---- impostazioni veicolo ----
router.get('/settings', wrap(async (req, res) => res.json(await getSettings())));
router.put('/settings/vehicle', wrap(async (req, res) => {
  const cur = (await getSettings()).vehicle || {};
  const v = { ...cur, length_m: num(req.body.length_m, cur.length_m || 6), km_per_liter: num(req.body.km_per_liter, 10) || 10, fuel_price: num(req.body.fuel_price, cur.fuel_price || 1.75) };
  await q(`INSERT INTO settings(key,value) VALUES('vehicle',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [v]);
  res.json(v);
}));

// ---- geocoding & anteprima percorso ----
router.get('/geocode', wrap(async (req, res) => res.json(await geocode(String(req.query.q || '')))));
router.post('/route/preview', wrap(async (req, res) => {
  const { from, to } = req.body; res.json(await route(from, to));
}));

// ---- viaggi ----
router.get('/trips', wrap(async (req, res) => {
  const trips = (await q(`SELECT t.*, u.name AS owner,
      (SELECT coalesce(sum(distance_km),0)::float FROM legs WHERE trip_id=t.id) AS km,
      (SELECT coalesce(sum(amount),0)::float FROM expenses WHERE trip_id=t.id) AS total,
      (SELECT count(*)::int FROM legs WHERE trip_id=t.id) AS n_legs,
      (SELECT count(*)::int FROM photos WHERE trip_id=t.id) AS n_photos
    FROM trips t JOIN users u ON u.id=t.user_id ORDER BY t.status='open' DESC, coalesce(t.start_date, t.created_at::date) DESC, t.id DESC`)).rows;
  res.json(trips);
}));
router.post('/trips', wrap(async (req, res) => {
  const s = await getSettings();
  const b = req.body || {};
  const row = (await q('INSERT INTO trips(user_id,title,start_date,end_date,fuel_price,km_per_liter,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.user.id, String(b.title || 'Nuovo viaggio').trim(), b.start_date || null, b.end_date || null, b.fuel_price ? num(b.fuel_price) : null, num(b.km_per_liter, s.vehicle?.km_per_liter || 10) || 10, b.notes || null])).rows[0];
  res.json(row);
}));
router.get('/trips/:id', wrap(async (req, res) => {
  const trip = (await q('SELECT t.*, u.name AS owner FROM trips t JOIN users u ON u.id=t.user_id WHERE t.id=$1', [req.params.id])).rows[0];
  if (!trip) return res.status(404).json({ error: 'Viaggio non trovato' });
  const legs = (await q('SELECT * FROM legs WHERE trip_id=$1 ORDER BY position, id', [trip.id])).rows;
  const expenses = (await q('SELECT * FROM expenses WHERE trip_id=$1 ORDER BY date DESC, id DESC', [trip.id])).rows;
  const photos = (await q('SELECT id,leg_id,filename,caption,taken_at,lat,lon,user_id FROM photos WHERE trip_id=$1 ORDER BY coalesce(taken_at,created_at)', [trip.id])).rows;
  const workouts = (await q('SELECT w.*, u.name AS athlete FROM workouts w JOIN users u ON u.id=w.user_id WHERE w.trip_id=$1 ORDER BY started_at DESC', [trip.id])).rows;
  res.json({ trip, legs, expenses, photos, workouts, totals: await tripTotals(trip.id) });
}));
router.put('/trips/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const row = (await q(`UPDATE trips SET title=coalesce($2,title), start_date=$3, end_date=$4, fuel_price=$5, km_per_liter=coalesce($6,km_per_liter), notes=$7 WHERE id=$1 RETURNING *`,
    [req.params.id, b.title, b.start_date || null, b.end_date || null, b.fuel_price ? num(b.fuel_price) : null, b.km_per_liter ? num(b.km_per_liter) : null, b.notes || null])).rows[0];
  // il prezzo del gasolio è cambiato: ricalcola le spese automatiche non modificate
  for (const l of (await q('SELECT id FROM legs WHERE trip_id=$1', [row.id])).rows) await syncFuelExpense(l.id);
  res.json(row);
}));
router.post('/trips/:id/close', wrap(async (req, res) => {
  const reopen = req.body?.reopen === true;
  const row = (await q(`UPDATE trips SET status=$2, closed_at=$3, end_date=coalesce(end_date, CURRENT_DATE) WHERE id=$1 RETURNING *`,
    [req.params.id, reopen ? 'open' : 'closed', reopen ? null : new Date()])).rows[0];
  res.json({ trip: row, totals: await tripTotals(row.id) });
}));
router.delete('/trips/:id', wrap(async (req, res) => {
  const t = (await q('SELECT user_id FROM trips WHERE id=$1', [req.params.id])).rows[0];
  if (!t) return res.status(404).json({ error: 'Non trovato' });
  if (t.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Solo chi ha creato il viaggio (o l\'admin) può eliminarlo' });
  await q('DELETE FROM trips WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));

// ---- tappe ----
router.post('/trips/:id/legs', wrap(async (req, res) => {
  const b = req.body || {};
  const from = b.from, to = b.to;
  if (!from?.lat || !to?.lat) return res.status(400).json({ error: 'Partenza e arrivo obbligatori' });
  const r = await route(from, to);
  const pos = (await q('SELECT coalesce(max(position),0)+1 AS p FROM legs WHERE trip_id=$1', [req.params.id])).rows[0].p;
  const leg = (await q(`INSERT INTO legs(trip_id,position,date,from_name,from_lat,from_lon,to_name,to_lat,to_lon,distance_km,duration_min,fuel_price,geometry,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.params.id, pos, b.date || null, from.name, from.lat, from.lon, to.name, to.lat, to.lon, r.distance_km, r.duration_min, b.fuel_price ? num(b.fuel_price) : null, JSON.stringify(r.geometry), b.notes || null])).rows[0];
  await syncFuelExpense(leg.id);
  // POI in background: non blocca la risposta
  poisAlongRoute(r.geometry).then(p => q('UPDATE legs SET pois=$2 WHERE id=$1', [leg.id, p])).catch(() => {});
  res.json({ ...leg, routing_warning: r.warning || null });
}));
router.put('/legs/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const cur = (await q('SELECT * FROM legs WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Tappa non trovata' });
  let geo = { distance_km: b.distance_km != null ? num(b.distance_km) : cur.distance_km, duration_min: cur.duration_min, geometry: cur.geometry };
  const changedPts = b.from?.lat && b.to?.lat && (b.from.lat !== cur.from_lat || b.from.lon !== cur.from_lon || b.to.lat !== cur.to_lat || b.to.lon !== cur.to_lon);
  if (changedPts) { const r = await route(b.from, b.to); geo = r; }
  const leg = (await q(`UPDATE legs SET date=$2, from_name=$3, from_lat=$4, from_lon=$5, to_name=$6, to_lat=$7, to_lon=$8, distance_km=$9, duration_min=$10, fuel_price=$11, geometry=$12, notes=$13, position=coalesce($14,position) WHERE id=$1 RETURNING *`,
    [cur.id, b.date ?? cur.date, b.from?.name ?? cur.from_name, b.from?.lat ?? cur.from_lat, b.from?.lon ?? cur.from_lon, b.to?.name ?? cur.to_name, b.to?.lat ?? cur.to_lat, b.to?.lon ?? cur.to_lon,
      geo.distance_km, geo.duration_min, b.fuel_price != null && b.fuel_price !== '' ? num(b.fuel_price) : null, JSON.stringify(geo.geometry), b.notes ?? cur.notes, b.position])).rows[0];
  await syncFuelExpense(leg.id);
  if (changedPts) poisAlongRoute(geo.geometry).then(p => q('UPDATE legs SET pois=$2 WHERE id=$1', [leg.id, p])).catch(() => {});
  res.json(leg);
}));
router.post('/legs/:id/pois', wrap(async (req, res) => {
  const cur = (await q('SELECT geometry FROM legs WHERE id=$1', [req.params.id])).rows[0];
  const p = await poisAlongRoute(cur.geometry);
  await q('UPDATE legs SET pois=$2 WHERE id=$1', [req.params.id, p]);
  res.json(p);
}));
router.delete('/legs/:id', wrap(async (req, res) => { await q('DELETE FROM legs WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// ---- import CarLock (CSV/XLSX esportato da my.carlock.co) ----
// Anteprima: POST /trips/:id/import/carlock?preview=1  -> elenco tratte senza salvare
// Import:    POST /trips/:id/import/carlock            -> crea le tappe con i km reali
router.post('/trips/:id/import/carlock', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File CarLock mancante' });
  const isNew = req.params.id === 'new'; // anteprima senza viaggio (import in un viaggio nuovo)
  const trip = isNew ? { id: null, start_date: null, end_date: null } : (await q('SELECT * FROM trips WHERE id=$1', [req.params.id])).rows[0];
  if (!trip) return res.status(404).json({ error: 'Viaggio non trovato' });
  if (isNew && !req.query.preview) return res.status(400).json({ error: 'Crea prima il viaggio' });
  const minKm = num(req.body.min_km, 3), gapMin = num(req.body.merge_gap_min, 30), onlyDates = req.body.only_trip_dates !== 'false';
  let rows;
  try { rows = readCarlockFile(req.file.buffer, req.file.originalname); } catch (e) { return res.status(400).json({ error: 'File non leggibile: ' + e.message }); }
  if (!rows.length) return res.status(400).json({ error: 'Nessun tragitto trovato nel file (colonne attese: Data, Orario di inizio, Orario di fine, Posizione di inizio, Posizione di fine, Distanza, Durata)' });
  const total = rows.length;
  if (onlyDates && (trip.start_date || trip.end_date)) rows = rows.filter(r => (!trip.start_date || r.date >= trip.start_date) && (!trip.end_date || r.date <= trip.end_date));
  const outOfRange = total - rows.length;
  let legsToAdd = mergeTrips(rows, gapMin);
  const short = legsToAdd.filter(l => l.km < minKm).length;
  legsToAdd = legsToAdd.filter(l => l.km >= minKm);
  const existing = new Set(isNew ? [] : (await q('SELECT external_id FROM legs WHERE trip_id=$1 AND external_id IS NOT NULL', [trip.id])).rows.map(r => r.external_id));
  const dupes = legsToAdd.filter(l => existing.has(l.external_id)).length;
  legsToAdd = legsToAdd.filter(l => !existing.has(l.external_id));
  const summary = { total, out_of_range: outOfRange, short, duplicates: dupes, to_import: legsToAdd.length, km: +legsToAdd.reduce((a, b) => a + b.km, 0).toFixed(1),
    first_date: legsToAdd[0]?.date || null, last_date: legsToAdd[legsToAdd.length - 1]?.date || null };
  if (req.query.preview) return res.json({ ...summary, legs: legsToAdd.map(l => ({ date: l.date, start: l.start, end: l.end, from: shortName(l.from), to: shortName(l.to), km: l.km, duration_min: l.duration_min, merged: l.merged || 1 })) });

  // geocoding con cache per indirizzo
  const cache = new Map();
  const failed = [];
  async function geo(addr) {
    if (cache.has(addr)) return cache.get(addr);
    let hit = null;
    for (const c of addressCandidates(addr)) {
      try { const r = await geocode(c); if (r.length) { hit = { name: addr.includes(',') ? `${shortName(addr)}, ${addr.split(',')[0].trim()}` : shortName(addr), lat: r[0].lat, lon: r[0].lon }; break; } } catch { }
    }
    if (!hit) failed.push(addr);
    cache.set(addr, hit);
    return hit;
  }
  let pos = (await q('SELECT coalesce(max(position),0) AS p FROM legs WHERE trip_id=$1', [trip.id])).rows[0].p;
  const created = [];
  for (const l of legsToAdd) {
    const from = await geo(l.from), to = await geo(l.to);
    if (!from || !to) continue;
    let geometry = [[from.lat, from.lon], [to.lat, to.lon]];
    try { const r = await route(from, to); geometry = r.geometry; } catch { }
    const leg = (await q(`INSERT INTO legs(trip_id,position,date,from_name,from_lat,from_lon,to_name,to_lat,to_lon,distance_km,duration_min,geometry,notes,source,external_id,start_time,end_time)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'carlock',$14,$15,$16) ON CONFLICT (trip_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING *`,
      [trip.id, ++pos, l.date, from.name, from.lat, from.lon, to.name, to.lat, to.lon, l.km, l.duration_min, JSON.stringify(geometry),
        `CarLock ${l.start}–${l.end}` + (l.merged > 1 ? ` (${l.merged} tratte unite)` : ''), l.external_id, l.start, l.end])).rows[0];
    if (leg) { await syncFuelExpense(leg.id); created.push(leg); }
  }
  // riordina le tappe per data/ora e cerca i POI in background, uno alla volta
  const all = (await q('SELECT id FROM legs WHERE trip_id=$1 ORDER BY date NULLS LAST, start_time NULLS LAST, position, id', [trip.id])).rows;
  for (let i = 0; i < all.length; i++) await q('UPDATE legs SET position=$2 WHERE id=$1', [all[i].id, i + 1]);
  (async () => { for (const leg of created) { try { await q('UPDATE legs SET pois=$2 WHERE id=$1', [leg.id, await poisAlongRoute(leg.geometry)]); } catch { } await new Promise(r => setTimeout(r, 3000)); } })();
  res.json({ ...summary, imported: created.length, geocode_failed: [...new Set(failed)], totals: await tripTotals(trip.id) });
}));

// ---- spese ----
router.post('/trips/:id/expenses', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.category || b.amount == null) return res.status(400).json({ error: 'Categoria e importo obbligatori' });
  const row = (await q('INSERT INTO expenses(trip_id,leg_id,date,category,description,amount,auto,edited) VALUES($1,$2,$3,$4,$5,$6,false,true) RETURNING *',
    [req.params.id, b.leg_id || null, b.date || new Date(), b.category, b.description || null, num(b.amount)])).rows[0];
  res.json(row);
}));
router.put('/expenses/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const row = (await q('UPDATE expenses SET date=coalesce($2,date), category=coalesce($3,category), description=coalesce($4,description), amount=coalesce($5,amount), edited=true WHERE id=$1 RETURNING *',
    [req.params.id, b.date || null, b.category || null, b.description ?? null, b.amount != null ? num(b.amount) : null])).rows[0];
  res.json(row);
}));
// Ripristina il calcolo automatico di una spesa gasolio modificata
router.post('/expenses/:id/reset', wrap(async (req, res) => {
  const ex = (await q('UPDATE expenses SET edited=false WHERE id=$1 AND auto=true RETURNING leg_id', [req.params.id])).rows[0];
  if (ex?.leg_id) await syncFuelExpense(ex.leg_id);
  res.json((await q('SELECT * FROM expenses WHERE id=$1', [req.params.id])).rows[0]);
}));
router.delete('/expenses/:id', wrap(async (req, res) => { await q('DELETE FROM expenses WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// ---- riepiloghi per periodo ----
// GET /api/summary?from=2026-01-01&to=2026-12-31&group=day|week|month|year
router.get('/summary', wrap(async (req, res) => {
  const from = req.query.from || '1970-01-01', to = req.query.to || '2999-12-31';
  const group = ['day', 'week', 'month', 'year'].includes(req.query.group) ? req.query.group : 'month';
  const tripId = req.query.trip_id ? +req.query.trip_id : null;
  const tripCond = tripId ? ' AND trip_id=$3' : '';
  const params = tripId ? [from, to, tripId] : [from, to];
  const periods = (await q(`SELECT to_char(date_trunc('${group}', date), 'YYYY-MM-DD') AS period, category, sum(amount)::float AS total
    FROM expenses WHERE date BETWEEN $1 AND $2${tripCond} GROUP BY 1,2 ORDER BY 1`, params)).rows;
  const km = (await q(`SELECT to_char(date_trunc('${group}', coalesce(date, created_at::date)), 'YYYY-MM-DD') AS period, sum(distance_km)::float AS km, count(*)::int AS legs
    FROM legs WHERE coalesce(date, created_at::date) BETWEEN $1 AND $2${tripCond} GROUP BY 1 ORDER BY 1`, params)).rows;
  const wo = (await q(`SELECT to_char(date_trunc('${group}', started_at), 'YYYY-MM-DD') AS period, count(*)::int AS n, sum(distance_m)::float/1000 AS km, sum(duration_s)::int AS seconds, sum(calories)::int AS calories, avg(hr_avg)::int AS hr_avg
    FROM workouts WHERE started_at BETWEEN $1 AND $2::date + 1${tripId ? ' AND trip_id=$3' : ''} GROUP BY 1 ORDER BY 1`, params)).rows;
  const byCat = (await q(`SELECT category, sum(amount)::float AS total FROM expenses WHERE date BETWEEN $1 AND $2${tripCond} GROUP BY 1 ORDER BY 2 DESC`, params)).rows;
  const totals = {
    spent: +byCat.reduce((a, b) => a + b.total, 0).toFixed(2),
    km: +km.reduce((a, b) => a + b.km, 0).toFixed(1),
    legs: km.reduce((a, b) => a + b.legs, 0),
    trips: (await q(`SELECT count(DISTINCT trip_id)::int AS n FROM expenses WHERE date BETWEEN $1 AND $2${tripCond}`, params)).rows[0].n,
    workouts: wo.reduce((a, b) => a + b.n, 0),
    workout_km: +wo.reduce((a, b) => a + (b.km || 0), 0).toFixed(1),
    calories: wo.reduce((a, b) => a + (b.calories || 0), 0),
  };
  res.json({ from, to, group, totals, by_category: byCat, periods, km, workouts: wo });
}));
