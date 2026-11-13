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

router.get('/trips/:id/pianifica', wrap(async (req, res) => {
  const trip = (await q('SELECT * FROM trips WHERE id=$1', [req.params.id])).rows[0];
  if (!trip) return res.status(404).json({ error: 'Viaggio non trovato' });
  const [proposte, liste] = await Promise.all([proposteDi(trip.id), listeDi(trip.id)]);
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
    da_confermare: legs.filter(l => l.da_confermare).length + soste.filter(s => s.da_confermare).length,
  };
  res.json({ trip, proposte, liste, legs, soste, numeri, budget: await budgetDi(trip, proposte) });
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
