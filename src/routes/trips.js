import { Router } from 'express';
import multer from 'multer';
import { q } from '../lib/db.js';
import { wrap, num, haversineKm } from '../lib/util.js';
import { percorsiConTappe, sannoEvitareIPedaggi, route, geocode, poisAlongRoute, linkPark4night, numeroPark4night, linkPark4nightPosto, percorsoVicinoAiKm } from '../lib/geo.js';
import { readCarlockFile, mergeTrips, addressCandidates, shortName, nomeTappa } from '../lib/carlock.js';
import { puntiDaLinkMaps, seguiLinkBreve } from '../lib/maps.js';
import { VALUTE, valutaValida, cambioPerSpesa } from '../lib/cambi.js';
import { requireAuth } from './auth.js';
import { materialiDi } from './materiali.js';

export const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// I viaggi sono condivisi tra tutti gli utenti autorizzati (equipaggio del camper)

async function getSettings() {
  const rows = (await q('SELECT key,value FROM settings')).rows;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// Una tappa non si fa per forza in camper: il traghetto, l'aereo e il treno
// hanno un biglietto invece del gasolio, e i loro chilometri non si guidano.
// La categoria della spesa e' quella del mezzo, cosi' nei riepiloghi il
// traghetto sta col traghetto e non in un calderone.
export const MEZZI = {
  camper: { nome: 'In camper', icona: '\ud83d\ude90' },
  traghetto: { nome: 'Traghetto', icona: '\u26f4\ufe0f', categoria: 'traghetto' },
  aereo: { nome: 'Aereo', icona: '\u2708\ufe0f', categoria: 'aereo' },
  treno: { nome: 'Treno', icona: '\ud83d\ude86', categoria: 'treno' },
  bus: { nome: 'Bus', icona: '\ud83d\ude8c', categoria: 'bus' },
};
const mezzoValido = m => Object.prototype.hasOwnProperty.call(MEZZI, String(m || '')) ? String(m) : 'camper';
const testoCorto = (v, n) => { const t = String(v ?? '').trim(); return t ? t.slice(0, n) : null; };
// Quello che si sa del viaggio altrui: chi lo fa, con che numero, a che ora,
// quanto costa, a quali condizioni e con quale sconto
const datiMezzo = b => ({
  mezzo: mezzoValido(b?.mezzo),
  compagnia: testoCorto(b?.compagnia, 120),
  codice: testoCorto(b?.codice, 60),
  tariffa: b?.tariffa === '' || b?.tariffa == null ? null : num(b.tariffa),
  tariffa_currency: valutaValida(b?.tariffa_currency),
  condizioni: testoCorto(b?.condizioni, 2000),
  sconto: testoCorto(b?.sconto, 300),
  start_time: oraValida(b?.start_time),
  end_time: oraValida(b?.end_time),
});
const inCamper = l => mezzoValido(l?.mezzo) === 'camper';

// Il biglietto di una tappa fatta con un mezzo altrui: compagnia, numero e
// tariffa diventano una spesa del viaggio, come il gasolio per il camper.
// Condizioni e sconti restano sulla tappa: servono a chi parte, non ai conti.
async function syncTariffaSpesa(legId) {
  const leg = (await q('SELECT * FROM legs WHERE id=$1', [legId])).rows[0];
  if (!leg) return;
  const categoria = MEZZI[mezzoValido(leg.mezzo)].categoria;
  const ex = (await q(`SELECT * FROM expenses WHERE leg_id=$1 AND auto=true AND category NOT IN ('gasolio','pedaggi')`, [legId])).rows[0];
  const importo = num(leg.tariffa);
  if (!categoria || leg.senza_tariffa || !(importo > 0)) {
    if (ex && !ex.edited) await q('DELETE FROM expenses WHERE id=$1', [ex.id]);
    return;
  }
  const dove = `${leg.from_name.split(',')[0]} \u2192 ${leg.to_name.split(',')[0]}`;
  const chi = [leg.compagnia, leg.codice].filter(Boolean).join(' ') || MEZZI[mezzoValido(leg.mezzo)].nome;
  const c = await cambioPerSpesa({ currency: leg.tariffa_currency, date: leg.date });
  const meta = { mezzo: mezzoValido(leg.mezzo), compagnia: leg.compagnia || undefined, codice: leg.codice || undefined };
  if (!ex) {
    await q(`INSERT INTO expenses(trip_id,leg_id,date,category,description,amount,currency,rate,auto,meta)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
      [leg.trip_id, legId, leg.date || new Date(), categoria, `${chi} \u00b7 ${dove}`, importo, c.currency, c.rate ?? 1, meta]);
  } else if (!ex.edited) {
    await q(`UPDATE expenses SET category=$2, description=$3, amount=$4, currency=$5, rate=$6, meta=$7, date=COALESCE($8,date) WHERE id=$1`,
      [ex.id, categoria, `${chi} \u00b7 ${dove}`, importo, c.currency, c.rate ?? 1, meta, leg.date]);
  }
}

// Ricalcola la spesa gasolio automatica di una tappa (se non modificata a mano)
async function syncFuelExpense(legId) {
  const leg = (await q('SELECT l.*, t.fuel_price AS trip_fuel_price, t.km_per_liter FROM legs l JOIN trips t ON t.id=l.trip_id WHERE l.id=$1', [legId])).rows[0];
  if (!leg) return;
  // Un traghetto non consuma il gasolio del camper: se la tappa cambia mezzo,
  // la stima che c'era se ne va con lui
  if (!inCamper(leg)) {
    await q(`DELETE FROM expenses WHERE leg_id=$1 AND category='gasolio' AND auto=true AND NOT edited`, [legId]);
    return;
  }
  if (leg.senza_gasolio) return;              // spesa cancellata a mano: non torna
  const s = await getSettings();
  const price = num(leg.fuel_price) || num(leg.trip_fuel_price) || num(s.vehicle?.fuel_price, 1.75);
  const kml = num(leg.km_per_liter, 10) || 10;
  const liters = num(leg.distance_km) / kml;
  const amount = +(liters * price).toFixed(2);
  const meta = { km: num(leg.distance_km), km_per_liter: kml, liters: +liters.toFixed(2), price };
  const desc = `Gasolio ${leg.from_name.split(',')[0]} → ${leg.to_name.split(',')[0]} (${num(leg.distance_km)} km, ${liters.toFixed(1)} l × ${price} €/l)`;
  const ex = (await q(`SELECT * FROM expenses WHERE leg_id=$1 AND category='gasolio' AND auto=true`, [legId])).rows[0];
  if (!ex) await q('INSERT INTO expenses(trip_id,leg_id,date,category,description,amount,auto,meta) VALUES($1,$2,$3,$4,$5,$6,true,$7)',
    [leg.trip_id, legId, leg.date || new Date(), 'gasolio', desc, amount, meta]);
  else if (!ex.edited) await q('UPDATE expenses SET amount=$2,description=$3,meta=$4,date=COALESCE($5,date) WHERE id=$1', [ex.id, amount, desc, meta, leg.date]);
}

// Il pedaggio di una tappa sta accanto al gasolio, non dentro. Sono due costi
// di natura diversa - i litri si contano, l'autostrada si stima a tariffa
// chilometrica - e sommati in un numero solo non dicevano piu' quale dei due
// pesa. Il costo della tappa resta la somma dei due.
export async function syncTollExpense(legId) {
  const leg = (await q('SELECT * FROM legs WHERE id=$1', [legId])).rows[0];
  if (!leg) return;
  const ex = (await q(`SELECT * FROM expenses WHERE leg_id=$1 AND category='pedaggi' AND auto=true`, [legId])).rows[0];
  const km = num(leg.pedaggio_km);
  // Senza autostrada non c'e' pedaggio da stimare: la stima di prima se ne va,
  // tranne quando dentro c'e' un importo scritto a mano
  if (!inCamper(leg) || leg.senza_pedaggio || !(km > 0)) {
    if (ex && !ex.edited) await q('DELETE FROM expenses WHERE id=$1', [ex.id]);
    return;
  }
  const s = await getSettings();
  const tariffa = num(s.vehicle?.toll_per_km, 0.09);
  const amount = +(km * tariffa).toFixed(2);
  const meta = { pedaggio_km: km, toll_per_km: tariffa, stimato: true };
  const desc = `Pedaggi ${leg.from_name.split(',')[0]} \u2192 ${leg.to_name.split(',')[0]} (${km} km di autostrada \u00d7 ${tariffa} \u20ac/km, stima)`;
  if (!ex) await q(`INSERT INTO expenses(trip_id,leg_id,date,category,description,amount,auto,meta)
      VALUES($1,$2,$3,'pedaggi',$4,$5,true,$6)`, [leg.trip_id, legId, leg.date || new Date(), desc, amount, meta]);
  else if (!ex.edited) await q('UPDATE expenses SET amount=$2,description=$3,meta=$4,date=COALESCE($5,date) WHERE id=$1', [ex.id, amount, desc, meta, leg.date]);
}

// I costi che una tappa si calcola da sola: gasolio e pedaggio, sempre insieme
const costiTappa = async legId => { await syncFuelExpense(legId); await syncTollExpense(legId); await syncTariffaSpesa(legId); };

// Un costo scritto a mano sulla tappa prende il posto di quello calcolato: la
// spesa resta automatica ma «modificata», cosi' nessun ricalcolo la tocca piu'
// e il totale del viaggio la somma come tutte le altre. Il campo svuotato
// rimette in moto il calcolo.
async function costoAMano(legId, categoria, valore) {
  if (valore === undefined) return;
  const leg = (await q('SELECT * FROM legs WHERE id=$1', [legId])).rows[0];
  if (!leg) return;
  const ex = (await q('SELECT * FROM expenses WHERE leg_id=$1 AND category=$2 AND auto=true', [legId, categoria])).rows[0];
  if (valore === null || String(valore).trim() === '') {
    if (ex?.edited) {
      await q('UPDATE expenses SET edited=false WHERE id=$1', [ex.id]);
      await (categoria === 'pedaggi' ? syncTollExpense(legId) : syncFuelExpense(legId));
    }
    return;
  }
  const importo = +num(valore).toFixed(2);
  // La descrizione va riscritta insieme all'importo: lasciare «19,3 l x 1,80
  // \u20ac/l» accanto a una cifra decisa a mano raccontava un conto che non torna
  const dove = `${leg.from_name.split(',')[0]} \u2192 ${leg.to_name.split(',')[0]}`;
  const descr = categoria === 'pedaggi'
    ? `Pedaggi ${dove}${num(leg.pedaggio_km) > 0 ? ` (${num(leg.pedaggio_km)} km di autostrada)` : ''} \u00b7 importo tuo`
    : `Gasolio ${dove} (${num(leg.distance_km)} km) \u00b7 importo tuo`;
  if (ex) await q('UPDATE expenses SET amount=$2, description=$3, edited=true WHERE id=$1', [ex.id, importo, descr]);
  else await q(`INSERT INTO expenses(trip_id,leg_id,date,category,description,amount,auto,edited)
      VALUES($1,$2,$3,$4,$5,$6,true,true)`,
    [leg.trip_id, legId, leg.date || new Date(), categoria, descr, importo]);
}

// Quanto e' durata una tappa dall'uscita al ritorno, orari alla mano. Vale solo
// quando gli orari ci sono: sulle tappe previste non esiste un «in strada».
const minutiInStrada = l => {
  const m = t => { const x = String(t || '').match(/^(\d{1,2}):(\d{2})/); return x ? +x[1] * 60 + +x[2] : null; };
  const a = m(l.start_time), b = m(l.end_time);
  if (a == null || b == null) return null;
  return b >= a ? b - a : b + 1440 - a;
};

async function tripTotals(tripId) {
  const byCat = (await q('SELECT category, sum(amount * rate)::float AS total, count(*)::int AS n FROM expenses WHERE trip_id=$1 GROUP BY category ORDER BY total DESC', [tripId])).rows;
  // Le ore di guida sono la somma delle durate delle tappe. Il tempo in strada
  // e' un'altra cosa: fra la partenza e l'arrivo di una tappa che unisce piu'
  // tragitti ci sono anche le soste, e quelle non si guidano.
  const tappe = (await q('SELECT distance_km, duration_min, start_time, end_time, external_id, pedaggio_km, mezzo FROM legs WHERE trip_id=$1', [tripId])).rows;
  // I chilometri di un traghetto o di un aereo non sono chilometri di camper, e
  // le sue ore non sono ore di guida: si contano a parte, altrimenti un volo
  // farebbe credere di aver guidato per tutta Europa
  const guidate = tappe.filter(inCamper), altre = tappe.filter(l => !inCamper(l));
  const legs = {
    km: guidate.reduce((a, l) => a + (+l.distance_km || 0), 0),
    minutes: guidate.reduce((a, l) => a + (l.duration_min || 0), 0),
    n: tappe.length,
  };
  const kmAltri = altre.reduce((a, l) => a + (+l.distance_km || 0), 0);
  const perMezzo = {};
  for (const l of altre) {
    const k = mezzoValido(l.mezzo);
    perMezzo[k] = { n: (perMezzo[k]?.n || 0) + 1, km: +((perMezzo[k]?.km || 0) + (+l.distance_km || 0)).toFixed(1), minuti: (perMezzo[k]?.minuti || 0) + (l.duration_min || 0) };
  }
  const strada = guidate.reduce((a, l) => a + (minutiInStrada(l) ?? l.duration_min ?? 0), 0);
  // Una tappa che unisce piu' tragitti e la cui durata copre tutto l'intervallo
  // fra partenza e arrivo non sta dicendo il tempo di guida: dentro ci sono le
  // soste fra un tragitto e l'altro. Si conta a parte, e si dice.
  const soloStrada = tappe.filter(l => String(l.external_id || '').includes('+') && (minutiInStrada(l) ?? 0) <= (l.duration_min || 0)).length;
  const fuel = (await q(`SELECT coalesce(sum((meta->>'liters')::float),0) AS liters FROM expenses WHERE trip_id=$1 AND category='gasolio' AND auto=true`, [tripId])).rows[0];
  const total = byCat.reduce((a, b) => a + b.total, 0);
  const kmTotali = legs.km + kmAltri;
  // Il costo al km e' quello di muovere il camper: gasolio e pedaggi, sui
  // chilometri guidati. Dentro al totale del viaggio ci sono anche i campeggi,
  // i ristoranti e i biglietti dei traghetti: sono spese della vacanza, non
  // della strada, e messe al chilometro direbbero un numero che non serve a
  // niente - cambierebbe a seconda di quanto si e' mangiato.
  const spesaStrada = byCat.filter(c => c.category === 'gasolio' || c.category === 'pedaggi')
    .reduce((a, b) => a + b.total, 0);
  return { total: +total.toFixed(2), by_category: byCat, km: +legs.km.toFixed(1), minutes: legs.minutes, minuti_strada: strada, tappe_con_soste: soloStrada,
    pedaggio_km: +tappe.reduce((a, l) => a + (+l.pedaggio_km || 0), 0).toFixed(1),
    altri_mezzi: altre.length ? { n: altre.length, km: +kmAltri.toFixed(1), per_mezzo: perMezzo } : null,
    legs: legs.n, liters: +(+fuel.liters).toFixed(1), km_totali: +kmTotali.toFixed(1),
    costo_strada: +spesaStrada.toFixed(2),
    cost_per_km: legs.km ? +(spesaStrada / legs.km).toFixed(3) : null };
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

router.get('/trips', wrap(async (req, res) => { res.json(await elencoViaggi()); }));
export async function elencoViaggi() {
  const trips = (await q(`SELECT t.*, u.name AS owner,
      (SELECT coalesce(sum(distance_km) FILTER (WHERE mezzo='camper'),0)::float FROM legs WHERE trip_id=t.id) AS km,
      (SELECT coalesce(sum(distance_km) FILTER (WHERE mezzo<>'camper'),0)::float FROM legs WHERE trip_id=t.id) AS km_altri,
      -- Quanto e' costato muoversi: il resto e' spesa della vacanza, non della strada
      (SELECT coalesce(sum(amount * rate),0)::float FROM expenses WHERE trip_id=t.id AND category IN ('gasolio','pedaggi')) AS strada,
      (SELECT coalesce(sum(amount * rate),0)::float FROM expenses WHERE trip_id=t.id) AS total,
      (SELECT count(*)::int FROM legs WHERE trip_id=t.id) AS n_legs,
      (SELECT count(*)::int FROM photos WHERE trip_id=t.id) AS n_photos,
      (SELECT count(*)::int FROM workouts WHERE trip_id=t.id AND meta->'copiato_da' IS NULL) AS n_workouts,
      -- La copertina della scheda: quella scelta, e finche' non si sceglie la
      -- prima foto del viaggio, per data di scatto
      coalesce(
        (SELECT filename FROM photos WHERE id = t.cover_photo_id AND trip_id = t.id),
        (SELECT filename FROM photos WHERE trip_id=t.id AND coalesce(mime,'') NOT LIKE 'video/%' ORDER BY taken_at NULLS LAST, id LIMIT 1)) AS cover,
      coalesce(
        (SELECT crop FROM photos WHERE id = t.cover_photo_id AND trip_id = t.id),
        (SELECT crop FROM photos WHERE trip_id=t.id AND coalesce(mime,'') NOT LIKE 'video/%' ORDER BY taken_at NULLS LAST, id LIMIT 1)) AS cover_crop,
      -- Serve alla scheda per aprire l'inquadratura senza passare dalle foto
      coalesce(
        (SELECT id FROM photos WHERE id = t.cover_photo_id AND trip_id = t.id),
        (SELECT id FROM photos WHERE trip_id=t.id AND coalesce(mime,'') NOT LIKE 'video/%' ORDER BY taken_at NULLS LAST, id LIMIT 1)) AS cover_id
    FROM trips t JOIN users u ON u.id=t.user_id ORDER BY t.status='open' DESC, coalesce(t.start_date, t.created_at::date) DESC, t.id DESC`)).rows;
  // Mete e forma dell'itinerario per la scheda. Si prendono i soli estremi delle
  // tappe, non le geometrie: quelle di CarLock pesano quanto tutto il resto e
  // qui basta il profilo del viaggio, non il tracciato metro per metro.
  const tappe = (await q('SELECT trip_id, from_name, from_lat, from_lon, to_name, to_lat, to_lon, duration_min, start_time, end_time FROM legs ORDER BY trip_id, position, id')).rows;
  const perViaggio = new Map();
  for (const l of tappe) {
    if (!perViaggio.has(l.trip_id)) perViaggio.set(l.trip_id, { mete: [], rotta: [], minuti_guida: 0, minuti_strada: 0 });
    const v = perViaggio.get(l.trip_id);
    for (const [nome, lat, lon] of [[l.from_name, l.from_lat, l.from_lon], [l.to_name, l.to_lat, l.to_lon]]) {
      const breve = String(nome || '').split(',')[0].trim();
      if (breve && breve !== v.mete[v.mete.length - 1]) v.mete.push(breve);
      if (lat != null && lon != null) v.rotta.push([lat, lon]);
    }
    v.minuti_guida += l.duration_min || 0;
    v.minuti_strada += minutiInStrada(l) ?? l.duration_min ?? 0;
  }
  return trips.map(t => ({ ...t, ...(perViaggio.get(t.id) || { mete: [], rotta: [], minuti_guida: 0, minuti_strada: 0 }) }));
}
router.post('/trips', wrap(async (req, res) => {
  const s = await getSettings();
  const b = req.body || {};
  // Un viaggio puo' nascere gia' «in costruzione»: lo si prepara per mesi prima
  // di partire, e intanto non e' ne' in corso ne' concluso
  const stato = ['bozza', 'open'].includes(b.stato) ? b.stato : 'open';
  const row = (await q('INSERT INTO trips(user_id,title,start_date,end_date,fuel_price,km_per_liter,notes,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [req.user.id, String(b.title || 'Nuovo viaggio').trim(), b.start_date || null, b.end_date || null, b.fuel_price ? num(b.fuel_price) : null, num(b.km_per_liter, s.vehicle?.km_per_liter || 10) || 10, b.notes || null, stato])).rows[0];
  // Se il viaggio nasce da un percorso gia' scelto, le tappe si creano subito:
  // le tratte arrivano calcolate da /route/opzioni e non si ricalcola nulla
  const tratte = Array.isArray(b.percorso?.tratte) ? b.percorso.tratte : [];
  let pos = 0;
  for (const t of tratte) {
    if (!t?.from?.lat || !t?.to?.lat) continue;
    const leg = (await q(`INSERT INTO legs(trip_id,position,date,from_name,from_lat,from_lon,to_name,to_lat,to_lon,distance_km,duration_min,geometry,pedaggio_km)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, geometry`,
      [row.id, ++pos, t.date || null, t.from.name || 'Partenza', t.from.lat, t.from.lon, t.to.name || 'Arrivo', t.to.lat, t.to.lon,
        num(t.distance_km), Math.round(num(t.duration_min)), JSON.stringify(t.geometry || null),
        t.pedaggio_km != null ? num(t.pedaggio_km) : null])).rows[0];
    await costiTappa(leg.id);
    cercaSosteArrivo(leg.id, t.to.name, t.to.lat, t.to.lon).catch(e => console.warn('soste all\u2019arrivo:', e.message));
  }
  // Il pedaggio stimato nasce come spesa automatica, come il gasolio, ma tappa
  // per tappa: lo crea costiTappa qui sopra, dai chilometri di autostrada di
  // ciascun tratto. Quando arriva il conto vero basta modificarlo, e quella
  // tappa non viene piu' ricalcolata.
  if (tratte.length) console.log(`viaggio ${row.id}: create ${pos} tappe dal percorso \u00ab${b.percorso?.nome || '?'}\u00bb`);
  await agganciaAllenamenti();
  res.json({ ...row, tappe_create: pos });
}));
router.get('/trips/:id', wrap(async (req, res) => {
  const d = await datiViaggio(req.params.id);
  if (!d) return res.status(404).json({ error: 'Viaggio non trovato' });
  res.json(d);
}));
export async function datiViaggio(id) {
  const trip = (await q('SELECT t.*, u.name AS owner FROM trips t JOIN users u ON u.id=t.user_id WHERE t.id=$1', [id])).rows[0];
  if (!trip) return null;
  const legs = (await q('SELECT * FROM legs WHERE trip_id=$1 ORDER BY position, id', [trip.id])).rows;
  const expenses = (await q('SELECT * FROM expenses WHERE trip_id=$1 ORDER BY date DESC, id DESC', [trip.id])).rows;
  const photos = (await q('SELECT id,leg_id,stop_id,filename,caption,taken_at,lat,lon,user_id,crop,mime,luogo FROM photos WHERE trip_id=$1 ORDER BY coalesce(taken_at,created_at)', [trip.id])).rows;
  // Le copie fatte su un altro atleta rappresentano la stessa uscita gia' elencata:
  // contarle o mostrarle qui raddoppierebbe attivita' e chilometri del viaggio
  const workouts = (await q(`SELECT w.*, u.name AS athlete FROM workouts w JOIN users u ON u.id=w.user_id
    WHERE w.trip_id=$1 AND w.meta->'copiato_da' IS NULL ORDER BY started_at DESC`, [trip.id])).rows;
  // Di una sosta interessa anche se il suo costo e' gia' fra le spese: e' quello
  // che distingue «costa dieci euro» da «dieci euro nel totale del viaggio»
  const soste = (await q(`SELECT s.*, EXISTS (SELECT 1 FROM expenses e WHERE e.stop_id = s.id) AS in_spese
    FROM stops s WHERE s.trip_id=$1 ORDER BY s.from_date NULLS LAST, s.id`, [trip.id])).rows;
  return { trip, legs, expenses, photos, workouts, soste, materiali: await materialiDi(trip.id), totals: await tripTotals(trip.id) };
}
router.put('/trips/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const row = (await q(`UPDATE trips SET title=coalesce($2,title), start_date=$3, end_date=$4, fuel_price=$5, km_per_liter=coalesce($6,km_per_liter), notes=$7 WHERE id=$1 RETURNING *`,
    [req.params.id, b.title, b.start_date || null, b.end_date || null, b.fuel_price ? num(b.fuel_price) : null, b.km_per_liter ? num(b.km_per_liter) : null, b.notes || null])).rows[0];
  // il prezzo del gasolio è cambiato: ricalcola le spese automatiche non modificate
  for (const l of (await q('SELECT id FROM legs WHERE trip_id=$1', [row.id])).rows) await costiTappa(l.id);
  await agganciaAllenamenti();
  res.json(row);
}));
// Un viaggio si pensa prima di farlo: finche' e' in costruzione sta nella sua
// sezione, con dentro il materiale con cui lo si prepara. Diventa «in corso»
// quando si parte, e concluso quando si torna.
const STATI = ['bozza', 'open', 'closed'];
router.post('/trips/:id/stato', wrap(async (req, res) => {
  const stato = STATI.includes(req.body?.stato) ? req.body.stato : null;
  if (!stato) return res.status(400).json({ error: 'Stato non valido' });
  const row = (await q(`UPDATE trips SET status=$2,
      closed_at = CASE WHEN $2='closed' THEN coalesce(closed_at, now()) ELSE NULL END,
      end_date = CASE WHEN $2='closed' THEN coalesce(end_date, CURRENT_DATE) ELSE end_date END
    WHERE id=$1 RETURNING *`, [req.params.id, stato])).rows[0];
  if (!row) return res.status(404).json({ error: 'Viaggio non trovato' });
  await agganciaAllenamenti();
  res.json({ trip: row, totals: await tripTotals(row.id) });
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
    await q('UPDATE legs SET pois=$2 WHERE id=$1', [legId, { stops: [], raggio: RAGGIO_SOSTE, casa: true, cercato_il: new Date().toISOString() }]);
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
  // che di aree sosta non ne serve.
  const casa = nomeCasa(await getSettings());
  const mete = legs.filter(l => !eCasa(l.to_name, casa) && l.to_lat != null).map(l => [l.to_lat, l.to_lon]);
  if (!mete.length) return res.json({ raggio, luoghi: [], avviso: `Le tappe arrivano tutte a ${casa}: non c\u2019e\u2019 niente da cercare` });
  const r = await poisAlongRoute(mete, raggio);
  const luoghi = (r.stops || []).map(p => ({ ...p, park4night: linkPark4night(p.lat, p.lon) }));
  res.json({ raggio, luoghi, avviso: r.warning || null });
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
// Il collegamento di una sosta: il numero di park4night porta alla scheda del
// posto ed e' il piu' preciso che ci sia; dopo viene l'indirizzo scritto a mano,
// e per ultima la ricerca intorno alle coordinate. La scheda di un posto non si
// conserva mai da sola: se il numero se ne va, se ne va con lui, altrimenti
// resterebbe a puntare a un posto che non e' piu' quello.
const linkSosta = d => linkPark4nightPosto(d.p4n_id)
  || (d.link && !/park4night\.com\/[a-z]{2}\/place\//i.test(d.link) ? d.link : null)
  || (d.lat != null && d.lon != null ? linkPark4night(d.lat, d.lon) : null);

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
  p4n_id: numeroPark4night(b?.p4n_id),
  link: String(b?.link || '').trim().slice(0, 500) || null,
  source: b?.source === 'osm' ? 'osm' : 'manuale',
});

router.post('/trips/:id/soste', wrap(async (req, res) => {
  const d = datiSosta(req.body);
  if (!d.name) return res.status(400).json({ error: 'Serve il nome del posto' });
  if (d.to_date && d.from_date && d.to_date < d.from_date) return res.status(400).json({ error: 'La data di fine viene prima di quella di inizio' });
  const link = linkSosta(d);
  const c = await cambioPerSpesa({ currency: d.currency, rate: req.body?.rate, date: d.from_date });
  const r = (await q(`INSERT INTO stops(trip_id,leg_id,name,lat,lon,kind,kind_label,from_date,to_date,arrival_time,departure_time,stars,cost,currency,rate,notes,link,source,p4n_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [req.params.id, req.body?.leg_id || null, d.name, d.lat, d.lon, d.kind, d.kind_label, d.from_date, d.to_date,
      d.arrival_time, d.departure_time, d.stars, d.cost, c.currency, c.rate ?? 1, d.notes, link, d.source, d.p4n_id])).rows[0];
  await syncSostaSpesa(r.id);
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
      arrival_time=$9, departure_time=$10, stars=$11, cost=$12, currency=$13, rate=$14, notes=$15, link=$16, p4n_id=$17 WHERE id=$1 RETURNING *`,
    [cur.id, d.name, d.lat, d.lon, d.kind, d.kind_label, d.from_date, d.to_date, d.arrival_time, d.departure_time, d.stars, d.cost,
      c.currency, c.rate ?? 1, d.notes, linkSosta(d), d.p4n_id])).rows[0];
  await syncSostaSpesa(r.id);
  res.json(r);
}));

// Il costo di una sosta e' una spesa del viaggio: lo si scrive una volta sola,
// dove si e' dormito, e fra le spese compare da se'. Cambiando il costo o i
// giorni, la spesa segue; togliendo il costo, se ne va.
const CATEGORIA_SOSTA = { camping: 'campeggio', appartamento: 'altro' };
async function syncSostaSpesa(stopId) {
  const s = (await q('SELECT * FROM stops WHERE id=$1', [stopId])).rows[0];
  if (!s) return;
  const ex = (await q('SELECT * FROM expenses WHERE stop_id=$1 AND auto=true', [stopId])).rows[0];
  // Senza costo, o con la spesa tolta a mano, non c'e' niente da tenere: sparisce
  // solo quella automatica intatta, perche' in una corretta a mano c'e' un
  // importo vero che nessuno ha chiesto di buttare
  if (!(num(s.cost) > 0) || s.senza_spesa) {
    if (ex && !ex.edited) await q('DELETE FROM expenses WHERE id=$1', [ex.id]);
    return;
  }
  const categoria = CATEGORIA_SOSTA[s.kind] || 'area_sosta';
  const notti = (s.from_date && s.to_date) ? Math.max(0, Math.round((new Date(s.to_date) - new Date(s.from_date)) / 86400000)) : 0;
  const desc = `${s.name}${notti ? ` (${notti} ${notti === 1 ? 'notte' : 'notti'})` : ''}`;
  // Il posto della spesa lo sa gia': e' la sosta stessa
  if (!ex) await q(`INSERT INTO expenses(trip_id,stop_id,date,category,description,place,amount,currency,rate,auto)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
    [s.trip_id, s.id, s.from_date || new Date(), categoria, desc, s.name, s.cost, s.currency, s.rate]);
  else if (!ex.edited) await q(`UPDATE expenses SET trip_id=$2, date=$3, category=$4, description=$5, place=$9, amount=$6, currency=$7, rate=$8 WHERE id=$1`,
    [ex.id, s.trip_id, s.from_date || ex.date, categoria, desc, s.cost, s.currency, s.rate, s.name]);
}

// Resta per compatibilita': ora la spesa nasce da sola, questo la rifa' se era
// stata tolta a mano
router.post('/soste/:id/spesa', wrap(async (req, res) => {
  const s = (await q('SELECT * FROM stops WHERE id=$1', [req.params.id])).rows[0];
  if (!s) return res.status(404).json({ error: 'Sosta non trovata' });
  if (!(num(s.cost) > 0)) return res.status(400).json({ error: 'Questa sosta non ha un costo' });
  await q('UPDATE stops SET senza_spesa=false WHERE id=$1', [s.id]);
  await syncSostaSpesa(s.id);
  res.json((await q('SELECT * FROM expenses WHERE stop_id=$1 AND auto=true', [s.id])).rows[0] || { ok: true });
}));

// La sosta cancellata si porta via la sua spesa, come la tappa il suo gasolio.
// Quella corretta a mano resta: e' un importo speso davvero.
router.delete('/soste/:id', wrap(async (req, res) => {
  const tolte = (await q('DELETE FROM expenses WHERE stop_id=$1 AND auto=true AND edited=false RETURNING id', [req.params.id])).rowCount;
  const tenute = (await q('SELECT count(*)::int n FROM expenses WHERE stop_id=$1', [req.params.id])).rows[0].n;
  await q('DELETE FROM stops WHERE id=$1', [req.params.id]);
  res.json({ ok: true, spese_tolte: tolte, spese_tenute: tenute });
}));

// Una strada scelta fra quelle proposte arriva gia' calcolata: distanza, durata
// e disegno. Si accetta solo se ha tutt'e tre le cose, altrimenti si ricalcola.
const sceltoDaFuori = p => (p && Array.isArray(p.geometry) && p.geometry.length > 1 && num(p.distance_km) > 0)
  ? { distance_km: num(p.distance_km), duration_min: Math.round(num(p.duration_min)), geometry: p.geometry,
      pedaggio_km: p.pedaggio_km != null ? num(p.pedaggio_km) : null,
      warning: p.stimato ? 'Distanza stimata: il servizio dei percorsi non ha risposto' : null }
  : null;

// Il tragitto di una tappa. In camper lo calcola la strada; con gli altri mezzi
// no: una rotta e un volo le statali non le seguono, e disegnare l'autostrada
// sotto un aereo sarebbe un racconto falso. Resta la linea fra i due punti, e i
// chilometri sono quelli in linea d'aria quando nessuno li dichiara.
async function tragittoTappa(mezzo, from, to, b) {
  if (mezzoValido(mezzo) !== 'camper') {
    const km = num(b?.distance_km) > 0 ? num(b.distance_km)
      : +haversineKm([+from.lat, +from.lon], [+to.lat, +to.lon]).toFixed(1);
    const oreDichiarate = minutiInStrada({ start_time: oraValida(b?.start_time), end_time: oraValida(b?.end_time) });
    return { distance_km: km, geometry: [[+from.lat, +from.lon], [+to.lat, +to.lon]], pedaggio_km: null,
      duration_min: oreDichiarate ?? (num(b?.duration_min) > 0 ? Math.round(num(b.duration_min)) : null) };
  }
  return sceltoDaFuori(b?.percorso) || await route(from, to);
}

// Il ritaglio di una foto: quale parte si vede quando fa da copertina. Il file
// non si tocca - resta quello intero, che si apre ingrandendo - e il ritaglio
// si disfa rimandandolo vuoto.
router.post('/photos/:id/ritaglio', wrap(async (req, res) => {
  const b = req.body || {};
  const frazione = (v, min, pre) => Math.min(1, Math.max(min, +num(v, pre).toFixed(4)));
  // Il rettangolo sta dentro la foto: quello che sborda si riporta dentro, cosi'
  // nessun conto strano arriva fino al disegno della copertina
  let crop = null;
  if (b.w != null && b.h != null) {
    const w = frazione(b.w, 0.05, 1), h = frazione(b.h, 0.05, 1);
    crop = { x: frazione(b.x, 0, 0) > 1 - w ? +(1 - w).toFixed(4) : frazione(b.x, 0, 0),
      y: frazione(b.y, 0, 0) > 1 - h ? +(1 - h).toFixed(4) : frazione(b.y, 0, 0), w, h };
  }
  const r = (await q('UPDATE photos SET crop=$2 WHERE id=$1 RETURNING id, crop', [req.params.id, crop ? JSON.stringify(crop) : null])).rows[0];
  if (!r) return res.status(404).json({ error: 'Foto non trovata' });
  res.json(r);
}));

// La foto di copertina si sceglie. Rimandando la stessa, si torna alla prima
// caricata: e' la scelta che si disfa, non una seconda decisione da prendere.
router.post('/trips/:id/copertina', wrap(async (req, res) => {
  const idFoto = req.body?.photo_id ? +req.body.photo_id : null;
  if (idFoto) {
    const sua = (await q('SELECT 1 FROM photos WHERE id=$1 AND trip_id=$2', [idFoto, req.params.id])).rowCount;
    if (!sua) return res.status(400).json({ error: 'Quella foto non e\u2019 di questo viaggio' });
  }
  const t = (await q('UPDATE trips SET cover_photo_id = CASE WHEN cover_photo_id IS NOT DISTINCT FROM $2 THEN NULL ELSE $2 END WHERE id=$1 RETURNING cover_photo_id',
    [req.params.id, idFoto])).rows[0];
  if (!t) return res.status(404).json({ error: 'Viaggio non trovato' });
  res.json({ ok: true, cover_photo_id: t.cover_photo_id });
}));

router.post('/trips/:id/legs', wrap(async (req, res) => {
  const b = req.body || {};
  const from = b.from, to = b.to;
  if (!from?.lat || !to?.lat) return res.status(400).json({ error: 'Partenza e arrivo obbligatori' });
  // Se chi chiama ha gia' scelto una strada fra quelle proposte, si prende
  // quella: ricalcolarla darebbe la piu' rapida, cioe' proprio quella scartata
  const m = datiMezzo(b);
  const r = await tragittoTappa(m.mezzo, from, to, b);
  const pos = (await q('SELECT coalesce(max(position),0)+1 AS p FROM legs WHERE trip_id=$1', [req.params.id])).rows[0].p;
  const leg = (await q(`INSERT INTO legs(trip_id,position,date,from_name,from_lat,from_lon,to_name,to_lat,to_lon,distance_km,duration_min,fuel_price,geometry,notes,pedaggio_km,
      mezzo,compagnia,codice,tariffa,tariffa_currency,condizioni,sconto,start_time,end_time)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
    [req.params.id, pos, b.date || null, from.name, from.lat, from.lon, to.name, to.lat, to.lon, r.distance_km, r.duration_min, b.fuel_price ? num(b.fuel_price) : null, JSON.stringify(r.geometry), b.notes || null,
      r.pedaggio_km != null ? num(r.pedaggio_km) : null,
      m.mezzo, m.compagnia, m.codice, m.tariffa, m.tariffa_currency, m.condizioni, m.sconto, m.start_time, m.end_time])).rows[0];
  await costiTappa(leg.id);
  // POI in background: non blocca la risposta
  cercaSosteArrivo(leg.id, to.name, to.lat, to.lon).catch(e => console.warn('soste all\u2019arrivo:', e.message));
  res.json({ ...leg, routing_warning: r.warning || null });
}));
router.put('/legs/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const cur = (await q('SELECT * FROM legs WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Tappa non trovata' });
  const m = datiMezzo({ ...cur, ...b });
  let geo = { distance_km: b.distance_km != null ? num(b.distance_km) : cur.distance_km, duration_min: cur.duration_min, geometry: cur.geometry };
  const scelto = sceltoDaFuori(b.percorso);
  const changedPts = b.from?.lat && b.to?.lat && (b.from.lat !== cur.from_lat || b.from.lon !== cur.from_lon || b.to.lat !== cur.to_lat || b.to.lon !== cur.to_lon);
  // Cambiato il mezzo, il disegno va rifatto: la strada per il camper, la linea
  // dritta per chi vola o naviga
  const cambiaMezzo = m.mezzo !== mezzoValido(cur.mezzo);
  if (m.mezzo !== 'camper') {
    if (cambiaMezzo || changedPts || b.distance_km != null || b.start_time !== undefined || b.end_time !== undefined) {
      // Cambiando mezzo i chilometri di prima non valgono piu': quelli di strada
      // non sono quelli in linea d'aria. Si ricontano, a meno che non arrivino
      // scritti adesso
      geo = await tragittoTappa(m.mezzo, b.from || { lat: cur.from_lat, lon: cur.from_lon }, b.to || { lat: cur.to_lat, lon: cur.to_lon },
        { ...b, distance_km: b.distance_km ?? (cambiaMezzo ? null : cur.distance_km), start_time: m.start_time, end_time: m.end_time });
    }
  } else if (scelto) geo = scelto;
  else if (changedPts || cambiaMezzo) { const r = await route(b.from || { lat: cur.from_lat, lon: cur.from_lon }, b.to || { lat: cur.to_lat, lon: cur.to_lon }); geo = r; }
  // I chilometri di autostrada: quelli scritti a mano comandano, poi quelli
  // della strada appena scelta, altrimenti restano quelli che c'erano
  const pedKm = b.pedaggio_km !== undefined
    ? (String(b.pedaggio_km).trim() === '' ? null : num(b.pedaggio_km))
    : (scelto ? (scelto.pedaggio_km != null ? num(scelto.pedaggio_km) : null) : (changedPts ? null : cur.pedaggio_km));
  const leg = (await q(`UPDATE legs SET date=$2, from_name=$3, from_lat=$4, from_lon=$5, to_name=$6, to_lat=$7, to_lon=$8, distance_km=$9, duration_min=$10, fuel_price=$11, geometry=$12, notes=$13, position=coalesce($14,position), senza_gasolio=$15, pedaggio_km=$16, senza_pedaggio=$17,
      mezzo=$18, compagnia=$19, codice=$20, tariffa=$21, tariffa_currency=$22, condizioni=$23, sconto=$24, start_time=$25, end_time=$26, senza_tariffa=$27 WHERE id=$1 RETURNING *`,
    [cur.id, b.date ?? cur.date, b.from?.name ?? cur.from_name, b.from?.lat ?? cur.from_lat, b.from?.lon ?? cur.from_lon, b.to?.name ?? cur.to_name, b.to?.lat ?? cur.to_lat, b.to?.lon ?? cur.to_lon,
      geo.distance_km, geo.duration_min, b.fuel_price != null && b.fuel_price !== '' ? num(b.fuel_price) : null, JSON.stringify(geo.geometry), b.notes ?? cur.notes, b.position,
      b.senza_gasolio != null ? !!b.senza_gasolio : cur.senza_gasolio, pedKm,
      b.senza_pedaggio != null ? !!b.senza_pedaggio : cur.senza_pedaggio,
      m.mezzo, m.compagnia, m.codice, m.tariffa, m.tariffa_currency, m.condizioni, m.sconto, m.start_time, m.end_time,
      b.senza_tariffa != null ? !!b.senza_tariffa : cur.senza_tariffa])).rows[0];
  await costiTappa(leg.id);
  // I costi scritti a mano vengono dopo il ricalcolo: sono loro a dover restare
  await costoAMano(leg.id, 'gasolio', b.costo_gasolio);
  await costoAMano(leg.id, 'pedaggi', b.costo_pedaggio);
  if (changedPts) cercaSosteArrivo(leg.id, leg.to_name, leg.to_lat, leg.to_lon).catch(e => console.warn('soste all\u2019arrivo:', e.message));
  res.json(leg);
}));
// L'ordine delle tappe si cambia a mano: il giorno non basta a dire cosa viene
// prima, e due tappe nella stessa giornata le mette in fila solo chi le ha
// fatte. Si scambia con la vicina, che e' l'unico movimento che serve davvero.
// Ridisegna la riga di una tappa scegliendo, fra le strade possibili, quella che
// misura quanto i chilometri veri. Serve alle tappe importate prima, quando si
// prendeva sempre la piu' rapida e sulla mappa compariva l'autostrada anche se
// si era passati per la statale.
router.post('/legs/:id/ridisegna', wrap(async (req, res) => {
  const l = (await q('SELECT * FROM legs WHERE id=$1', [req.params.id])).rows[0];
  if (!l) return res.status(404).json({ error: 'Tappa non trovata' });
  if (l.from_lat == null || l.to_lat == null) return res.status(400).json({ error: 'La tappa non ha i due punti' });
  const scelto = await percorsoVicinoAiKm(
    { name: l.from_name, lat: l.from_lat, lon: l.from_lon },
    { name: l.to_name, lat: l.to_lat, lon: l.to_lon },
    num(l.distance_km), num(l.duration_min));
  await q('UPDATE legs SET geometry=$2, pedaggio_km=$3 WHERE id=$1',
    [l.id, JSON.stringify(scelto.geometry), scelto.pedaggio_km ?? null]);
  await costiTappa(l.id);
  console.log(`tappa ${l.id}: ridisegnata su «${scelto.nome}», ${scelto.distance_km} km contro ${l.distance_km} veri`);
  res.json({ ok: true, nome: scelto.nome, km_disegnati: scelto.distance_km, km_veri: +l.distance_km,
    scarto_km: scelto.scarto_km ?? null, confrontate: !!scelto.scelta_per_km });
}));

router.post('/legs/:id/sposta', wrap(async (req, res) => {
  const cur = (await q('SELECT id, trip_id, position FROM legs WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Tappa non trovata' });
  // Le posizioni in archivio possono essere pari, ripetute o con dei buchi: qui
  // si guarda l'ordine con cui le tappe compaiono, che e' quello che si vede
  const ordine = (await q('SELECT id FROM legs WHERE trip_id=$1 ORDER BY position, id', [cur.trip_id])).rows.map(r => r.id);
  const i = ordine.indexOf(cur.id);
  const j = String(req.body?.verso) === 'su' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ordine.length) return res.json({ ok: true, spostata: false });
  [ordine[i], ordine[j]] = [ordine[j], ordine[i]];
  for (let k = 0; k < ordine.length; k++) await q('UPDATE legs SET position=$2 WHERE id=$1', [ordine[k], k + 1]);
  res.json({ ok: true, spostata: true, ordine });
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
    const vuoto = { stops: [], raggio, casa: true };
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
// La spesa del gasolio e' della tappa: se la tappa se ne va, se ne va con lei,
// altrimenti resta nel totale del viaggio senza piu' niente che la spieghi.
// Quella corretta a mano no: li' dentro c'e' un importo vero, speso davvero, e
// si stacca dalla tappa invece di sparire.
router.delete('/legs/:id', wrap(async (req, res) => {
  const tolte = (await q("DELETE FROM expenses WHERE leg_id=$1 AND auto=true AND edited=false RETURNING id", [req.params.id])).rowCount;
  const tenute = (await q("SELECT count(*)::int n FROM expenses WHERE leg_id=$1", [req.params.id])).rows[0].n;
  await q('DELETE FROM legs WHERE id=$1', [req.params.id]);
  res.json({ ok: true, spese_tolte: tolte, spese_tenute: tenute });
}));

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

// ---- percorsi presi da Google Maps ----
// Si incolla il collegamento di un itinerario e se ne cavano i punti. I nomi
// vengono poi cercati dal nostro geocoder: Google i suoi non li presta.
router.post('/maps/percorso', wrap(async (req, res) => {
  const link = String(req.body?.url || '').trim();
  if (!link) return res.status(400).json({ error: 'Incolla il collegamento di Google Maps' });
  let disteso = link;
  try { disteso = await seguiLinkBreve(link); }
  catch (e) { console.warn('maps: collegamento breve non seguito:', e.message); }
  const grezzi = puntiDaLinkMaps(disteso);
  if (!grezzi.length) return res.status(400).json({
    error: 'In questo collegamento non ci sono tappe. Su Google Maps apri le indicazioni (Percorso), poi Condividi \u2192 Copia link.' });

  const punti = [], nonTrovati = [];
  for (const g of grezzi) {
    if (g.lat != null) { punti.push(g); continue; }
    let trovato = null;
    try { trovato = (await geocode(g.name))[0]; } catch (e) { console.warn('maps: geocoder', e.message); }
    if (trovato) punti.push({ name: trovato.name, lat: trovato.lat, lon: trovato.lon, cercato: g.name });
    else nonTrovati.push(g.name);
    await new Promise(r => setTimeout(r, 250));   // i geocoder gratuiti non si martellano
  }
  res.json({ punti, non_trovati: nonTrovati, link: disteso });
}));

// Gli indirizzi di CarLock cercati uno per uno, con la cache: lo stesso posto
// ricorre in ogni tragitto della giornata
async function geocodaCarlock(indirizzo, cache = new Map()) {
  if (cache.has(indirizzo)) return cache.get(indirizzo);
  let trovato = null;
  for (const c of addressCandidates(indirizzo)) {
    try {
      const r = await geocode(c);
      if (r.length) { trovato = { name: nomeTappa(indirizzo), lat: r[0].lat, lon: r[0].lon }; break; }
    } catch { }
    await new Promise(r => setTimeout(r, 250));
  }
  cache.set(indirizzo, trovato);
  return trovato;
}

// Il percorso vero di una tappa sola. Un viaggio puo' essere gia' a posto e
// avere una tappa sbagliata: qui si porta dentro il tragitto davvero percorso
// senza toccare le altre. Con ?preview=1 si guarda soltanto.
router.post('/legs/:id/carlock', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File CarLock mancante' });
  const leg = (await q('SELECT * FROM legs WHERE id=$1', [req.params.id])).rows[0];
  if (!leg) return res.status(404).json({ error: 'Tappa non trovata' });
  let righe;
  try { righe = readCarlockFile(req.file.buffer, req.file.originalname); }
  catch (e) { return res.status(400).json({ error: 'File non leggibile: ' + e.message }); }
  if (!righe.length) return res.status(400).json({ error: 'Nessun tragitto nel file' });

  // Intorno al giorno della tappa: il file copre mesi, e la tappa e' una
  const giorni = Math.min(Math.max(0, num(req.body.giorni, 1)), 30);
  const perno = leg.date || righe[0].date;
  const dentro = (d, g) => Math.abs((new Date(d) - new Date(g)) / 86400000) <= giorni;
  const vicine = leg.date ? righe.filter(r => dentro(r.date, perno)) : righe;
  const candidate = mergeTrips(vicine.length ? vicine : righe, num(req.body.merge_gap_min, 30));

  if (req.query.preview) {
    return res.json({
      giorno: leg.date, giorni, nel_file: righe.length,
      tratte: candidate.map(l => ({ external_id: l.external_id, date: l.date, start: l.start, end: l.end,
        from: shortName(l.from), to: shortName(l.to), km: l.km, duration_min: l.duration_min, merged: l.merged || 1 })),
    });
  }

  const volute = String(req.body.scelte || '').split('\n').map(x => x.trim()).filter(Boolean);
  const scelte = candidate.filter(c => volute.includes(c.external_id));
  if (!scelte.length) return res.status(400).json({ error: 'Nessun tragitto scelto' });

  // Piu' tragitti scelti diventano una tappa sola: si parte dal primo e si
  // arriva all'ultimo, e i chilometri sono la somma di quelli veri
  const primo = scelte[0], ultimo = scelte[scelte.length - 1];
  const cache = new Map();
  const da = await geocodaCarlock(primo.from, cache), a = await geocodaCarlock(ultimo.to, cache);
  if (!da || !a) return res.status(422).json({ error: `Indirizzo non riconosciuto: ${!da ? primo.from : ultimo.to}` });
  const km = +scelte.reduce((t, x) => t + x.km, 0).toFixed(1);
  const minuti = scelte.reduce((t, x) => t + x.duration_min, 0);
  // La strada da disegnare e' quella che misura quanto il contachilometri, e
  // che si poteva fare nel tempo che ci e' voluto
  let geometry = [[da.lat, da.lon], [a.lat, a.lon]], pedaggioKm = null;
  try { const str = await percorsoVicinoAiKm(da, a, km, minuti); geometry = str.geometry; pedaggioKm = str.pedaggio_km ?? null; } catch { }
  const id_esterno = scelte.map(x => x.external_id).join('+');
  let aggiornata;
  try {
    aggiornata = (await q(`UPDATE legs SET date=$2, from_name=$3, from_lat=$4, from_lon=$5, to_name=$6, to_lat=$7, to_lon=$8,
        distance_km=$9, duration_min=$10, geometry=$11, start_time=$12, end_time=$13, source='carlock', external_id=$14,
        notes=coalesce(nullif($15,''), notes), pedaggio_km=$16
      WHERE id=$1 RETURNING *`,
      [leg.id, primo.date, da.name, da.lat, da.lon, a.name, a.lat, a.lon, km, minuti, JSON.stringify(geometry),
        primo.start, ultimo.end, id_esterno,
        `CarLock ${primo.start}\u2013${ultimo.end}` + (scelte.length > 1 ? ` (${scelte.length} tratte unite)` : ''), pedaggioKm])).rows[0];
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Questo tragitto e\u2019 gia\u2019 su un\u2019altra tappa del viaggio' });
    throw e;
  }
  await costiTappa(leg.id);
  console.log(`tappa ${leg.id}: percorso reale da CarLock, ${km} km da ${scelte.length} tratte`);
  res.json({ ok: true, leg: aggiornata, tratte: scelte.length, km });
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
  // hanno un identificativo CarLock, e con loro il gasolio che era stimato.
  // Si possono indicare una per una: un viaggio puo' essere gia' a posto in
  // gran parte, e sbagliato in una tratta sola.
  const quali = String(req.body.sostituisci_ids || '').split(',').map(x => parseInt(x, 10)).filter(Number.isInteger);
  const sostituisci = !isNew && !req.query.preview && (req.body.sostituisci === 'true' || req.body.sostituisci === true || quali.length > 0);
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

  let sostituite = 0;
  // Si sostituisce solo se c'e' davvero qualcosa da mettere al posto: con un file
  // che non porta nessuna tratta, le tappe previste sparirebbero per niente
  if (sostituisci && legsToAdd.length) {
    // Prima il gasolio stimato di quelle tappe, poi le tappe: al contrario la
    // spesa resterebbe orfana e il totale conterebbe due volte lo stesso viaggio
    const previste = (await q(`SELECT id FROM legs WHERE trip_id=$1 AND external_id IS NULL
      ${quali.length ? 'AND id = ANY($2::int[])' : ''}`, quali.length ? [trip.id, quali] : [trip.id])).rows.map(r => r.id);
    sostituite = previste.length;
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
        if (r.length) { hit = { name: nomeTappa(addr), lat: r[0].lat, lon: r[0].lon }; break; }
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
    let geometry = [[from.lat, from.lon], [to.lat, to.lon]], pedaggioKm = null;
    try { const str = await percorsoVicinoAiKm(from, to, l.km, l.duration_min); geometry = str.geometry; pedaggioKm = str.pedaggio_km ?? null; } catch { }
    const leg = (await q(`INSERT INTO legs(trip_id,position,date,from_name,from_lat,from_lon,to_name,to_lat,to_lon,distance_km,duration_min,geometry,notes,source,external_id,start_time,end_time,pedaggio_km)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'carlock',$14,$15,$16,$17) ON CONFLICT (trip_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING *`,
      [trip.id, ++pos, l.date, from.name, from.lat, from.lon, to.name, to.lat, to.lon, l.km, l.duration_min, JSON.stringify(geometry),
        `CarLock ${l.start}\u2013${l.end}` + (l.merged > 1 ? ` (${l.merged} tratte unite)` : ''), l.external_id, l.start, l.end, pedaggioKm])).rows[0];
    if (leg) { await costiTappa(leg.id); created.push(leg); }
  }
  // riordina le tappe per data/ora e cerca i POI in background, uno alla volta
  const all = (await q('SELECT id FROM legs WHERE trip_id=$1 ORDER BY date NULLS LAST, start_time NULLS LAST, position, id', [trip.id])).rows;
  for (let i = 0; i < all.length; i++) await q('UPDATE legs SET position=$2 WHERE id=$1', [all[i].id, i + 1]);
  (async () => { for (const leg of created) { try { await cercaSosteArrivo(leg.id, leg.to_name, leg.to_lat, leg.to_lon); } catch { } await new Promise(r => setTimeout(r, 3000)); } })();
  if (errors.size) console.warn('CarLock: errori geocoder', Object.fromEntries(errors));
  let split = null;
  if (req.body.split_home && created.length) split = await splitTripByHome(trip.id, String(req.body.split_home).trim(), req.user.id);
  res.json({ ...summary, imported: created.length, sostituite, geocode_failed: [...new Set(failed)], geocode_errors: [...errors.keys()], split, totals: split?.kept === null ? null : await tripTotals(trip.id) });
}));

// ---- spese ----
router.post('/trips/:id/expenses', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.category || b.amount == null) return res.status(400).json({ error: 'Categoria e importo obbligatori' });
  // L'importo resta nella valuta in cui e' stato speso; accanto si congela il
  // cambio del giorno, ed e' quello a fare i totali
  const c = await cambioPerSpesa({ currency: b.currency, rate: b.rate, date: b.date });
  if (c.rate == null) return res.status(502).json({ error: c.avviso });
  const row = (await q(`INSERT INTO expenses(trip_id,leg_id,date,category,description,place,amount,currency,rate,auto,edited)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false,true) RETURNING *`,
    [req.params.id, b.leg_id || null, b.date || new Date(), b.category, b.description || null,
      (b.place || '').trim() || null, num(b.amount), c.currency, c.rate])).rows[0];
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
      place=$8, amount=coalesce($5,amount), currency=$6, rate=$7, edited=true WHERE id=$1 RETURNING *`,
    [req.params.id, b.date || null, b.category || null, b.description ?? null, b.amount != null ? num(b.amount) : null, c.currency, c.rate,
      b.place !== undefined ? ((b.place || '').trim() || null) : cur.place])).rows[0];
  res.json(row);
}));
// Ripristina il calcolo automatico di una spesa gasolio modificata
router.post('/expenses/:id/reset', wrap(async (req, res) => {
  const ex = (await q('UPDATE expenses SET edited=false WHERE id=$1 AND auto=true RETURNING leg_id', [req.params.id])).rows[0];
  if (ex?.leg_id) await costiTappa(ex.leg_id);
  res.json((await q('SELECT * FROM expenses WHERE id=$1', [req.params.id])).rows[0]);
}));
// Qualsiasi spesa si puo' togliere, anche quella calcolata da sola. E quando e'
// il gasolio di una tappa, la tappa se ne ricorda: senza, il primo ritocco alla
// tappa la farebbe ricomparire, e cancellarla sarebbe una fatica senza fine.
router.delete('/expenses/:id', wrap(async (req, res) => {
  const ex = (await q('DELETE FROM expenses WHERE id=$1 RETURNING auto, leg_id, stop_id, category', [req.params.id])).rows[0];
  if (!ex) return res.status(404).json({ error: 'Spesa non trovata' });
  const spenta = !!(ex.auto && (ex.leg_id || ex.stop_id));
  if (ex.auto && ex.leg_id) {
    const campo = ex.category === 'pedaggi' ? 'senza_pedaggio' : ex.category === 'gasolio' ? 'senza_gasolio' : 'senza_tariffa';
    await q(`UPDATE legs SET ${campo}=true WHERE id=$1`, [ex.leg_id]);
  }
  if (ex.auto && ex.stop_id) await q('UPDATE stops SET senza_spesa=true WHERE id=$1', [ex.stop_id]);
  res.json({ ok: true, calcolo_spento: spenta, da: ex.stop_id ? 'sosta' : ex.leg_id ? 'tappa' : null });
}));

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
  // «Km in camper» vuol dire in camper: i chilometri di un traghetto o di un
  // volo non si guidano, e sommati qui facevano credere di aver fatto mezza
  // Europa al volante. Le tappe invece si contano tutte: sono tappe lo stesso.
  const km = (await q(`SELECT to_char(date_trunc('${group}', coalesce(date, created_at::date)), 'YYYY-MM-DD') AS period,
      coalesce(sum(distance_km) FILTER (WHERE mezzo='camper'), 0)::float AS km,
      coalesce(sum(distance_km), 0)::float AS km_tutti, count(*)::int AS legs
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
    // Quanto e' costato muoversi: gasolio e pedaggi, che divisi per i
    // chilometri in camper danno il costo al km
    strada: +byCat.filter(c => c.category === 'gasolio' || c.category === 'pedaggi')
      .reduce((a, b) => a + b.total, 0).toFixed(2),
    km: +km.reduce((a, b) => a + b.km, 0).toFixed(1),
    km_tutti: +km.reduce((a, b) => a + b.km_tutti, 0).toFixed(1),
    legs: km.reduce((a, b) => a + b.legs, 0),
    trips: (await q(`SELECT count(DISTINCT trip_id)::int AS n FROM expenses WHERE date BETWEEN $1 AND $2${tripCond}`, params)).rows[0].n,
    workouts: wo.reduce((a, b) => a + b.n, 0),
    workout_km: +wo.reduce((a, b) => a + (b.km || 0), 0).toFixed(1),
    calories: wo.reduce((a, b) => a + (b.calories || 0), 0),
  };
  res.json({ from, to, group, totals, by_category: byCat, periods, km, workouts: wo });
}));
