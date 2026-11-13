// La lavagna dei posti: quello che qualcuno ha visto e vorrebbe, prima che
// diventi una tappa del viaggio. Una proposta non è ancora niente - non ha una
// data, non sta in nessun giro, non costa niente - ma ha un nome, un puntino,
// chi l'ha proposta e due righe di perché. È il posto dove finiscono le cose
// che prima si dicevano a voce e si perdevano.
import { Router } from 'express';
import { q } from '../lib/db.js';
import { wrap, num } from '../lib/util.js';
import { requireAuth } from './auth.js';
import { leggiPosto, tipoSostaDa } from '../lib/park4night.js';
import { linkPark4nightPosto, numeroPark4night } from '../lib/geo.js';

export const router = Router();
router.use(requireAuth);

const TIPI = ['pernotto', 'sosta', 'visita'];
const STATI = ['proposto', 'guardare', 'scelto', 'scartato'];

// Una proposta si legge sempre con chi l'ha messa e cosa ne pensano gli altri:
// senza quelli e' un elenco di posti, non una discussione. La query sta qui e
// la usa anche la pagina del viaggio, cosi' c'e' un posto solo dove cambiarla.
const CAMPI = `p.*, u.name AS chi, coalesce((
    SELECT json_agg(json_build_object('user_id', v.user_id, 'nome', w.name, 'voto', v.voto, 'commento', v.commento) ORDER BY w.name)
    FROM proposte_voti v JOIN users w ON w.id = v.user_id WHERE v.proposta_id = p.id), '[]'::json) AS voti`;

export const proposteDi = async tripId => (await q(
  `SELECT ${CAMPI} FROM proposte p LEFT JOIN users u ON u.id = p.user_id
   WHERE p.trip_id=$1 ORDER BY p.posizione, p.id`, [tripId])).rows;

const unaProposta = async id => (await q(
  `SELECT ${CAMPI} FROM proposte p LEFT JOIN users u ON u.id = p.user_id WHERE p.id=$1`, [id])).rows[0];

// Quello che si puo' scrivere su una proposta, ripulito. Il prezzo e' a notte e
// resta qui: non diventa mai il costo di una sosta, perche' una sosta che costa
// diventa da sola una spesa vera del viaggio - e qui non si e' ancora speso
// niente.
const datiProposta = (b, vecchia = {}) => {
  const p4n = numeroPark4night(b?.p4n_id ?? vecchia.p4n_id);
  const quanto = b?.prezzo ?? vecchia.prezzo;
  return {
    nome: String(b?.nome ?? vecchia.nome ?? '').trim().slice(0, 200),
    tipo: TIPI.includes(b?.tipo) ? b.tipo : (TIPI.includes(vecchia.tipo) ? vecchia.tipo : 'pernotto'),
    lat: b?.lat === '' || b?.lat == null ? (b && 'lat' in b ? null : vecchia.lat ?? null) : num(b.lat),
    lon: b?.lon === '' || b?.lon == null ? (b && 'lon' in b ? null : vecchia.lon ?? null) : num(b.lon),
    p4n_id: p4n,
    link: linkPark4nightPosto(p4n) || String(b?.link ?? vecchia.link ?? '').trim().slice(0, 500) || null,
    tipo_p4n: String(b?.tipo_p4n ?? vecchia.tipo_p4n ?? '').trim().slice(0, 80) || null,
    prezzo: quanto === '' || quanto == null ? null : num(quanto),
    currency: String(b?.currency ?? vecchia.currency ?? '').trim().slice(0, 3).toUpperCase() || null,
    perche: String(b?.perche ?? vecchia.perche ?? '').trim().slice(0, 2000) || null,
    perche_no: String(b?.perche_no ?? vecchia.perche_no ?? '').trim().slice(0, 500) || null,
  };
};

// Dal codice di park4night al posto. Chi incolla un codice si aspetta che il
// nome e il puntino si riempiano da soli: è il motivo per cui il codice vale
// la pena di metterlo.
router.get('/park4night/:codice', wrap(async (req, res) => {
  const posto = await leggiPosto(req.params.codice);
  // Codice che non esiste e pagina che non si lascia leggere sono la stessa
  // cosa per chi sta scrivendo: in tutti e due i casi tocca a lui.
  if (!posto) return res.status(404).json({ error: 'Questo codice non l’ho trovato: mettilo tu sulla mappa' });
  res.json({ ...posto, link: linkPark4nightPosto(posto.p4n_id) });
}));

// Un posto nuovo sulla lavagna. Chi lo mette resta scritto: fra tre mesi
// «l'aveva detto Cate» e' meta' della discussione.
router.post('/trips/:id/proposte', wrap(async (req, res) => {
  const d = datiProposta(req.body);
  if (!d.nome) return res.status(400).json({ error: 'Serve il nome del posto' });
  const r = (await q(`INSERT INTO proposte (trip_id, user_id, nome, tipo, lat, lon, p4n_id, link, tipo_p4n, prezzo, currency, perche)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [req.params.id, req.user.id, d.nome, d.tipo, d.lat, d.lon, d.p4n_id, d.link, d.tipo_p4n, d.prezzo, d.currency, d.perche])).rows[0];
  res.json(await unaProposta(r.id));
}));

router.put('/proposte/:id', wrap(async (req, res) => {
  const cur = (await q('SELECT * FROM proposte WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Proposta non trovata' });
  const stato = STATI.includes(req.body?.stato) ? req.body.stato : cur.stato;
  // Una proposta che e' gia' diventata sosta non torna indietro da sola: la
  // sosta resterebbe li', e lo stesso posto avrebbe due verita' diverse.
  if (cur.stop_id != null && stato !== 'scelto') return res.status(409).json({ error: 'Prima togli la sosta' });
  const d = datiProposta(req.body, cur);
  if (!d.nome) return res.status(400).json({ error: 'Serve il nome del posto' });
  await q(`UPDATE proposte SET nome=$2, tipo=$3, lat=$4, lon=$5, p4n_id=$6, link=$7, tipo_p4n=$8,
      prezzo=$9, currency=$10, perche=$11, stato=$12, perche_no=$13 WHERE id=$1`,
    [cur.id, d.nome, d.tipo, d.lat, d.lon, d.p4n_id, d.link, d.tipo_p4n, d.prezzo, d.currency, d.perche, stato, d.perche_no]);
  res.json(await unaProposta(cur.id));
}));

router.delete('/proposte/:id', wrap(async (req, res) => {
  await q('DELETE FROM proposte WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Il voto e' uno per persona e si cambia quando si vuole: non e' una votazione
// che decide, e' il modo di non doverne riparlare a voce ogni volta. Zero lo
// toglie, per chi ci ha ripensato e basta.
router.post('/proposte/:id/voto', wrap(async (req, res) => {
  const voto = Math.sign(num(req.body?.voto));
  const commento = String(req.body?.commento || '').trim().slice(0, 500) || null;
  if (!voto) await q('DELETE FROM proposte_voti WHERE proposta_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  else await q(`INSERT INTO proposte_voti (proposta_id, user_id, voto, commento) VALUES($1,$2,$3,$4)
    ON CONFLICT (proposta_id, user_id) DO UPDATE SET voto=EXCLUDED.voto, commento=EXCLUDED.commento, updated_at=now()`,
    [req.params.id, req.user.id, voto, commento]);
  res.json(await unaProposta(req.params.id));
}));

// Da proposta a sosta: e' l'unica cosa che «scelto» fa succedere davvero.
// Quello che la proposta sa gia' passa alla sosta, il prezzo no - una sosta che
// costa diventa da sola una spesa vera, datata oggi e cambiata al cambio di
// oggi, e un campeggio scelto a novembre finirebbe nei conti di un viaggio di
// giugno. Niente date: quelle arrivano quando il viaggio si conferma.
router.post('/proposte/:id/sosta', wrap(async (req, res) => {
  const p = (await q('SELECT * FROM proposte WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'Proposta non trovata' });

  const collega = async (stopId, gia) => {
    await q(`UPDATE proposte SET stato='scelto', stop_id=$2 WHERE id=$1`, [p.id, stopId]);
    const sosta = (await q('SELECT * FROM stops WHERE id=$1', [stopId])).rows[0];
    res.json({ proposta: await unaProposta(p.id), sosta, ...(gia ? { gia_cera: true } : {}) });
  };

  // Gia' fatta: si apre quella, non se ne fa una seconda
  if (p.stop_id != null) {
    const sua = (await q('SELECT id FROM stops WHERE id=$1', [p.stop_id])).rows[0];
    if (sua) return collega(sua.id, true);
  }
  // Lo stesso posto, arrivato per un'altra strada: capita, perche' una sosta si
  // puo' ancora aggiungere a mano. Due righe per lo stesso piazzale prima o poi
  // divergono, quindi si collega quella che c'e'.
  if (p.p4n_id) {
    const gemella = (await q('SELECT id FROM stops WHERE trip_id=$1 AND p4n_id=$2 LIMIT 1', [p.trip_id, p.p4n_id])).rows[0];
    if (gemella) return collega(gemella.id, true);
  }

  const nuova = (await q(`INSERT INTO stops (trip_id, name, lat, lon, kind, p4n_id, link, motivo, source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manuale') RETURNING id`,
    [p.trip_id, p.nome, p.lat, p.lon, tipoSostaDa(p.tipo, p.tipo_p4n), p.p4n_id, p.link, p.perche])).rows[0];
  return collega(nuova.id, false);
}));
