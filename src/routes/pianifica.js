// Lo spazio dove si prepara un viaggio: i posti, quando, quanto costerà e cosa
// c'è da fare prima di partire.
//
// Non ha dati suoi. Le proposte sono quelle della lavagna, le tappe e le soste
// sono quelle del viaggio: questa è una vista diversa sulle stesse cose, non
// un posto dove ricopiarle. Quello che nasce qui — il budget ipotizzato e le
// liste delle cose — qui non c'era, e non si confonde con le spese vere.
import { Router } from 'express';
import { q } from '../lib/db.js';
import { wrap, num } from '../lib/util.js';
import { requireAuth } from './auth.js';
import { proposteDi } from './proposte.js';
import { gasolioPrevisto, campeggiPrevisti, pedaggiPrevisti } from '../lib/budget.js';
import { contoIpotesi } from '../lib/ipotesi.js';
import { capisciIncollato } from '../lib/cassetta.js';
import { tappeDaPercorso } from '../lib/tappe.js';
import { dataDelGiorno, giornoDellaData } from '../lib/giorni.js';
import { leggiPosto } from '../lib/park4night.js';
import { linkPark4nightPosto, percorsiConTappe, geocode } from '../lib/geo.js';
import { seguiLinkBreve, completaPunti, centroDelLink } from '../lib/maps.js';
import { titoloDellaPagina } from './materiali.js';

export const router = Router();
router.use(requireAuth);

const LISTE = ['fare', 'comprare', 'portare'];

const listeDi = async tripId => (await q(`SELECT l.*, a.name AS scritta_da, b.name AS spuntata_da
  FROM liste l LEFT JOIN users a ON a.id = l.user_id LEFT JOIN users b ON b.id = l.chi
  WHERE l.trip_id=$1 ORDER BY l.lista, l.fatta, l.posizione, l.id`, [tripId])).rows;

// Il budget: quello che hai scritto a mano, più i due conti che l'app sa fare
// da sé. I calcolati portano la riga che li spiega e non si possono cambiare
// da qui: si cambia il giro, o il numero di notti, e cambiano loro.
// Quanto consuma il camper e quanto costano gasolio e pedaggi: del viaggio se
// c'e' scritto, se no quello generale delle impostazioni.
async function comeVaIlCamper(trip) {
  const s = (await q(`SELECT value FROM settings WHERE key='vehicle'`)).rows[0]?.value || {};
  return {
    kmPerLitro: num(trip?.km_per_liter) || num(s.km_per_liter, 10) || null,
    prezzoLitro: num(trip?.fuel_price) || num(s.fuel_price) || null,
    tariffaPedaggio: num(s.toll_per_km, 0.09),
  };
}

// Le ipotesi col loro conto. Le strade arrivano gia' caricate: sono le stesse
// che l'elenco mostra, e caricarle due volte vorrebbe dire due verita'.
async function ipotesiDi(trip, percorsi) {
  const righe = (await q(`SELECT i.*, u.name AS chi FROM ipotesi i
    LEFT JOIN users u ON u.id = i.user_id WHERE i.trip_id=$1 ORDER BY i.id`, [trip.id])).rows;
  if (!righe.length) return [];
  const tutti = (await q('SELECT * FROM giorni WHERE ipotesi_id = ANY($1) ORDER BY numero, id',
    [righe.map(r => r.id)])).rows;
  const camper = await comeVaIlCamper(trip);
  return righe.map(i => {
    const suoi = tutti.filter(g => g.ipotesi_id === i.id).map(g => ({
      ...g,
      prezzo_notte: g.prezzo_notte == null ? null : +g.prezzo_notte,
      percorsi: (percorsi || []).filter(p => p.giorno_id === g.id),
    }));
    return { ...i, giorni: suoi, conto: contoIpotesi({ giorni: suoi, ...camper }),
      // In mappa quando almeno una delle sue tratte ha messo le sue tappe
      in_mappa: suoi.some(g => g.percorsi.some(p => p.in_mappa)) };
  });
}

async function budgetDi(trip, proposte) {
  const aMano = (await q('SELECT * FROM budget WHERE trip_id=$1 ORDER BY posizione, id', [trip.id])).rows;
  const km = +(await q(`SELECT coalesce(sum(distance_km) FILTER (WHERE mezzo='camper'),0)::float AS km
    FROM legs WHERE trip_id=$1`, [trip.id])).rows[0].km;
  // Il prezzo del gasolio: quello del viaggio, se c'e', se no quello generale
  const impostazioni = (await q(`SELECT value FROM settings WHERE key='vehicle'`)).rows[0];
  const prezzoLitro = num(trip.fuel_price) || num(impostazioni?.value?.fuel_price) || null;

  const calcolate = [];
  const gasolio = gasolioPrevisto({ km, kmPerLitro: trip.km_per_liter, prezzoLitro });
  calcolate.push(gasolio
    ? { categoria: 'gasolio', importo: gasolio.importo, nota: gasolio.conto, calcolata: true }
    : { categoria: 'gasolio', importo: null, calcolata: true,
        nota: !km ? 'Appena ci sono le tappe, il gasolio si conta da sé' : 'Manca il prezzo del gasolio o il consumo del camper' });

  // I pedaggi: il calcolatore dava i chilometri di autostrada di ogni tappa e
  // nessuno li contava. Se nessuna tappa lo dice, la voce manca - non vale
  // zero, che vorrebbe dire «autostrada gratis».
  const ped = (await q(`SELECT coalesce(sum(pedaggio_km),0)::float AS km,
      count(*) FILTER (WHERE pedaggio_km IS NOT NULL)::int AS dette,
      count(*)::int AS tutte
    FROM legs WHERE trip_id=$1 AND coalesce(mezzo,'camper')='camper'`, [trip.id])).rows[0];
  const { tariffaPedaggio } = await comeVaIlCamper(trip);
  const pedaggi = ped.dette ? pedaggiPrevisti({ kmPedaggio: ped.km, tariffa: tariffaPedaggio }) : null;
  calcolate.push(pedaggi
    ? { categoria: 'pedaggi', importo: pedaggi.importo, calcolata: true,
        nota: pedaggi.conto + (ped.dette < ped.tutte ? ` \u2014 ${ped.tutte - ped.dette} tapp${ped.tutte - ped.dette === 1 ? 'a' : 'e'} non lo dice` : '') }
    : { categoria: 'pedaggi', importo: null, calcolata: true,
        nota: !ped.tutte ? 'Appena ci sono le tappe si contano anche i pedaggi'
          : 'Nessuna tappa dice i suoi chilometri di autostrada: premi \ud83d\udd04 su una strada per farli contare' });

  const prezzi = proposte.filter(p => p.stato === 'scelto' && p.prezzo != null).map(p => +p.prezzo);
  const campeggi = campeggiPrevisti({ prezzi, notti: trip.notti_previste });
  calcolate.push(campeggi
    ? { categoria: 'campeggio', importo: campeggi.importo, nota: campeggi.conto, calcolata: true }
    : { categoria: 'campeggio', importo: null, calcolata: true,
        nota: !prezzi.length ? 'Scegli un posto col suo prezzo e il conto si fa da sé' : 'Dimmi quante notti e lo conto' });

  const voci = [...calcolate, ...aMano.map(v => ({ ...v, importo: v.importo == null ? null : +v.importo }))];
  const totale = voci.reduce((a, v) => a + (v.importo || 0), 0);
  // Quello che si è speso davvero, per il confronto. Non si somma: è l'altra
  // colonna, ed è il numero che a fine viaggio dice di quanto si era sbagliato.
  const speso = +(await q('SELECT coalesce(sum(amount * rate),0)::float AS t FROM expenses WHERE trip_id=$1', [trip.id])).rows[0].t;
  return { voci, totale: Math.round(totale * 100) / 100, speso };
}

// L'elenco dei viaggi che si stanno preparando, con quello che conta mentre li
// si prepara: non i chilometri fatti, ma quanto manca a decidere.
router.get('/pianificati', wrap(async (req, res) => {
  const trips = (await q(`SELECT t.*, u.name AS owner FROM trips t JOIN users u ON u.id=t.user_id
    WHERE t.status='bozza' ORDER BY coalesce(t.start_date, t.created_at::date) DESC, t.id DESC`)).rows;
  const fuori = [];
  for (const trip of trips) {
    const proposte = await proposteDi(trip.id);
    const legs = (await q(`SELECT distance_km, mezzo FROM legs WHERE trip_id=$1`, [trip.id])).rows;
    const km = legs.filter(l => (l.mezzo || 'camper') === 'camper').reduce((a, l) => a + (+l.distance_km || 0), 0);
    const daConfermare = +(await q(`SELECT (SELECT count(*) FROM legs WHERE trip_id=$1 AND da_confermare)
      + (SELECT count(*) FROM stops WHERE trip_id=$1 AND da_confermare)
      + (SELECT count(*) FROM percorsi WHERE trip_id=$1 AND da_confermare) AS n`, [trip.id])).rows[0].n;
    const budget = await budgetDi(trip, proposte);
    fuori.push({ ...trip, km: Math.round(km), scelti: proposte.filter(p => p.stato === 'scelto').length,
      proposti: proposte.length, da_confermare: daConfermare, ipotesi: budget.totale,
      // Quanta roba c'e' dentro: serve a dire, prima di eliminarlo, cosa si
      // porta via. «Sei sicuro?» non e' un'informazione.
      strade: +(await q('SELECT count(*) FROM percorsi WHERE trip_id=$1', [trip.id])).rows[0].count,
      tappe: legs.length,
      cose: +(await q('SELECT count(*) FROM liste WHERE trip_id=$1 AND NOT fatta', [trip.id])).rows[0].count });
  }
  res.json(fuori);
}));

router.get('/trips/:id/pianifica', wrap(async (req, res) => {
  const trip = (await q('SELECT * FROM trips WHERE id=$1', [req.params.id])).rows[0];
  if (!trip) return res.status(404).json({ error: 'Viaggio non trovato' });
  const [proposte, liste] = await Promise.all([proposteDi(trip.id), listeDi(trip.id)]);
  const percorsi = await percorsiDi(trip.id);
  const legs = (await q('SELECT * FROM legs WHERE trip_id=$1 ORDER BY position, id', [trip.id])).rows;
  const soste = (await q('SELECT * FROM stops WHERE trip_id=$1 ORDER BY from_date NULLS LAST, id', [trip.id])).rows;
  const camper = legs.filter(l => (l.mezzo || 'camper') === 'camper');
  const numeri = {
    km: Math.round(camper.reduce((a, l) => a + (+l.distance_km || 0), 0)),
    minuti: camper.reduce((a, l) => a + (+l.duration_min || 0), 0),
    tappe: legs.length,
    notti: trip.notti_previste,
    scelti: proposte.filter(p => p.stato === 'scelto').length,
    proposti: proposte.length,
    da_confermare: legs.filter(l => l.da_confermare).length + soste.filter(s => s.da_confermare).length
      + percorsi.filter(x => x.da_confermare).length,
    in_mappa: percorsi.filter(x => x.in_mappa).length,
    fuori_mappa: percorsi.filter(x => !x.in_mappa).length,
    // Quanto dura il viaggio pensato: il giorno piu' alto che qualcuno ha
    // scritto, prima che esistano le date
    giorni_teorici: Math.max(0, ...legs.map(l => +l.giorno || 0), ...soste.map(s => +s.giorno || 0)),
    senza_giorno: legs.filter(l => !l.giorno && !l.date).length + soste.filter(s => !s.giorno && !s.from_date).length,
  };
  res.json({ trip, proposte, liste, legs, soste, percorsi, numeri,
    ipotesi: await ipotesiDi(trip, percorsi),
    budget: await budgetDi(trip, proposte),
    materiali: (await q(`SELECT m.*, u.name AS chi FROM materiali m LEFT JOIN users u ON u.id=m.user_id
      WHERE m.trip_id=$1 ORDER BY m.created_at DESC, m.id DESC`, [trip.id])).rows });
}));

// Quando si va, e quante notti: le due cose su cui si regge il resto del conto
router.put('/trips/:id/pianifica', wrap(async (req, res) => {
  const quando = String(req.body?.quando_circa ?? '').trim().slice(0, 200) || null;
  const notti = req.body?.notti_previste === '' || req.body?.notti_previste == null
    ? null : Math.max(0, Math.round(num(req.body.notti_previste))) || null;
  const r = (await q('UPDATE trips SET quando_circa=$2, notti_previste=$3 WHERE id=$1 RETURNING *',
    [req.params.id, quando, notti])).rows[0];
  res.json(r);
}));

// ---------- il budget scritto a mano ----------
const datiVoce = b => ({
  categoria: String(b?.categoria || '').trim().slice(0, 60) || 'altro',
  importo: b?.importo === '' || b?.importo == null ? null : num(b.importo),
  currency: String(b?.currency || '').trim().slice(0, 3).toUpperCase() || null,
  nota: String(b?.nota || '').trim().slice(0, 300) || null,
});

router.post('/trips/:id/budget', wrap(async (req, res) => {
  const d = datiVoce(req.body);
  const r = (await q(`INSERT INTO budget (trip_id, categoria, importo, currency, nota)
    VALUES($1,$2,$3,$4,$5) RETURNING *`, [req.params.id, d.categoria, d.importo, d.currency, d.nota])).rows[0];
  res.json(r);
}));

router.put('/budget/:id', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM budget WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Voce non trovata' });
  const d = datiVoce({ ...cur, ...req.body });
  const r = (await q('UPDATE budget SET categoria=$2, importo=$3, currency=$4, nota=$5 WHERE id=$1 RETURNING *',
    [cur.id, d.categoria, d.importo, d.currency, d.nota])).rows[0];
  res.json(r);
}));

router.delete('/budget/:id', wrap(async (req, res) => {
  await q('DELETE FROM budget WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- le liste delle cose ----------
router.post('/trips/:id/liste', wrap(async (req, res) => {
  const testo = String(req.body?.testo || '').trim().slice(0, 300);
  if (!testo) return res.status(400).json({ error: 'Scrivi cosa c’è da fare' });
  const lista = LISTE.includes(req.body?.lista) ? req.body.lista : 'fare';
  const r = (await q(`INSERT INTO liste (trip_id, lista, testo, user_id) VALUES($1,$2,$3,$4) RETURNING id`,
    [req.params.id, lista, testo, req.user.id])).rows[0];
  res.json((await listeDi(req.params.id)).find(x => x.id === r.id));
}));

router.put('/liste/:id', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM liste WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Voce non trovata' });
  const testo = req.body?.testo == null ? cur.testo : String(req.body.testo).trim().slice(0, 300) || cur.testo;
  const fatta = req.body?.fatta == null ? cur.fatta : !!req.body.fatta;
  // Chi ha spuntato e quando restano scritti finché la spunta resta: togliendola
  // se ne vanno, perché non è più vero che qualcuno l'abbia fatta.
  const r = (await q(`UPDATE liste SET testo=$2, fatta=$3,
      chi = CASE WHEN $3 THEN $4::int ELSE NULL END,
      quando = CASE WHEN $3 THEN coalesce(quando, now()) ELSE NULL END
    WHERE id=$1 RETURNING id`, [cur.id, testo, fatta, req.user.id])).rows[0];
  res.json((await listeDi(cur.trip_id)).find(x => x.id === r.id));
}));

router.delete('/liste/:id', wrap(async (req, res) => {
  await q('DELETE FROM liste WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- il bollino «da confermare» ----------
for (const [strada, tabella] of [['legs', 'legs'], ['soste', 'stops']]) {
  router.put(`/${strada}/:id/conferma`, wrap(async (req, res) => {
    const r = (await q(`UPDATE ${tabella} SET da_confermare=$2 WHERE id=$1 RETURNING id, da_confermare`,
      [req.params.id, !!req.body?.da_confermare])).rows[0];
    if (!r) return res.status(404).json({ error: 'Non trovata' });
    res.json(r);
  }));
}

// ---------- i giorni teorici ----------
// Un viaggio si pensa per giorni prima che per date. Il numero sta accanto alla
// tappa finche' non si sa quando si parte.
for (const [strada, tabella] of [['legs', 'legs'], ['soste', 'stops']]) {
  router.put(`/${strada}/:id/giorno`, wrap(async (req, res) => {
    const g = Number(req.body?.giorno);
    const giorno = Number.isInteger(g) && g >= 1 && g <= 400 ? g : null;
    const r = (await q(`UPDATE ${tabella} SET giorno=$2 WHERE id=$1 RETURNING id, giorno`,
      [req.params.id, giorno])).rows[0];
    if (!r) return res.status(404).json({ error: 'Non trovata' });
    res.json(r);
  }));
}

// Fissare la partenza: i numeri dei giorni diventano date vere, tutte insieme.
// Il numero del giorno non si cancella: se la partenza slitta di una settimana
// si premono di nuovo e tutto si sposta insieme, invece di correggere a mano
// venti date una per una.
router.post('/trips/:id/fissa-partenza', wrap(async (req, res) => {
  const partenza = dataDelGiorno(req.body?.data, 1);
  if (!partenza) return res.status(400).json({ error: 'Serve il giorno della partenza' });
  const tripId = req.params.id;
  const legs = (await q('SELECT id, giorno FROM legs WHERE trip_id=$1 AND giorno IS NOT NULL ORDER BY giorno', [tripId])).rows;
  const soste = (await q(`SELECT id, giorno, from_date, to_date FROM stops
    WHERE trip_id=$1 AND giorno IS NOT NULL ORDER BY giorno`, [tripId])).rows;
  if (!legs.length && !soste.length) return res.status(400).json({
    error: 'Nessun giorno teorico da trasformare: metti prima i numeri dei giorni sulle tappe' });

  const date = [];
  for (const l of legs) {
    const d = dataDelGiorno(partenza, l.giorno);
    if (!d) continue;
    await q('UPDATE legs SET date=$2 WHERE id=$1', [l.id, d]);
    date.push(d);
  }
  for (const s of soste) {
    const d = dataDelGiorno(partenza, s.giorno);
    if (!d) continue;
    // Una sosta di tre notti resta di tre notti: si sposta, non si accorcia
    const notti = Math.max(0, (giornoDellaData(s.from_date, s.to_date) || 1) - 1);
    const fine = s.to_date ? dataDelGiorno(d, notti + 1) : null;
    await q('UPDATE stops SET from_date=$2, to_date=$3 WHERE id=$1', [s.id, d, fine]);
    date.push(fine || d);
  }
  const ultima = date.sort().pop() || partenza;
  const trip = (await q('SELECT start_date, end_date FROM trips WHERE id=$1', [tripId])).rows[0];
  await q('UPDATE trips SET start_date=$2, end_date=COALESCE(end_date,$3) WHERE id=$1',
    [tripId, partenza, ultima]);
  res.json({ ok: true, partenza, ultima, tappe: legs.length, soste: soste.length,
    fine_tenuta: !!trip?.end_date });
}));

// ---------- le strade possibili ----------
// Non sono tappe: una tappa e' una strada che si fara', queste sono quelle fra
// cui si sta decidendo. Si tengono li' coi loro numeri - km, ore, gasolio -
// finche' non si sceglie, perche' e' su quei numeri che si sceglie.
const puntiBuoni = punti => (punti || [])
  .filter(p => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon))
  .map(p => ({ name: String(p.name || p.nome || '').slice(0, 200), lat: +p.lat, lon: +p.lon }))
  .slice(0, 12);

export async function contaVarianti(punti) {
  const s = (await q(`SELECT value FROM settings WHERE key='vehicle'`)).rows[0]?.value || {};
  const kmL = num(s.km_per_liter, 10) || 10;
  const prezzo = num(s.fuel_price, 1.75);
  const tariffa = num(s.toll_per_km, 0.09);
  return (await percorsiConTappe(punti)).map(v => ({
    ...v,
    litri: +(v.distance_km / kmL).toFixed(1),
    gasolio: +(v.distance_km / kmL * prezzo).toFixed(2),
    // Dei pedaggi si conoscono i chilometri, non la tariffa: il costo e' una stima
    pedaggio: v.pedaggio_km != null ? +(v.pedaggio_km * tariffa).toFixed(2) : null,
  }));
}

const percorsiDi = async tripId => (await q(`SELECT p.*, u.name AS chi,
    EXISTS(SELECT 1 FROM legs l WHERE l.percorso_id = p.id) AS in_mappa,
    (SELECT count(*) FROM legs l WHERE l.percorso_id = p.id)::int AS quante_tappe
  FROM percorsi p LEFT JOIN users u ON u.id = p.user_id
  WHERE p.trip_id=$1 ORDER BY p.id`, [tripId])).rows;

// Mettere una strada in mappa vuol dire tradurre la sua variante scelta in
// tappe del viaggio: da quel momento i suoi chilometri entrano nei totali e la
// sua linea si vede. Si rifa' da zero ogni volta - prima si toglie quel che
// c'era - cosi' premere due volte non raddoppia niente e cambiare variante
// ridisegna invece di aggiungere.
//
// Le tappe nascono «da confermare»: vengono da una strada che si sta ancora
// confrontando, e dire il contrario sarebbe darsi una certezza che non c'e'.
async function inMappa(percorso) {
  await q('DELETE FROM legs WHERE percorso_id=$1', [percorso.id]);
  const tappe = tappeDaPercorso(percorso);
  if (!tappe.length) return 0;
  // Se la strada e' la tratta di un giorno, il numero del giorno viene con lei:
  // da li' «fissa la partenza» lo trasforma in una data.
  const giorno = percorso.giorno_id
    ? (await q('SELECT numero FROM giorni WHERE id=$1', [percorso.giorno_id])).rows[0]?.numero ?? null
    : null;
  const base = +(await q('SELECT coalesce(max(position),-1)+1 AS p FROM legs WHERE trip_id=$1',
    [percorso.trip_id])).rows[0].p;
  for (const t of tappe) {
    await q(`INSERT INTO legs (trip_id, percorso_id, position, from_name, from_lat, from_lon,
      to_name, to_lat, to_lon, distance_km, duration_min, geometry, pedaggio_km, giorno, da_confermare)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)`,
    [percorso.trip_id, percorso.id, base + t.posizione, t.from_name, t.from_lat, t.from_lon,
      t.to_name, t.to_lat, t.to_lon, t.distance_km, t.duration_min,
      t.geometry ? JSON.stringify(t.geometry) : null, t.pedaggio_km, giorno]);
  }
  return tappe.length;
}

const fuoriMappa = async percorsoId => +(await q(
  'DELETE FROM legs WHERE percorso_id=$1 RETURNING id', [percorsoId])).rowCount;

async function nuovoPercorso(tripId, userId, nome, punti) {
  const buoni = puntiBuoni(punti);
  if (buoni.length < 2) return null;
  let varianti = null;
  try { varianti = await contaVarianti(buoni); } catch { /* il calcolatore non risponde: si riprova col tasto */ }
  const r = (await q(`INSERT INTO percorsi (trip_id, user_id, nome, punti, varianti, scelta)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tripId, userId, nome || `${buoni[0].name || 'partenza'} → ${buoni[buoni.length - 1].name || 'arrivo'}`,
      JSON.stringify(buoni), varianti ? JSON.stringify(varianti) : null, varianti?.[0]?.chiave || null])).rows[0];
  return (await percorsiDi(tripId)).find(x => x.id === r.id);
}

router.post('/trips/:id/percorsi', wrap(async (req, res) => {
  const p = await nuovoPercorso(req.params.id, req.user.id, req.body?.nome, req.body?.punti);
  if (!p) return res.status(400).json({ error: 'Servono almeno partenza e arrivo, col loro posto sulla mappa' });
  res.json(p);
}));

router.put('/percorsi/:id', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM percorsi WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Strada non trovata' });
  const b = req.body || {};
  const r = (await q(`UPDATE percorsi SET nome=$2, perche=$3, scelta=$4, da_confermare=$5 WHERE id=$1 RETURNING id`,
    [cur.id,
      b.nome == null ? cur.nome : String(b.nome).trim().slice(0, 200) || null,
      b.perche == null ? cur.perche : String(b.perche).trim().slice(0, 500) || null,
      b.scelta == null ? cur.scelta : String(b.scelta).slice(0, 40) || null,
      b.da_confermare == null ? cur.da_confermare : !!b.da_confermare])).rows[0];
  // Se la strada era in mappa e si e' cambiata variante, la mappa deve seguire:
  // scegliere «senza pedaggi» e vedere ancora l'autostrada sarebbe una bugia.
  const nuova = (await q('SELECT * FROM percorsi WHERE id=$1', [cur.id])).rows[0];
  if (nuova.scelta !== cur.scelta
    && (await q('SELECT 1 FROM legs WHERE percorso_id=$1 LIMIT 1', [cur.id])).rowCount) await inMappa(nuova);
  res.json((await percorsiDi(cur.trip_id)).find(x => x.id === r.id));
}));

// Il tasto: «inserisci percorso su mappa» e «togli da mappa». Quello che e' in
// mappa fa il totale del viaggio; quello che non c'e' resta un'alternativa, coi
// suoi numeri sotto gli occhi ma fuori dai conti.
router.put('/percorsi/:id/in-mappa', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM percorsi WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Strada non trovata' });
  const dentro = !!req.body?.dentro;
  const quante = dentro ? await inMappa(cur) : await fuoriMappa(cur.id);
  if (dentro && !quante) return res.status(400).json({
    error: 'Questa strada non ha ancora i suoi numeri: premi \ud83d\udd04 per farli contare, poi mettila in mappa' });
  res.json({ ok: true, dentro, tappe: quante });
}));

router.post('/percorsi/:id/ricalcola', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM percorsi WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Strada non trovata' });
  const varianti = await contaVarianti(cur.punti);
  await q('UPDATE percorsi SET varianti=$2 WHERE id=$1', [cur.id, JSON.stringify(varianti)]);
  res.json((await percorsiDi(cur.trip_id)).find(x => x.id === cur.id));
}));

router.delete('/percorsi/:id', wrap(async (req, res) => {
  // Le tappe che quella strada aveva messo in mappa se ne vanno con lei: erano
  // quella strada, e lasciarle li' vorrebbe dire lasciare in mappa dei pezzi
  // che non si possono piu' togliere da nessuna parte.
  const tappe = await fuoriMappa(req.params.id);
  await q('DELETE FROM percorsi WHERE id=$1', [req.params.id]);
  res.json({ ok: true, tappe });
}));

// ---------- le ipotesi di viaggio ----------
// Una direzione presa per intero: «le Lofoten», e sotto i giorni che servono ad
// arrivarci. Ne stanno piu' di una accanto, ognuna col suo conto, finche' non
// si scegle - ed e' sul conto che si scegle.
const unIpotesi = async id => (await q('SELECT * FROM ipotesi WHERE id=$1', [id])).rows[0];
const testo = (v, max) => v == null ? null : String(v).trim().slice(0, max) || null;

router.post('/trips/:id/ipotesi', wrap(async (req, res) => {
  const b = req.body || {};
  const dest = testo(b.destinazione, 200);
  const r = (await q(`INSERT INTO ipotesi (trip_id, user_id, nome, destinazione, dest_lat, dest_lon, perche)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
  [req.params.id, req.user.id, testo(b.nome, 200) || dest, dest,
    Number.isFinite(+b.lat) ? +b.lat : null, Number.isFinite(+b.lon) ? +b.lon : null,
    testo(b.perche, 1000)])).rows[0];
  res.json({ ok: true, id: r.id });
}));

router.put('/ipotesi/:id', wrap(async (req, res) => {
  const cur = await unIpotesi(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Ipotesi non trovata' });
  const b = req.body || {};
  const tieni = (nuovo, vecchio, max) => nuovo === undefined ? vecchio : testo(nuovo, max);
  await q(`UPDATE ipotesi SET nome=$2, destinazione=$3, dest_lat=$4, dest_lon=$5, perche=$6, stato=$7 WHERE id=$1`,
    [cur.id, tieni(b.nome, cur.nome, 200), tieni(b.destinazione, cur.destinazione, 200),
      b.lat === undefined ? cur.dest_lat : (Number.isFinite(+b.lat) ? +b.lat : null),
      b.lon === undefined ? cur.dest_lon : (Number.isFinite(+b.lon) ? +b.lon : null),
      tieni(b.perche, cur.perche, 1000),
      ['aperta', 'scelta', 'scartata'].includes(b.stato) ? b.stato : cur.stato]);
  res.json({ ok: true });
}));

router.delete('/ipotesi/:id', wrap(async (req, res) => {
  // Le tappe che questa ipotesi aveva messo in mappa se ne vanno con lei. Le
  // strade no: tornano fra quelle che si stanno guardando, perche' una strada
  // vale anche per un'altra direzione.
  const tappe = +(await q(`DELETE FROM legs WHERE percorso_id IN
    (SELECT p.id FROM percorsi p JOIN giorni g ON g.id = p.giorno_id WHERE g.ipotesi_id=$1)
    RETURNING id`, [req.params.id])).rowCount;
  await q('DELETE FROM ipotesi WHERE id=$1', [req.params.id]);
  res.json({ ok: true, tappe });
}));

// ---------- i giorni di un'ipotesi ----------
const rinumera = async ipotesiId => {
  const righe = (await q('SELECT id FROM giorni WHERE ipotesi_id=$1 ORDER BY numero, id', [ipotesiId])).rows;
  for (let i = 0; i < righe.length; i++) {
    await q('UPDATE giorni SET numero=$2 WHERE id=$1', [righe[i].id, i + 1]);
    // Le tappe gia' in mappa seguono il numero nuovo. Un giorno che si
    // rinumera lasciando indietro le sue tappe e' un calendario che mente, e
    // «fissa la partenza» ci costruirebbe sopra delle date sbagliate.
    await q(`UPDATE legs SET giorno=$2 WHERE percorso_id IN (SELECT id FROM percorsi WHERE giorno_id=$1)`,
      [righe[i].id, i + 1]);
  }
};

router.post('/ipotesi/:id/giorni', wrap(async (req, res) => {
  const ip = await unIpotesi(req.params.id);
  if (!ip) return res.status(404).json({ error: 'Ipotesi non trovata' });
  const b = req.body || {};
  const n = +(await q('SELECT coalesce(max(numero),0)+1 AS n FROM giorni WHERE ipotesi_id=$1', [ip.id])).rows[0].n;
  const r = (await q(`INSERT INTO giorni (ipotesi_id, numero, titolo, luoghi, notte, prezzo_notte)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id, numero`,
  [ip.id, n, testo(b.titolo, 200), testo(b.luoghi, 2000), testo(b.notte, 200),
    Number.isFinite(+b.prezzo_notte) && b.prezzo_notte !== null && b.prezzo_notte !== '' ? +b.prezzo_notte : null])).rows[0];
  res.json({ ok: true, ...r });
}));

router.put('/giorni/:id', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM giorni WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Giorno non trovato' });
  const b = req.body || {};
  const tieni = (nuovo, vecchio, max) => nuovo === undefined ? vecchio : testo(nuovo, max);
  const prezzo = b.prezzo_notte === undefined ? cur.prezzo_notte
    : (b.prezzo_notte === null || b.prezzo_notte === '' || !Number.isFinite(+b.prezzo_notte) ? null : +b.prezzo_notte);
  await q('UPDATE giorni SET titolo=$2, luoghi=$3, notte=$4, prezzo_notte=$5 WHERE id=$1',
    [cur.id, tieni(b.titolo, cur.titolo, 200), tieni(b.luoghi, cur.luoghi, 2000),
      tieni(b.notte, cur.notte, 200), prezzo]);
  res.json({ ok: true });
}));

router.delete('/giorni/:id', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM giorni WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Giorno non trovato' });
  // Le tappe in mappa di questo giorno se ne vanno; le strade tornano libere
  await q(`DELETE FROM legs WHERE percorso_id IN (SELECT id FROM percorsi WHERE giorno_id=$1)`, [cur.id]);
  await q('DELETE FROM giorni WHERE id=$1', [cur.id]);
  // Togliendo il terzo di cinque giorni, il quarto diventa il terzo: i numeri
  // con un buco in mezzo non sono piu' dei giorni
  await rinumera(cur.ipotesi_id);
  res.json({ ok: true });
}));

// Una strada diventa la tratta di un giorno, o torna fra quelle libere
router.put('/percorsi/:id/in-giorno', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM percorsi WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Strada non trovata' });
  const gid = req.body?.giorno_id;
  const giorno = gid == null || gid === '' ? null
    : (await q('SELECT g.* FROM giorni g JOIN ipotesi i ON i.id=g.ipotesi_id WHERE g.id=$1 AND i.trip_id=$2',
      [gid, cur.trip_id])).rows[0];
  if (gid != null && gid !== '' && !giorno) return res.status(400).json({ error: 'Quel giorno non e’ di questo viaggio' });
  await q('UPDATE percorsi SET giorno_id=$2 WHERE id=$1', [cur.id, giorno?.id ?? null]);
  // Se era in mappa, le sue tappe prendono (o perdono) il numero del giorno
  if ((await q('SELECT 1 FROM legs WHERE percorso_id=$1 LIMIT 1', [cur.id])).rowCount) {
    await q('UPDATE legs SET giorno=$2 WHERE percorso_id=$1', [cur.id, giorno?.numero ?? null]);
  }
  res.json({ ok: true, giorno: giorno?.numero ?? null });
}));

// Tutta l'ipotesi in mappa: ogni tratta di ogni giorno diventa una tappa, col
// suo numero di giorno. E' il momento in cui una direzione smette di essere
// un'idea e comincia a fare il totale del viaggio.
router.put('/ipotesi/:id/in-mappa', wrap(async (req, res) => {
  const ip = await unIpotesi(req.params.id);
  if (!ip) return res.status(404).json({ error: 'Ipotesi non trovata' });
  const strade = (await q(`SELECT p.* FROM percorsi p JOIN giorni g ON g.id = p.giorno_id
    WHERE g.ipotesi_id=$1 ORDER BY g.numero, g.id, p.id`, [ip.id])).rows;
  if (!req.body?.dentro) {
    let via = 0;
    for (const p of strade) via += await fuoriMappa(p.id);
    return res.json({ ok: true, dentro: false, tappe: via });
  }
  if (!strade.length) return res.status(400).json({
    error: 'Questa ipotesi non ha ancora nessuna tratta: aggiungi un giorno e dagli una strada' });

  // In mappa ce ne sta una per volta. Due direzioni insieme fanno un totale che
  // non vuol dire niente - le Lofoten piu' la Spagna, 799 km - e il totale del
  // viaggio e' il numero su cui si decide. Le altre non si perdono: escono
  // dalla mappa e restano li' coi loro giorni e il loro conto.
  const uscite = (await q(`SELECT DISTINCT i.id, i.nome, i.destinazione
    FROM ipotesi i JOIN giorni g ON g.ipotesi_id = i.id JOIN percorsi p ON p.giorno_id = g.id
    JOIN legs l ON l.percorso_id = p.id WHERE i.trip_id=$1 AND i.id <> $2`, [ip.trip_id, ip.id])).rows;
  for (const altra of uscite) {
    await q(`DELETE FROM legs WHERE percorso_id IN
      (SELECT p.id FROM percorsi p JOIN giorni g ON g.id = p.giorno_id WHERE g.ipotesi_id=$1)`, [altra.id]);
  }

  let quante = 0, senzaNumeri = 0;
  for (const p of strade) {
    const n = await inMappa(p);
    quante += n;
    if (!n) senzaNumeri++;
  }
  if (!quante) return res.status(400).json({
    error: 'Nessuna tratta ha i suoi numeri: premi 🔄 sulle strade per farli contare' });
  res.json({ ok: true, dentro: true, tappe: quante, senza_numeri: senzaNumeri,
    uscite: uscite.map(x => x.nome || x.destinazione || `ipotesi ${x.id}`) });
}));

// ---------- la cassetta ----------
// Un tasto solo: ci si butta dentro un link, un codice o due righe scritte, e
// quello che ne esce lo decide lei. Dice sempre cosa ha capito - indovinare in
// silenzio e' peggio che chiedere - e quel che ha fatto si corregge con un
// tocco.
router.post('/trips/:id/cassetta', wrap(async (req, res) => {
  const tripId = req.params.id;
  let letto = capisciIncollato(req.body?.testo);

  // Un indirizzo accorciato non dice niente finche' non lo si segue
  if (letto.tipo === 'maps-corto') {
    let disteso = null;
    try { disteso = await seguiLinkBreve(letto.url); } catch { /* non si lascia seguire */ }
    letto = disteso ? capisciIncollato(disteso) : { tipo: 'link', url: letto.url };
  }

  const proposta = async (nome, lat, lon, p4n, tipoP4n) => {
    const r = (await q(`INSERT INTO proposte (trip_id, user_id, nome, lat, lon, p4n_id, link, tipo_p4n)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tripId, req.user.id, nome, lat, lon, p4n || null, linkPark4nightPosto(p4n), tipoP4n || null])).rows[0];
    return (await proposteDi(tripId)).find(x => x.id === r.id);
  };
  const materiale = async (tipo, titolo, testo, url) => (await q(
    `INSERT INTO materiali (trip_id, user_id, tipo, titolo, testo, url) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tripId, req.user.id, tipo, titolo, testo, url])).rows[0];

  if (letto.tipo === 'park4night') {
    const posto = await leggiPosto(letto.p4n_id);
    const riga = await proposta(posto?.nome || `park4night ${letto.p4n_id}`, posto?.lat ?? null, posto?.lon ?? null,
      letto.p4n_id, posto?.tipo);
    return res.json({ cosa: 'proposta', riga,
      detto: posto ? `In lavagna: ${posto.nome}` : `In lavagna col solo codice ${letto.p4n_id}: la scheda non si è lasciata leggere, il posto mettilo tu` });
  }

  if (letto.tipo === 'maps-punto') {
    // Nel link c'e' scritto «Innsbruck», non «47.26, 11.40»: il nome si cerca,
    // altrimenti il posto non si apre in Maps e non sta sulla mappa.
    const { punti, mancanti } = await completaPunti([letto.punto], geocode, centroDelLink(letto.url));
    const p = punti[0] || letto.punto;
    const riga = await proposta(p.name || 'Un posto da Maps', p.lat ?? null, p.lon ?? null, null, null);
    return res.json({ cosa: 'proposta', riga, detto: mancanti.length
      ? `In lavagna: ${riga.nome} — ma dov'è non l’ho trovato, il posto sulla mappa mettilo tu`
      : `In lavagna: ${riga.nome}` });
  }

  if (letto.tipo === 'maps-percorso') {
    // Google scrive i nomi dei posti, non le loro coordinate. Senza coordinate
    // una strada non ha km, né ore, né gasolio - e sono quelli il motivo per
    // cui la strada sta in elenco. Quindi si cercano, e quel che non si trova
    // si dice invece di sparire.
    const { punti, mancanti } = await completaPunti(letto.punti, geocode, centroDelLink(letto.url));
    const fuori = mancanti.length ? ` (${mancanti.join(', ')}: non li ho trovati, sono rimasti fuori)` : '';
    const riga = punti.length > 1 ? await nuovoPercorso(tripId, req.user.id, null, punti) : null;
    if (riga) return res.json({ cosa: 'percorso', riga, detto: `Una strada possibile: ${riga.nome}${fuori}` });
    const m = await materiale('link', 'Indicazioni da Maps', null, letto.url);
    return res.json({ cosa: 'link', riga: m, detto: mancanti.length
      ? `Dei posti del link non ho trovato ${mancanti.join(', ')}: il link sta fra la roba utile`
      : 'Dal link non ho ricavato dei punti: l’ho messo fra la roba utile' });
  }

  if (letto.tipo === 'link') {
    let titolo = null;
    try { titolo = await titoloDellaPagina(letto.url); } catch { /* pagina muta: resta l'indirizzo */ }
    const m = await materiale('link', titolo || new URL(letto.url).hostname.replace(/^www\./, ''), null, letto.url);
    return res.json({ cosa: 'link', riga: m, detto: `Fra la roba utile: ${m.titolo}` });
  }

  const testo = String(letto.testo || '').trim();
  if (!testo) return res.status(400).json({ error: 'Non c’è niente da mettere via' });
  const m = await materiale('nota', testo.split('\n')[0].slice(0, 80), testo, null);
  return res.json({ cosa: 'nota', riga: m, detto: 'Segnato fra gli appunti' });
}));
