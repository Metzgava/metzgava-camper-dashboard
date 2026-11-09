// Far vedere un viaggio a chi non e' di casa.
//
// Un invito con account fa entrare qualcuno nell'archivio: vede tutto e puo'
// scrivere. Per i nonni, per gli amici, per chi deve solo guardare, serve
// un'altra cosa: un indirizzo lungo da mandare, che apre una pagina di sola
// lettura e niente altro. Nessuna registrazione, nessuna password - e quello
// che si vede lo decide chi manda il link: quali viaggi, se le foto e i video,
// se i conti, gli allenamenti di chi, e se si possono rivedere i percorsi.
//
// Il filtro sta qui, non nella pagina: la pagina dell'ospite riceve gia' i dati
// ripuliti, cosi' quello che non deve vedere non gli arriva nemmeno.
import { Router } from 'express';
import { q } from '../lib/db.js';
import { wrap, randomToken } from '../lib/util.js';
import { requireAuth, requireAdmin } from './auth.js';
import { datiViaggio, elencoViaggi } from './trips.js';

export const router = Router();

// Un link vale finche' non scade e finche' non lo spegni. Scaduto o spento,
// non e' un errore da spiegare: semplicemente non apre piu' niente.
export async function linkValido(token) {
  if (!token || typeof token !== 'string') return null;
  return (await q(`SELECT * FROM shares WHERE token=$1 AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())`, [token])).rows[0] || null;
}

// Quali viaggi apre questo link. Senza una scelta precisa valgono quelli in
// corso e conclusi: i viaggi in costruzione sono appunti, non si mostrano a
// meno che non li si spunti uno per uno.
export async function viaggiVisibili(s) {
  const scelti = Array.isArray(s.viaggi) ? s.viaggi.map(Number).filter(Boolean) : null;
  const sql = scelti?.length
    ? ['SELECT id FROM trips WHERE id = ANY($1) ORDER BY id', [scelti]]
    : [`SELECT id FROM trips WHERE status <> 'bozza' ORDER BY id`, []];
  return (await q(sql[0], sql[1])).rows.map(r => r.id);
}

const atletiDi = s => (Array.isArray(s.allenamenti) ? s.allenamenti : []).map(Number).filter(Boolean);

// Cosa sa fare questa pagina: la manda insieme ai dati, cosi' la pagina
// dell'ospite non deve indovinare quali pezzi disegnare.
const permessi = s => ({ tracciati: s.tracciati, foto: s.foto, spese: s.spese, allenamenti: atletiDi(s).length > 0 });

// La scheda di un viaggio, tolto quello che l'ospite non deve vedere. Non si
// nasconde con la grafica: quello che non gli spetta non esce da qui.
function ripulisci(d, s) {
  const atleti = atletiDi(s);
  const workouts = d.workouts.filter(w => atleti.includes(w.user_id));
  const photos = s.foto ? d.photos : [];
  const soste = d.soste.map(x => ({ ...x, cost: s.spese ? x.cost : null }));
  const legs = s.spese ? d.legs : d.legs.map(l => ({ ...l, tariffa: null, fuel_price: null, condizioni: null, sconto: null }));
  const totals = s.spese ? d.totals
    : { ...d.totals, total: 0, by_category: [], cost_per_km: null, liters: 0 };
  return {
    // Del viaggio bastano il nome, le date e di chi e': gli appunti di casa no
    trip: { id: d.trip.id, title: d.trip.title, start_date: d.trip.start_date, end_date: d.trip.end_date,
      status: d.trip.status, owner: d.trip.owner, cover_photo_id: s.foto ? d.trip.cover_photo_id : null },
    legs, soste, photos, workouts, totals,
    expenses: s.spese ? d.expenses : [],
    materiali: [],                      // il materiale con cui si prepara un viaggio resta di casa
    permessi: permessi(s),
  };
}

// ---- quello che vede l'ospite ----
const conLink = wrap(async (req, res, next) => {
  const s = await linkValido(req.params.token);
  if (!s) return res.status(403).json({ error: 'Questo link non e’ piu’ valido' });
  req.share = s;
  next();
});

router.get('/pubblico/:token/viaggi', conLink, wrap(async (req, res) => {
  const s = req.share;
  const ids = await viaggiVisibili(s);
  const tutti = await elencoViaggi();
  const viaggi = tutti.filter(t => ids.includes(t.id)).map(t => ({
    id: t.id, title: t.title, start_date: t.start_date, end_date: t.end_date, status: t.status,
    owner: t.owner, km: t.km, n_legs: t.n_legs, mete: t.mete, rotta: t.rotta,
    minuti_guida: t.minuti_guida, minuti_strada: t.minuti_strada,
    n_photos: s.foto ? t.n_photos : 0,
    n_workouts: atletiDi(s).length ? t.n_workouts : 0,
    cover: s.foto ? t.cover : null, cover_crop: s.foto ? t.cover_crop : null,
    total: s.spese ? t.total : null,
  }));
  res.json({ viaggi, permessi: permessi(s), nome: s.nome || null });
}));

router.get('/pubblico/:token/trips/:id', conLink, wrap(async (req, res) => {
  const ids = await viaggiVisibili(req.share);
  if (!ids.includes(+req.params.id)) return res.status(403).json({ error: 'Questo viaggio non fa parte del link' });
  const d = await datiViaggio(req.params.id);
  if (!d) return res.status(404).json({ error: 'Viaggio non trovato' });
  res.json(ripulisci(d, req.share));
}));

// ---- i link, dalla parte di chi li manda ----
router.get('/shares', requireAuth, requireAdmin, wrap(async (req, res) => {
  const righe = (await q(`SELECT s.*, u.name AS chi FROM shares s LEFT JOIN users u ON u.id=s.created_by
    ORDER BY s.revoked_at IS NOT NULL, s.id DESC`)).rows;
  const atleti = (await q(`SELECT id, name FROM users ORDER BY id`)).rows;
  const viaggi = (await q(`SELECT id, title, start_date, status FROM trips
    ORDER BY coalesce(start_date, created_at::date) DESC, id DESC`)).rows;
  res.json({ shares: righe, atleti, viaggi });
}));

router.post('/shares', requireAuth, requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const giorni = Number(b.giorni) > 0 ? Math.min(3650, Math.round(Number(b.giorni))) : null;
  const viaggi = Array.isArray(b.viaggi) && b.viaggi.length ? b.viaggi.map(Number).filter(Boolean) : null;
  const allenamenti = Array.isArray(b.allenamenti) ? b.allenamenti.map(Number).filter(Boolean) : [];
  const row = (await q(`INSERT INTO shares(token, nome, created_by, viaggi, tracciati, foto, spese, allenamenti, expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $9::int IS NULL THEN NULL ELSE now() + ($9::int * interval '1 day') END) RETURNING *`,
    [randomToken(18), String(b.nome || '').trim().slice(0, 80) || null, req.user.id,
      viaggi ? JSON.stringify(viaggi) : null, b.tracciati !== false, b.foto !== false, b.spese === true,
      JSON.stringify(allenamenti), giorni])).rows[0];
  console.log(`link di sola lettura creato dall'utente ${req.user.id}`);
  res.json(row);
}));

router.post('/shares/:id/revoca', requireAuth, requireAdmin, wrap(async (req, res) => {
  const riacceso = req.body?.riacceso === true;
  const row = (await q(`UPDATE shares SET revoked_at=$2 WHERE id=$1 RETURNING *`,
    [req.params.id, riacceso ? null : new Date()])).rows[0];
  if (!row) return res.status(404).json({ error: 'Link non trovato' });
  res.json(row);
}));

router.delete('/shares/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  await q('DELETE FROM shares WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Una visita si segna: serve a sapere se il link e' arrivato e se qualcuno
// l'ha aperto. Non si tiene chi era: non e' gente che si deve schedare.
export async function segnaVisita(id) {
  await q('UPDATE shares SET viste=viste+1, ultima_vista=now() WHERE id=$1', [id]).catch(() => {});
}
