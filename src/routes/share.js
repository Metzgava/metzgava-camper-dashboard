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
import { meteoDelGiorno } from '../lib/meteo.js';

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
    giornate: d.giornate || [],
    expenses: s.spese ? d.expenses : [],
    materiali: [],                      // il materiale con cui si prepara un viaggio resta di casa
    permessi: permessi(s),
  };
}

// Un numero di telefono si scrive in mille modi: con gli spazi, con i
// trattini, con lo zero zero davanti, senza prefisso. Qui dentro ne esiste uno
// solo, in forma internazionale, cosi' lo stesso numero non finisce due volte
// in rubrica e un link non parte per un numero che non e' quello.
export function numeroPulito(v) {
  let t = String(v || '').replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  // Senza prefisso si intende l'Italia: e' da li' che si scrivono i numeri
  if (!t.startsWith('+')) t = t.length >= 9 && t.length <= 11 ? '+39' + t : '';
  const cifre = t.slice(1);
  return /^\d{8,15}$/.test(cifre) ? '+' + cifre : null;
}

// ---- la rubrica ----
router.get('/rubrica', requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json((await q(`SELECT r.*,
      (SELECT count(*)::int FROM shares s WHERE s.contatto_id=r.id) AS link,
      (SELECT count(*)::int FROM shares s WHERE s.contatto_id=r.id AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > now())) AS link_attivi
    FROM rubrica r ORDER BY lower(r.nick)`)).rows);
}));

router.post('/rubrica', requireAuth, requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const nick = String(b.nick || '').trim().slice(0, 60);
  const telefono = numeroPulito(b.telefono);
  if (!nick) return res.status(400).json({ error: 'Serve un nome: un numero da solo, fra un anno, non dice a chi appartiene' });
  if (!telefono) return res.status(400).json({ error: 'Questo numero non sembra un numero di telefono' });
  const gia = (await q('SELECT nick FROM rubrica WHERE telefono=$1', [telefono])).rows[0];
  if (gia) return res.status(400).json({ error: `Questo numero e\u2019 gia\u2019 in rubrica, come ${gia.nick}` });
  const row = (await q(`INSERT INTO rubrica(nick, telefono, note, created_by) VALUES($1,$2,$3,$4) RETURNING *`,
    [nick, telefono, String(b.note || '').trim().slice(0, 200) || null, req.user.id])).rows[0];
  res.json(row);
}));

router.put('/rubrica/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const nick = String(b.nick || '').trim().slice(0, 60);
  const telefono = numeroPulito(b.telefono);
  if (!nick || !telefono) return res.status(400).json({ error: 'Servono il nome e un numero valido' });
  const gia = (await q('SELECT id, nick FROM rubrica WHERE telefono=$1 AND id<>$2', [telefono, req.params.id])).rows[0];
  if (gia) return res.status(400).json({ error: `Questo numero e\u2019 gia\u2019 in rubrica, come ${gia.nick}` });
  const row = (await q(`UPDATE rubrica SET nick=$2, telefono=$3, note=$4 WHERE id=$1 RETURNING *`,
    [req.params.id, nick, telefono, String(b.note || '').trim().slice(0, 200) || null])).rows[0];
  if (!row) return res.status(404).json({ error: 'Contatto non trovato' });
  res.json(row);
}));

// Togliere qualcuno dalla rubrica vuol dire che non deve piu' vedere niente:
// i suoi link si spengono insieme a lui, altrimenti resterebbero accesi senza
// che in nessun posto si veda piu' di chi erano.
router.delete('/rubrica/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const spenti = (await q(`UPDATE shares SET revoked_at=now() WHERE contatto_id=$1 AND revoked_at IS NULL`, [req.params.id])).rowCount;
  await q('DELETE FROM rubrica WHERE id=$1', [req.params.id]);
  res.json({ ok: true, spenti });
}));

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

// Anche a chi guarda da un link il tempo di quel giorno: e' parte del
// racconto, e non dice niente di piu' di quello che gia' vede
router.get('/pubblico/:token/meteo', conLink, wrap(async (req, res) => {
  const m = await meteoDelGiorno(req.query.lat, req.query.lon, req.query.giorno);
  if (!m) return res.status(404).json({ error: 'Niente meteo per quel giorno' });
  res.json(m);
}));

// ---- i link, dalla parte di chi li manda ----
router.get('/shares', requireAuth, requireAdmin, wrap(async (req, res) => {
  const righe = (await q(`SELECT s.*, u.name AS chi, r.nick AS contatto_nick, r.telefono AS contatto_telefono
    FROM shares s LEFT JOIN users u ON u.id=s.created_by LEFT JOIN rubrica r ON r.id=s.contatto_id
    ORDER BY s.revoked_at IS NOT NULL, s.id DESC`)).rows;
  const atleti = (await q(`SELECT id, name FROM users ORDER BY id`)).rows;
  const viaggi = (await q(`SELECT id, title, start_date, status FROM trips
    ORDER BY coalesce(start_date, created_at::date) DESC, id DESC`)).rows;
  const rubrica = (await q('SELECT id, nick, telefono FROM rubrica ORDER BY lower(nick)')).rows;
  res.json({ shares: righe, atleti, viaggi, rubrica });
}));

router.post('/shares', requireAuth, requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const giorni = Number(b.giorni) > 0 ? Math.min(3650, Math.round(Number(b.giorni))) : null;
  const viaggi = Array.isArray(b.viaggi) && b.viaggi.length ? b.viaggi.map(Number).filter(Boolean) : null;
  const allenamenti = Array.isArray(b.allenamenti) ? b.allenamenti.map(Number).filter(Boolean) : [];
  const chiesti = Array.isArray(b.contatti) ? [...new Set(b.contatti.map(Number).filter(Boolean))] : [];

  // A chi si manda deve stare in rubrica. Non e' una formalita': un numero
  // sbagliato di una cifra e' un viaggio di famiglia finito a uno sconosciuto,
  // e un indirizzo mandato non si richiama indietro.
  const destinatari = chiesti.length
    ? (await q('SELECT id, nick, telefono FROM rubrica WHERE id = ANY($1)', [chiesti])).rows
    : [];
  if (destinatari.length !== chiesti.length) {
    return res.status(400).json({ error: 'Qualcuno di quelli scelti non e\u2019 piu\u2019 in rubrica: ricarica la pagina e riprova' });
  }

  // Un link per ciascuno: cosi' si vede chi ha aperto e si puo' spegnere quello
  // di uno senza togliere il viaggio a tutti gli altri
  const nomeBase = String(b.nome || '').trim().slice(0, 80);
  const crea = async contatto => (await q(`INSERT INTO shares(token, nome, created_by, viaggi, tracciati, foto, spese, allenamenti, contatto_id, expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10::int IS NULL THEN NULL ELSE now() + ($10::int * interval '1 day') END) RETURNING *`,
    [randomToken(18), (contatto ? nomeBase || contatto.nick : nomeBase) || null, req.user.id,
      viaggi ? JSON.stringify(viaggi) : null, b.tracciati !== false, b.foto !== false, b.spese === true,
      JSON.stringify(allenamenti), contatto?.id || null, giorni])).rows[0];

  const links = destinatari.length
    ? await Promise.all(destinatari.map(async c => ({ ...(await crea(c)), contatto_nick: c.nick, contatto_telefono: c.telefono })))
    : [await crea(null)];
  console.log(`${links.length} link di sola lettura creati dall'utente ${req.user.id}`);
  res.json({ links });
}));

// Segna che il link e' stato mandato: il momento in cui si apre WhatsApp e'
// l'unica cosa che l'app puo' sapere davvero, e basta a ricordarsi chi e' gia'
// stato avvisato e chi no.
router.post('/shares/:id/inviato', requireAuth, requireAdmin, wrap(async (req, res) => {
  const row = (await q('UPDATE shares SET inviato_at=now() WHERE id=$1 RETURNING id, inviato_at', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Link non trovato' });
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
