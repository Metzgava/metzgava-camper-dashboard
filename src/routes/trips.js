import { Router } from 'express';
import multer from 'multer';
import { q } from '../lib/db.js';
import { wrap, num } from '../lib/util.js';
import { percorsiConTappe, sannoEvitareIPedaggi, route, geocode, poisAlongRoute, linkPark4night } from '../lib/geo.js';
import { readCarlockFile, mergeTrips, addressCandidates, shortName } from '../lib/carlock.js';
import { VALUTE, valutaValida, cambioPerSpesa } from '../lib/cambi.js';
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
  const byCat = (await q('SELECT category, sum(amount * rate)::float AS total, count(*)::int AS n FROM expenses WHERE trip_id=$1 GROUP BY category ORDER BY total DESC', [tripId])).rows;
  const legs = (await q('SELECT coalesce(sum(distance_km),0)::float AS km, coalesce(sum(duration_min),0)::int AS minutes, count(*)::int AS n FROM legs WHERE trip_id=$1', [tripId])).rows[0];
  const fuel = (await q(`SELECT coalesce(sum((meta->>'liters')::float),0) AS liters FROM expenses WHERE trip_id=$1 AND category='gasolio' AND auto=true`, [tripId])).rows[0];
  const total = byCat.reduce((a, b) => a + b.total, 0);
  return { total: +total.toFixed(2), by_category: byCat, km: +legs.km.toFixed(1), minutes: legs.minutes, legs: legs.n, liters: +(+fuel.liters).toFixed(1), cost_per_km: legs.km ? +(total / legs.km).toFixed(3) : null };
}

// ---- impostazioni veicolo ----
// Impronta di cio' che esiste: la pagina la richiede ogni tanto e si ridisegna
// solo quando e' cambiata qualcosa, invece di rifare tutto a vuoto o di aspettare
// che sia l'utente a ricaricare. Sono conteggi su tabelle piccole: costa nulla.
// Casa non e' un posto dove si cerca dove dormire: le soste intorno a casa non
// servono a nessuno. Il nome e' modificabile, cosi' vale anche se traslocate.
const CASA_PREDEFINITA = 'Susegana';
const nomeCasa = s => String(s?.casa || CASA_PREDEFINITA).trim();
const eCasa = (nome, casa) => !!nome && !!casa && String(nome).toLowerCase().includes(casa.toLowerCase());

router.put('/settings/casa', wrap(async (req, res) => {
  const casa = String(req.body?.casa || '').trim().slice(0, 80) || CASA_PREDEFINITA;
  await q(`INSERT INTO settings(key,value) VALUES('casa',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(casa)]);
  res.json({ casa });
}));

router.get('/valute', wrap(async (req, res) => res.json(VALUTE)));

// Il cambio di una valuta a una data: serve alla pagina per mostrare quanto fa
// in euro mentre si scrive, prima di salvare
router.get('/cambio', wrap(async (req, res) => {
  const c = await cambioPerSpesa({ currency: req.query.valuta, date: req.query.data });
  if (c.rate == null) return res.status(502).json({ error: c.avviso });
  res.json({ valuta: c.currency, cambio: c.rate });
}));

router.get('/stato', wrap(async (req, res) => {
  const r = (await q(`SELECT
      (SELECT count(*) FROM workouts)::int AS allenamenti,
      (SELECT count(*) FROM weights)::int AS pesate,
      (SELECT count(*) FROM trips)::int AS viaggi,
      (SELECT count(*) FROM legs)::int AS tappe,
      (SELECT count(*) FROM expenses)::int AS spese,
      (SELECT count(*) FROM photos)::int AS foto,
      (SELECT max(started_at) FROM workouts) AS ultimo_allenamento`)).rows[0];
  res.json(r);
}));

router.get('/settings', wrap(async (req, res) => res.json(await getSettings())));
router.put('/settings/vehicle', wrap(async (req, res) => {
  const cur = (await getSettings()).vehicle || {};
  const v = { ...cur, length_m: num(req.body.length_m, cur.length_m || 6), km_per_liter: num(req.body.km_per_liter, 10) || 10,
    fuel_price: num(req.body.fuel_price, cur.fuel_price || 1.75),
    // Tariffa autostradale al chilometro: un camper in Italia sta in classe B,
    // intorno ai nove centesimi. E' una stima, e resta modificabile
    toll_per_km: num(req.body.toll_per_km, cur.toll_per_km ?? 0.09) };
  await q(`INSERT INTO settings(key,value) VALUES('vehicle',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [v]);
  res.json(v);
}));

// ---- geocoding & anteprima percorso ----
router.get('/geocode', wrap(async (req, res) => res.json(await geocode(String(req.query.q || '')))));
router.post('/route/preview', wrap(async (req, res) => {
  const { from, to } = req.body; res.json(await route(from, to));
}));

// Le varianti di percorso fra partenza, soste intermedie e arrivo, con il costo
// del gasolio gia' stimato: e' il numero su cui si decide quale strada fare.
router.post('/route/opzioni', wrap(async (req, res) => {
  const punti = (req.body?.punti || []).filter(p => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon))
    .map(p => ({ name: String(p.name || '').slice(0, 200), lat: +p.lat, lon: +p.lon }));
  if (punti.length < 2) return res.status(400).json({ error: 'Servono almeno partenza e arrivo' });
  if (punti.length > 12) return res.status(400).json({ error: 'Troppe tappe: al massimo dodici punti' });
  const s = await getSettings();
  const kmL = num(req.body?.km_per_liter, s.vehicle?.km_per_liter || 10) || 10;
  const prezzo = num(req.body?.fuel_price, s.vehicle?.fuel_price || 1.75);
  const tariffa = num(req.body?.toll_per_km, s.vehicle?.toll_per_km ?? 0.09);
  const varianti = (await percorsiConTappe(punti)).map(v => ({
    ...v,
    litri: +(v.distance_km / kmL).toFixed(1),
    gasolio: +(v.distance_km / kmL * prezzo).toFixed(2),
    // Dei pedaggi si conoscono i chilometri, non la tariffa: il costo e' una stima
    pedaggio: v.pedaggio_km != null ? +(v.pedaggio_km * tariffa).toFixed(2) : null,
  }));
  res.json({ varianti, km_per_liter: kmL, fuel_price: prezzo, toll_per_km: tariffa, pedaggi_evitabili: sannoEvitareIPedaggi() });
}));

// ---- viaggi ----
// Un allenamento appartiene al viaggio nelle cui date ricade. Il confronto usa
// l'ora italiana: un'attivita' di tarda sera non deve finire nel giorno dopo.
const NEL_PERIODO = `t.start_date IS NOT NULL
  AND (w.started_at AT TIME ZONE 'Europe/Rome')::date >= t.start_date
  AND ((t.end_date IS NOT NULL AND (w.started_at AT TIME ZONE 'Europe/Rome')::date <= t.end_date)
       OR (t.end_date IS NULL AND t.status = 'open'))`;

// Aggancia al viaggio gli allenamenti ancora liberi che cadono nel suo periodo.
// Restano esclusi quelli con un viaggio gia' assegnato e quelli che l'utente ha
// deciso a mano, compreso chi ha scelto di lasciarli senza viaggio.
export async function agganciaAllenamenti() {
  const r = await q(`UPDATE workouts w SET trip_id = (
      SELECT t.id FROM trips t WHERE ${NEL_PERIODO}
      ORDER BY (t.status = 'open') DESC, t.start_date DESC LIMIT 1)
    WHERE w.trip_id IS NULL AND NOT w.trip_manual AND EXISTS (SELECT 1 FROM trips t WHERE ${NEL_PERIODO})`);
  if (r.rowCount) console.log(`agganciati ${r.rowCount} allenamenti ai viaggi corrispondenti`);
  return r.rowCount;
}

router.get('/trips', wrap(async (req, res) => {
  const trips = (await q(`SELECT t.*, u.name AS owner,
      (SELECT coalesce(sum(distance_km),0)::float FROM legs WHERE trip_id=t.id) AS km,
      (SELECT coalesce(sum(amount * rate),0)::float FROM expenses WHERE trip_id=t.id) AS total,
      (SELECT count(*)::int FROM legs WHERE trip_id=t.id) AS n_legs,
      (SELECT count(*)::int FROM photos WHERE trip_id=t.id) AS n_photos,
      (SELECT count(*)::int FROM workouts WHERE trip_id=t.id AND meta->'copiato_da' IS NULL) AS n_workouts,
      -- La copertina della scheda: la prima foto del viaggio, per data di scatto
      (SELECT filename FROM photos WHERE trip_id=t.id ORDER BY taken_at NULLS LAST, id LIMIT 1) AS cover
    FROM trips t JOIN users u ON u.id=t.user_id ORDER BY t.status='open' DESC, coalesce(t.start_date, t.created_at::date) DESC, t.id DESC`)).rows;
  // Mete e forma dell'itinerario per la scheda. Si prendono i soli estremi delle
  // tappe, non le geometrie: quelle di CarLock pesano quanto tutto il resto e
  // qui basta il profilo del viaggio, non il tracciato metro per metro.
  const tappe = (await q('SELECT trip_id, from_name, from_lat, from_lon, to_name, to_lat, to_lon FROM legs ORDER BY trip_id, position, id')).rows;
  const perViaggio = new Map();
  for (const l of tappe) {
    if (!perViaggio.has(l.trip_id)) perViaggio.set(l.trip_id, { mete: [], rotta: [] });
    const v = perViaggio.get(l.trip_id);
    for (const [nome, lat, lon] of [[l.from_name, l.from_lat, l.from_lon], [l.to_name, l.to_lat, l.to_lon]]) {
      const breve = String(nome || '').split(',')[0].trim();
      if (breve && breve !== v.mete[v.mete.length - 1]) v.mete.push(breve);
      if (lat != null && lon != null) v.rotta.push([lat, lon]);
    }
  }
  res.json(trips.map(t => ({ ...t, ...(perViaggio.get(t.id) || { mete: [], rotta: [] }) })));
}));
router.post('/trips', wrap(async (req, res) => {
  const s = await getSettings();
  const b = req.body || {};
  const row = (await q('INSERT INTO trips(user_id,title,start_date,end_date,fuel_price,km_per_liter,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.user.id, String(b.title || 'Nuovo viaggio').trim(), b.start_date || null, b.end_date || null, b.fuel_price ? num(b.fuel_price) : null, num(b.km_per_liter, s.vehicle?.km_per_liter || 10) || 10, b.notes || null])).rows[0];
  // Se il viaggio nasce da un percorso gia' scelto, le tappe si creano subito:
  // le tratte arrivano calcolate da /route/opzioni e non si ricalcola nulla
  const tratte = Array.isArray(b.percorso?.tratte) ? b.percorso.tratte : [];
  let pos = 0;
  for (const t of tratte) {
    if (!t?.from?.lat || !t?.to?.lat) continue;
    const leg = (await q(`INSERT INTO legs(trip_id,position,date,from_name,from_lat,from_lon,to_name,to_lat,to_lon,distance_km,duration_min,geometry)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, geometry`,
      [row.id, ++pos, t.date || null, t.from.name || 'Partenza', t.from.lat, t.from.lon, t.to.name || 'Arrivo', t.to.lat, t.to.lon,
        num(t.distance_km), Math.round(num(t.duration_min)), JSON.stringify(t.geometry || null)])).rows[0];
    await syncFuelExpense(leg.id);
    cercaSosteArrivo(leg.id, t.to.name, t.to.lat, t.to.lon).catch(e => console.warn('soste all\u2019arrivo:', e.message));
  }
  // Il pedaggio stimato nasce come spesa automatica, come il gasolio: quando
  // arriva il conto vero basta modificarla e non viene piu' ricalcolata
  const pedaggio = num(b.percorso?.pedaggio);
  if (tratte.length && pedaggio > 0) {
    await q(`INSERT INTO expenses(trip_id,date,category,description,amount,auto,meta)
             VALUES($1,$2,'pedaggi',$3,$4,true,$5)`,
      [row.id, row.start_date || new Date(), `Pedaggi stimati su ${num(b.percorso?.pedaggio_km)} km di autostrada`, pedaggio,
        JSON.stringify({ stimato: true, pedaggio_km: num(b.percorso?.pedaggio_km) })]);
  }
  if (tratte.length) console.log(`viaggio ${row.id}: create ${pos} tappe dal percorso \u00ab${b.percorso?.nome || '?'}\u00bb`);
  await agganciaAllenamenti();
  res.json({ ...row, tappe_create: pos });
}));
router.get('/trips/:id', wrap(async (req, res) => {
  const trip = (await q('SELECT t.*, u.name AS owner FROM trips t JOIN users u ON u.id=t.user_id WHERE t.id=$1', [req.params.id])).rows[0];
  if (!trip) return res.status(404).json({ error: 'Viaggio non trovato' });
  const legs = (await q('SELECT * FROM legs WHERE trip_id=$1 ORDER BY position, id', [trip.id])).rows;
  const expenses = (await q('SELECT * FROM expenses WHERE trip_id=$1 ORDER BY date DESC, id DESC', [trip.id])).rows;
  const photos = (await q('SELECT id,leg_id,filename,caption,taken_at,lat,lon,user_id FROM photos WHERE trip_id=$1 ORDER BY coalesce(taken_at,created_at)', [trip.id])).rows;
  // Le copie fatte su un altro atleta rappresentano la stessa uscita gia' elencata:
  // contarle o mostrarle qui raddoppierebbe attivita' e chilometri del viaggio
  const workouts = (await q(`SELECT w.*, u.name AS athlete FROM workouts w JOIN users u ON u.id=w.user_id
    WHERE w.trip_id=$1 AND w.meta->'copiato_da' IS NULL ORDER BY started_at DESC`, [trip.id])).rows;
  const soste = (await q('SELECT * FROM stops WHERE trip_id=$1 ORDER BY from_date NULLS LAST, id', [trip.id])).rows;
  res.json({ trip, legs, expenses, photos, workouts, soste, totals: await tripTotals(trip.id) });
}));
router.put('/trips/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const row = (await q(`UPDATE trips SET title=coalesce($2,title), start_date=$3, end_date=$4, fuel_price=$5, km_per_liter=coalesce($6,km_per_liter), notes=$7 WHERE id=$1 RETURNING *`,
    [req.params.id, b.title, b.start_date || null, b.end_date || null, b.fuel_price ? num(b.fuel_price) : null, b.km_per_liter ? num(b.km_per_liter) : null, b.notes || null])).rows[0];
  // il prezzo del gasolio è cambiato: ricalcola le spese automatiche non modificate
  for (const l of (await q('SELECT id FROM legs WHERE trip_id=$1', [row.id])).rows) await syncFuelExpense(l.id);
  await agganciaAllenamenti();
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
// Cerca i posti dove fermarsi intorno all'arrivo di una tappa e li salva. E' la
// stessa cosa che fa il pulsante, e gira da sola quando la tappa nasce o cambia
// destinazione: cosi' quando la si apre il risultato e' gia' li'.
const RAGGIO_SOSTE = 5000;
async function cercaSosteArrivo(legId, nome, lat, lon) {
  const casa = nomeCasa(await getSettings());
  if (eCasa(nome, casa)) {
    await q('UPDATE legs SET pois=$2 WHERE id=$1', [legId, { stops: [], villages: [], raggio: RAGGIO_SOSTE, casa: true, cercato_il: new Date().toISOString() }]);
    return;
  }
  const p = await poisAlongRoute([[lat, lon]], RAGGIO_SOSTE);
  await q('UPDATE legs SET pois=$2 WHERE id=$1', [legId, {
    ...p, raggio: RAGGIO_SOSTE, cercato_il: p.warning ? null : new Date().toISOString(),
    stops: (p.stops || []).map(x => ({ ...x, park4night: linkPark4night(x.lat, x.lon) })),
  }]);
}

// ---------- dove ci fermiamo ----------
// I luoghi lungo il percorso arrivano da OpenStreetMap in un raggio che si
// sceglie; per ciascuno si da' l'indirizzo che apre park4night centrato li',
// perche' le recensioni e le foto stanno la' e non si importano.
router.get('/trips/:id/vicinanze', wrap(async (req, res) => {
  const raggio = Math.min(Math.max(1000, Number(req.query.raggio) || 5000), 50000);
  const legs = (await q('SELECT id, to_name, to_lat, to_lon FROM legs WHERE trip_id=$1 ORDER BY position, id', [req.params.id])).rows;
  if (!legs.length) return res.json({ raggio, luoghi: [], avviso: 'Il viaggio non ha ancora tappe' });
  // Le destinazioni, non la strada: ci si ferma dove si arriva. Casa esclusa,
  // che di aree sosta non ne serve. Niente borghi: qui si cerca dove dormire.
  const casa = nomeCasa(await getSettings());
  const mete = legs.filter(l => !eCasa(l.to_name, casa) && l.to_lat != null).map(l => [l.to_lat, l.to_lon]);
  if (!mete.length) return res.json({ raggio, luoghi: [], avviso: `Le tappe arrivano tutte a ${casa}: non c\u2019e\u2019 niente da cercare` });
  const r = await poisAlongRoute(mete, raggio, { conBorghi: false });
  const luoghi = (r.stops || []).map(p => ({ ...p, park4night: linkPark4night(p.lat, p.lon) }));
  res.json({ raggio, luoghi, borghi: r.villages || [], avviso: r.warning || null });
}));

router.get('/trips/:id/soste', wrap(async (req, res) => {
  res.json((await q('SELECT * FROM stops WHERE trip_id=$1 ORDER BY from_date NULLS LAST, id', [req.params.id])).rows);
}));

// Un'ora deve esistere davvero: 25:99 passava il controllo sulla forma
// I tipi di sosta. «altro» porta con se' il nome scritto a mano, gli altri no:
// se si cambia tipo, l'etichetta libera se ne va con lui.
const TIPI_SOSTA = ['sosta', 'infratto', 'area_sosta', 'camping', 'appartamento', 'altro'];
const tipoSosta = v => TIPI_SOSTA.includes(String(v || '')) ? String(v) : 'area_sosta';

const oraValida = v => {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${String(+m[1]).padStart(2, '0')}:${m[2]}`;
};
const datiSosta = b => ({
  name: String(b?.name || '').trim().slice(0, 200),
  lat: b?.lat != null && b.lat !== '' ? num(b.lat) : null,
  lon: b?.lon != null && b.lon !== '' ? num(b.lon) : null,
  kind: tipoSosta(b?.kind),
  kind_label: tipoSosta(b?.kind) === 'altro' ? (String(b?.kind_label || '').trim().slice(0, 60) || null) : null,
  from_date: b?.from_date || null,
  to_date: b?.to_date || null,
  arrival_time: oraValida(b?.arrival_time),
  departure_time: oraValida(b?.departure_time),
  // Le stelle si tolgono rimettendo zero: vuoto vuol dire «non l'ho giudicata»
  stars: b?.stars === '' || b?.stars == null ? null : Math.min(5, Math.max(0, Math.round(num(b.stars)))) || null,
  cost: b?.cost === '' || b?.cost == null ? null : num(b.cost),
  currency: valutaValida(b?.currency),
  notes: b?.notes || null,
  link: String(b?.link || '').trim().slice(0, 500) || null,
  source: b?.source === 'osm' ? 'osm' : 'manuale',
});

router.post('/trips/:id/soste', wrap(async (req, res) => {
  const d = datiSosta(req.body);
  if (!d.name) return res.status(400).json({ error: 'Serve il nome del posto' });
  if (d.to_date && d.from_date && d.to_date < d.from_date) return res.status(400).json({ error: 'La data di fine viene prima di quella di inizio' });
  // Il collegamento a park4night si costruisce da se' quando ci sono le coordinate
  const link = d.link || (d.lat != null && d.lon != null ? linkPark4night(d.lat, d.lon) : null);
  const c = await cambioPerSpesa({ currency: d.currency, rate: req.body?.rate, date: d.from_date });
  const r = (await q(`INSERT INTO stops(trip_id,leg_id,name,lat,lon,kind,kind_label,from_date,to_date,arrival_time,departure_time,stars,cost,currency,rate,notes,link,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [req.params.id, req.body?.leg_id || null, d.name, d.lat, d.lon, d.kind, d.kind_label, d.from_date, d.to_date,
      d.arrival_time, d.departure_time, d.stars, d.cost, c.currency, c.rate ?? 1, d.notes, link, d.source])).rows[0];
  res.json(r);
}));

router.put('/soste/:id', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM stops WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Sosta non trovata' });
  const d = datiSosta({ ...cur, ...req.body });
  if (d.to_date && d.from_date && d.to_date < d.from_date) return res.status(400).json({ error: 'La data di fine viene prima di quella di inizio' });
  const rifare = d.currency !== cur.currency || String(d.from_date || '') !== String(cur.from_date || '').slice(0, 10);
  const c = rifare ? await cambioPerSpesa({ currency: d.currency, rate: req.body?.rate, date: d.from_date }) : { currency: cur.currency, rate: cur.rate };
  const r = (await q(`UPDATE stops SET name=$2, lat=$3, lon=$4, kind=$5, kind_label=$6, from_date=$7, to_date=$8,
      arrival_time=$9, departure_time=$10, stars=$11, cost=$12, currency=$13, rate=$14, notes=$15, link=$16 WHERE id=$1 RETURNING *`,
    [cur.id, d.name, d.lat, d.lon, d.kind, d.kind_label, d.from_date, d.to_date, d.arrival_time, d.departure_time, d.stars, d.cost,
      c.currency, c.rate ?? 1, d.notes,
      d.link || (d.lat != null && d.lon != null ? linkPark4night(d.lat, d.lon) : null)])).rows[0];
  res.json(r);
}));

// Il costo di una sosta non entra nei totali finche' non lo si dice: con questo
// diventa una spesa vera, nella categoria giusta, e la sosta se ne ricorda per
// non farlo due volte.
router.post('/soste/:id/spesa', wrap(async (req, res) => {
  const s = (await q('SELECT * FROM stops WHERE id=$1', [req.params.id])).rows[0];
  if (!s) return res.status(404).json({ error: 'Sosta non trovata' });
  if (!(num(s.cost) > 0)) return res.status(400).json({ error: 'Questa sosta non ha un costo' });
  if (s.meta?.spesa_id) {
    const gia = (await q('SELECT id FROM expenses WHERE id=$1', [s.meta.spesa_id])).rows[0];
    if (gia) return res.status(409).json({ error: 'Il costo di questa sosta e\u2019 gia\u2019 fra le spese' });
  }
  const categoria = s.kind === 'camping' ? 'campeggio' : s.kind === 'appartamento' ? 'altro' : 'area_sosta';
  const notti = (s.from_date && s.to_date) ? Math.max(0, Math.round((new Date(s.to_date) - new Date(s.from_date)) / 86400000)) : 0;
  const spesa = (await q(`INSERT INTO expenses(trip_id,date,category,description,amount,currency,rate,auto,edited)
    VALUES($1,$2,$3,$4,$5,$6,$7,false,true) RETURNING *`,
    [s.trip_id, s.from_date || new Date(), categoria,
      `${s.name}${notti ? ` (${notti} ${notti === 1 ? 'notte' : 'notti'})` : ''}`, s.cost, s.currency, s.rate])).rows[0];
  await q(`UPDATE stops SET meta = coalesce(meta,'{}')::jsonb || jsonb_build_object('spesa_id', $2::int) WHERE id=$1`, [s.id, spesa.id]);
  res.json(spesa);
}));

router.delete('/soste/:id', wrap(async (req, res) => {
  await q('DELETE FROM stops WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));

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
  cercaSosteArrivo(leg.id, to.name, to.lat, to.lon).catch(e => console.warn('soste all\u2019arrivo:', e.message));
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
  if (changedPts) cercaSosteArrivo(leg.id, leg.to_name, leg.to_lat, leg.to_lon).catch(e => console.warn('soste all\u2019arrivo:', e.message));
  res.json(leg);
}));
router.post('/legs/:id/pois', wrap(async (req, res) => {
  const cur = (await q('SELECT to_name, to_lat, to_lon FROM legs WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Tappa non trovata' });
  // Cinque chilometri dall'arrivo: piu' in la' non e' piu' "dove siamo arrivati",
  // e' un altro posto. Si puo' allargare dalla finestra quando serve.
  const raggio = Math.min(Math.max(1000, Number(req.query.raggio) || 5000), 50000);
  // Solo intorno all'arrivo, non lungo tutta la strada: e' li' che ci si ferma,
  // e una richiesta con un centro solo il servizio la serve sempre
  const casa = nomeCasa(await getSettings());
  if (eCasa(cur.to_name, casa)) {
    const vuoto = { stops: [], villages: [], raggio, casa: true };
    await q('UPDATE legs SET pois=$2 WHERE id=$1', [req.params.id, vuoto]);
    return res.json(vuoto);
  }
  const p = await poisAlongRoute([[cur.to_lat, cur.to_lon]], raggio);
  // Si segna quando la ricerca e' andata a buon fine: «nessuna sosta qui intorno»
  // e' una risposta, e non va ripetuta a ogni apertura come se fosse un vuoto
  const conLink = { ...p, raggio, cercato_il: p.warning ? null : new Date().toISOString(),
    stops: (p.stops || []).map(x => ({ ...x, park4night: linkPark4night(x.lat, x.lon) })) };
  await q('UPDATE legs SET pois=$2 WHERE id=$1', [req.params.id, conLink]);
  res.json(conLink);
}));
router.delete('/legs/:id', wrap(async (req, res) => { await q('DELETE FROM legs WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// ---- suddivisione di un viaggio in viaggi "casa → casa" ----
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const fmtD = d => { const [y, m, g] = String(d).slice(0, 10).split('-'); return `${+g} ${MESI[+m - 1]}`; };
const townOf = name => String(name || '').split(',')[0].trim();
const isHome = (name, home) => !!home && String(name || '').toLowerCase().includes(home.toLowerCase());

export async function splitTripByHome(tripId, home, userId) {
  const orig = (await q('SELECT * FROM trips WHERE id=$1', [tripId])).rows[0];
  if (!orig) throw Object.assign(new Error('Viaggio non trovato'), { status: 404 });
  const legs = (await q('SELECT * FROM legs WHERE trip_id=$1 ORDER BY date NULLS LAST, start_time NULLS LAST, position, id', [tripId])).rows;
  if (legs.length < 2) return { created: [], kept: orig };
  // gruppi: un gruppo si chiude quando una tappa arriva a casa
  const groups = []; let cur = [];
  for (const l of legs) {
    if (cur.length && isHome(l.from_name, home) && !isHome(cur[cur.length - 1].to_name, home) && cur.every(x => !isHome(x.from_name, home))) { groups.push(cur); cur = []; }
    cur.push(l);
    if (isHome(l.to_name, home)) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  if (groups.length < 2) return { created: [], kept: orig, reason: 'nessun rientro a casa trovato nelle tappe' };
  const created = [];
  for (const g of groups) {
    const towns = [...new Set(g.map(l => townOf(l.to_name)).filter(t => !isHome(t, home)))];
    const dest = towns.length > 3 ? `${towns[0]} … ${towns[towns.length - 1]}` : towns.join(' · ');
    const d1 = g[0].date, d2 = g[g.length - 1].date;
    const title = `${fmtD(d1)}${d2 !== d1 ? '–' + fmtD(d2) : ''} ${String(d2).slice(0, 4)} · ${dest || 'giro'}`;
    const t = (await q('INSERT INTO trips(user_id,title,start_date,end_date,status,fuel_price,km_per_liter,closed_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [userId || orig.user_id, title, d1, d2, orig.status, orig.fuel_price, orig.km_per_liter, orig.status === 'closed' ? new Date() : null, orig.notes])).rows[0];
    const ids = g.map(l => l.id);
    for (let i = 0; i < ids.length; i++) await q('UPDATE legs SET trip_id=$2, position=$3 WHERE id=$1', [ids[i], t.id, i + 1]);
    await q('UPDATE expenses SET trip_id=$2 WHERE leg_id = ANY($1)', [ids, t.id]);
    await q('UPDATE photos SET trip_id=$2 WHERE leg_id = ANY($1)', [ids, t.id]);
    // spese e foto senza tappa: per data
    await q('UPDATE expenses SET trip_id=$2 WHERE trip_id=$1 AND leg_id IS NULL AND date BETWEEN $3 AND $4', [tripId, t.id, d1, d2]);
    await q('UPDATE photos SET trip_id=$2 WHERE trip_id=$1 AND leg_id IS NULL AND taken_at::date BETWEEN $3 AND $4', [tripId, t.id, d1, d2]);
    await q('UPDATE workouts SET trip_id=$2 WHERE trip_id=$1 AND started_at::date BETWEEN $3 AND $4', [tripId, t.id, d1, d2]);
    created.push({ ...t, legs: g.length, km: +g.reduce((a, l) => a + num(l.distance_km), 0).toFixed(1) });
  }
  const left = (await q('SELECT (SELECT count(*) FROM legs WHERE trip_id=$1)+(SELECT count(*) FROM expenses WHERE trip_id=$1)+(SELECT count(*) FROM photos WHERE trip_id=$1) AS n', [tripId])).rows[0].n;
  let kept = orig;
  if (+left === 0) { await q('DELETE FROM trips WHERE id=$1', [tripId]); kept = null; }
  return { created, kept };
}

router.post('/trips/:id/split', wrap(async (req, res) => {
  const home = String(req.body?.home || 'Susegana').trim();
  const r = await splitTripByHome(+req.params.id, home, req.user.id);
  res.json({ home, ...r });
}));

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
  // Con «sostituisci» le tappe previste lasciano il posto a quelle davvero
  // percorse: si tolgono solo quelle pianificate, riconoscibili perche' non
  // hanno un identificativo CarLock, e con loro il gasolio che era stimato
  const sostituisci = !isNew && !req.query.preview && (req.body.sostituisci === 'true' || req.body.sostituisci === true);
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

  if (sostituisci) {
    // Prima il gasolio stimato di quelle tappe, poi le tappe: al contrario la
    // spesa resterebbe orfana e il totale conterebbe due volte lo stesso viaggio
    const previste = (await q('SELECT id FROM legs WHERE trip_id=$1 AND external_id IS NULL', [trip.id])).rows.map(r => r.id);
    if (previste.length) {
      const spese = await q(`DELETE FROM expenses WHERE trip_id=$1 AND leg_id = ANY($2::int[]) AND category='gasolio' AND auto=true AND NOT edited`,
        [trip.id, previste]);
      await q('DELETE FROM legs WHERE id = ANY($1::int[])', [previste]);
      console.log(`viaggio ${trip.id}: tolte ${previste.length} tappe previste e ${spese.rowCount} stime di gasolio, al loro posto il percorso reale`);
    }
  }

  // geocoding con cache per indirizzo
  const cache = new Map();
  const failed = [], errors = new Map();
  async function geo(addr) {
    if (cache.has(addr)) return cache.get(addr);
    let hit = null;
    for (const c of addressCandidates(addr)) {
      try {
        const r = await geocode(c);
        if (r.length) { hit = { name: addr.includes(',') ? `${shortName(addr)}, ${addr.split(',')[0].trim()}` : shortName(addr), lat: r[0].lat, lon: r[0].lon }; break; }
      } catch (e) { errors.set(String(e.message).slice(0, 160), (errors.get(String(e.message).slice(0, 160)) || 0) + 1); }
      await new Promise(r => setTimeout(r, 250)); // non martellare i geocoder gratuiti
    }
    if (!hit) { failed.push(addr); console.warn('CarLock: indirizzo non geocodificato:', addr); }
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
  (async () => { for (const leg of created) { try { await cercaSosteArrivo(leg.id, leg.to_name, leg.to_lat, leg.to_lon); } catch { } await new Promise(r => setTimeout(r, 3000)); } })();
  if (errors.size) console.warn('CarLock: errori geocoder', Object.fromEntries(errors));
  let split = null;
  if (req.body.split_home && created.length) split = await splitTripByHome(trip.id, String(req.body.split_home).trim(), req.user.id);
  res.json({ ...summary, imported: created.length, geocode_failed: [...new Set(failed)], geocode_errors: [...errors.keys()], split, totals: split?.kept === null ? null : await tripTotals(trip.id) });
}));

// ---- spese ----
router.post('/trips/:id/expenses', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.category || b.amount == null) return res.status(400).json({ error: 'Categoria e importo obbligatori' });
  // L'importo resta nella valuta in cui e' stato speso; accanto si congela il
  // cambio del giorno, ed e' quello a fare i totali
  const c = await cambioPerSpesa({ currency: b.currency, rate: b.rate, date: b.date });
  if (c.rate == null) return res.status(502).json({ error: c.avviso });
  const row = (await q(`INSERT INTO expenses(trip_id,leg_id,date,category,description,amount,currency,rate,auto,edited)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,true) RETURNING *`,
    [req.params.id, b.leg_id || null, b.date || new Date(), b.category, b.description || null, num(b.amount), c.currency, c.rate])).rows[0];
  res.json(row);
}));
router.put('/expenses/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const cur = (await q('SELECT * FROM expenses WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Spesa non trovata' });
  // Il cambio si rifa' solo se cambia la valuta o la data: altrimenti resta
  // quello con cui la spesa e' nata
  const valuta = b.currency ? valutaValida(b.currency) : cur.currency;
  const data = b.date || cur.date;
  const rifare = valuta !== cur.currency || String(data).slice(0, 10) !== String(cur.date).slice(0, 10) || b.rate != null;
  const c = rifare ? await cambioPerSpesa({ currency: valuta, rate: b.rate, date: data }) : { currency: cur.currency, rate: cur.rate };
  if (c.rate == null) return res.status(502).json({ error: c.avviso });
  const row = (await q(`UPDATE expenses SET date=coalesce($2,date), category=coalesce($3,category), description=coalesce($4,description),
      amount=coalesce($5,amount), currency=$6, rate=$7, edited=true WHERE id=$1 RETURNING *`,
    [req.params.id, b.date || null, b.category || null, b.description ?? null, b.amount != null ? num(b.amount) : null, c.currency, c.rate])).rows[0];
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
  const periods = (await q(`SELECT to_char(date_trunc('${group}', date), 'YYYY-MM-DD') AS period, category, sum(amount * rate)::float AS total
    FROM expenses WHERE date BETWEEN $1 AND $2${tripCond} GROUP BY 1,2 ORDER BY 1`, params)).rows;
  const km = (await q(`SELECT to_char(date_trunc('${group}', coalesce(date, created_at::date)), 'YYYY-MM-DD') AS period, sum(distance_km)::float AS km, count(*)::int AS legs
    FROM legs WHERE coalesce(date, created_at::date) BETWEEN $1 AND $2${tripCond} GROUP BY 1 ORDER BY 1`, params)).rows;
  // Gli allenamenti si possono restringere a un atleta: con piu' atleti in casa, e
  // con le copie di uno stesso giro su entrambi, sommarli gonfierebbe i totali
  const atleta = req.query.user_id ? +req.query.user_id : null;
  const paramsWo = [...params];
  let condWo = tripId ? ' AND trip_id=$3' : '';
  if (atleta) { paramsWo.push(atleta); condWo += ` AND user_id=$${paramsWo.length}`; }
  const wo = (await q(`SELECT to_char(date_trunc('${group}', started_at), 'YYYY-MM-DD') AS period, count(*)::int AS n, sum(distance_m)::float/1000 AS km, sum(duration_s)::int AS seconds, sum(calories)::int AS calories, avg(hr_avg)::int AS hr_avg
    FROM workouts WHERE started_at BETWEEN $1 AND $2::date + 1${condWo} GROUP BY 1 ORDER BY 1`, paramsWo)).rows;
  const byCat = (await q(`SELECT category, sum(amount * rate)::float AS total FROM expenses WHERE date BETWEEN $1 AND $2${tripCond} GROUP BY 1 ORDER BY 2 DESC`, params)).rows;
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
