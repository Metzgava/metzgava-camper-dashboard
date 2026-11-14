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
import { gasolioPrevisto, campeggiPrevisti } from '../lib/budget.js';
import { capisciIncollato } from '../lib/cassetta.js';
import { leggiPosto } from '../lib/park4night.js';
import { linkPark4nightPosto, percorsiConTappe } from '../lib/geo.js';
import { seguiLinkBreve } from '../lib/maps.js';
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
    const km = +(await q(`SELECT coalesce(sum(distance_km) FILTER (WHERE mezzo='camper'),0)::float AS km FROM legs WHERE trip_id=$1`, [trip.id])).rows[0].km;
    const daConfermare = +(await q(`SELECT (SELECT count(*) FROM legs WHERE trip_id=$1 AND da_confermare)
      + (SELECT count(*) FROM stops WHERE trip_id=$1 AND da_confermare)
      + (SELECT count(*) FROM percorsi WHERE trip_id=$1 AND da_confermare) AS n`, [trip.id])).rows[0].n;
    const budget = await budgetDi(trip, proposte);
    fuori.push({ ...trip, km: Math.round(km), scelti: proposte.filter(p => p.stato === 'scelto').length,
      proposti: proposte.length, da_confermare: daConfermare, ipotesi: budget.totale,
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
  };
  res.json({ trip, proposte, liste, legs, soste, percorsi, numeri, budget: await budgetDi(trip, proposte),
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

const percorsiDi = async tripId => (await q(`SELECT p.*, u.name AS chi FROM percorsi p
  LEFT JOIN users u ON u.id = p.user_id WHERE p.trip_id=$1 ORDER BY p.id`, [tripId])).rows;

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
  res.json((await percorsiDi(cur.trip_id)).find(x => x.id === r.id));
}));

router.post('/percorsi/:id/ricalcola', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM percorsi WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Strada non trovata' });
  const varianti = await contaVarianti(cur.punti);
  await q('UPDATE percorsi SET varianti=$2 WHERE id=$1', [cur.id, JSON.stringify(varianti)]);
  res.json((await percorsiDi(cur.trip_id)).find(x => x.id === cur.id));
}));

router.delete('/percorsi/:id', wrap(async (req, res) => {
  await q('DELETE FROM percorsi WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
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
    const p = letto.punto;
    const riga = await proposta(p.name || 'Un posto da Maps', p.lat, p.lon, null, null);
    return res.json({ cosa: 'proposta', riga, detto: `In lavagna: ${riga.nome}` });
  }

  if (letto.tipo === 'maps-percorso') {
    const riga = await nuovoPercorso(tripId, req.user.id, null, letto.punti);
    if (riga) return res.json({ cosa: 'percorso', riga, detto: `Una strada possibile: ${riga.nome}` });
    const m = await materiale('link', 'Indicazioni da Maps', null, letto.url);
    return res.json({ cosa: 'link', riga: m, detto: 'Dal link non ho ricavato dei punti: l’ho messo fra la roba utile' });
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
