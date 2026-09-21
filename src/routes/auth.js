import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../lib/db.js';
import { wrap, randomCode, randomToken, sha256 } from '../lib/util.js';

export const router = Router();

// ---- middleware ----
export const requireAuth = wrap(async (req, res, next) => {
  if (!req.session?.uid) return res.status(401).json({ error: 'Accesso richiesto' });
  const { rows } = await q('SELECT id,email,name,role,approved FROM users WHERE id=$1', [req.session.uid]);
  if (!rows[0]) { req.session = null; return res.status(401).json({ error: 'Accesso richiesto' }); }
  if (!rows[0].approved) return res.status(403).json({ error: 'Account in attesa di autorizzazione' });
  req.user = rows[0];
  next();
});
export const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Solo amministratore' });

// Autenticazione tramite token dispositivo (per Comandi Rapidi iPhone / Health Auto Export)
export const requireDevice = wrap(async (req, res, next) => {
  // Il token può arrivare come Authorization: Bearer <t>, Authorization: <t>, X-API-Key, X-Token, ?token= o nel corpo { token }
  const hdr = Object.entries(req.headers).find(([k]) => /auth|api-?key|x-token/i.test(k));
  let token = (hdr?.[1] || req.query.token || req.body?.token || '').toString().trim();
  token = token.replace(/^(Bearer|Token)\s+/i, '').replace(/^["']|["']$/g, '').trim();
  const m = token.match(/cd_[A-Za-z0-9_-]+/); if (m) token = m[0];
  if (!token) return res.status(401).json({ error: 'Token dispositivo mancante', hint: 'invia Authorization: Bearer <token> oppure ?token=<token> nell\'URL' });
  const { rows } = await q(`SELECT d.id AS device_id, d.approved, d.name AS device_name, u.id, u.email, u.name, u.role
                            FROM devices d JOIN users u ON u.id=d.user_id WHERE d.token_hash=$1`, [sha256(token)]);
  if (!rows[0]) {
    // Nel registro finiscono solo le prime e le ultime cifre, le stesse che la
    // pagina Impostazioni mostra accanto al dispositivo: bastano per capire se
    // il telefono sta mandando un token diverso da quello generato
    console.warn(`ingest: token dispositivo non riconosciuto (${token.slice(0, 6)}\u2026${token.slice(-4)}, ${token.length} caratteri)`);
    return res.status(401).json({ error: 'Token non valido' });
  }
  if (!rows[0].approved) return res.status(403).json({ error: 'Dispositivo non ancora autorizzato' });
  await q('UPDATE devices SET last_seen_at=now() WHERE id=$1', [rows[0].device_id]);
  req.user = rows[0]; req.device = { id: rows[0].device_id, name: rows[0].device_name };
  next();
});

const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, approved: u.approved });

router.get('/me', wrap(async (req, res) => {
  if (!req.session?.uid) return res.json({ user: null, setup: (await q('SELECT count(*)::int AS n FROM users')).rows[0].n === 0 });
  const { rows } = await q('SELECT * FROM users WHERE id=$1', [req.session.uid]);
  res.json({ user: rows[0] ? publicUser(rows[0]) : null });
}));

// Registrazione: il primo utente diventa admin; gli altri servono un codice invito e l'approvazione dell'admin
router.post('/register', wrap(async (req, res) => {
  const { email, name, password, invite } = req.body || {};
  if (!email || !name || !password || password.length < 8) return res.status(400).json({ error: 'Email, nome e password (min 8 caratteri) obbligatori' });
  const count = (await q('SELECT count(*)::int AS n FROM users')).rows[0].n;
  let role = 'member', approved = false, inviteRow = null;
  if (count === 0) { role = 'admin'; approved = true; }
  else {
    const r = await q('SELECT * FROM invites WHERE code=$1 AND used_by IS NULL AND expires_at>now()', [String(invite || '').toUpperCase()]);
    inviteRow = r.rows[0];
    if (!inviteRow) return res.status(400).json({ error: 'Codice invito non valido o scaduto' });
  }
  const hash = await bcrypt.hash(password, 10);
  let user;
  try {
    user = (await q('INSERT INTO users(email,name,password_hash,role,approved) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [email.toLowerCase().trim(), name.trim(), hash, role, approved])).rows[0];
  } catch (e) { if (e.code === '23505') return res.status(400).json({ error: 'Email già registrata' }); throw e; }
  if (inviteRow) await q('UPDATE invites SET used_by=$1 WHERE id=$2', [user.id, inviteRow.id]);
  req.session.uid = user.id;
  res.json({ user: publicUser(user), pending: !approved });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await q('SELECT * FROM users WHERE email=$1', [String(email || '').toLowerCase().trim()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return res.status(401).json({ error: 'Credenziali errate' });
  req.session.uid = u.id;
  res.json({ user: publicUser(u), pending: !u.approved });
}));

router.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

// ---- amministrazione utenti e inviti ----
router.get('/users', requireAuth, requireAdmin, wrap(async (req, res) => {
  const users = (await q('SELECT id,email,name,role,approved,created_at FROM users ORDER BY id')).rows;
  const invites = (await q('SELECT i.*, u.name AS used_by_name FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.id DESC LIMIT 20')).rows;
  res.json({ users, invites });
}));
// Cambio della propria password: serve quella attuale, altrimenti chiunque trovasse
// una sessione aperta potrebbe prendersi l'account
router.post('/password', requireAuth, wrap(async (req, res) => {
  const { attuale, nuova } = req.body || {};
  if (!nuova || String(nuova).length < 8) return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
  const u = (await q('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!u || !(await bcrypt.compare(String(attuale || ''), u.password_hash))) return res.status(401).json({ error: 'Password attuale errata' });
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, await bcrypt.hash(String(nuova), 10)]);
  console.log(`password cambiata dall'utente ${u.id}`);
  res.json({ ok: true });
}));

// Reimpostazione da parte dell'amministratore: l'app genera una password
// provvisoria e la mostra una volta sola, cosi' non ne viene scelta una debole e
// non serve digitarla due volte. Chi la riceve puo' poi cambiarla da solo.
router.post('/users/:id/password', requireAuth, requireAdmin, wrap(async (req, res) => {
  const u = (await q('SELECT id,name FROM users WHERE id=$1', [req.params.id])).rows[0];
  if (!u) return res.status(404).json({ error: 'Utente non trovato' });
  const provvisoria = randomToken().replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, await bcrypt.hash(provvisoria, 10)]);
  console.log(`password reimpostata per l'utente ${u.id} dall'amministratore ${req.user.id}`);
  res.json({ ok: true, name: u.name, password: provvisoria });
}));

router.post('/invites', requireAuth, requireAdmin, wrap(async (req, res) => {
  const code = randomCode();
  const row = (await q(`INSERT INTO invites(code,created_by,expires_at) VALUES($1,$2,now()+interval '7 days') RETURNING *`, [code, req.user.id])).rows[0];
  res.json(row);
}));
router.post('/users/:id/approve', requireAuth, requireAdmin, wrap(async (req, res) => {
  await q('UPDATE users SET approved=$2 WHERE id=$1', [req.params.id, req.body?.approved !== false]);
  res.json({ ok: true });
}));
router.delete('/users/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare te stesso' });
  await q('DELETE FROM users WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));

// ---- dispositivi (iPhone) ----
router.get('/devices', requireAuth, wrap(async (req, res) => {
  const sql = req.user.role === 'admin'
    ? 'SELECT d.id,d.name,d.token_hint,d.approved,d.last_seen_at,d.created_at,u.name AS owner FROM devices d JOIN users u ON u.id=d.user_id ORDER BY d.id'
    : 'SELECT d.id,d.name,d.token_hint,d.approved,d.last_seen_at,d.created_at,u.name AS owner FROM devices d JOIN users u ON u.id=d.user_id WHERE user_id=$1 ORDER BY d.id';
  res.json((await q(sql, req.user.role === 'admin' ? [] : [req.user.id])).rows);
}));
// Crea un dispositivo: il token viene mostrato UNA sola volta. L'admin lo approva (auto-approvato se è l'admin stesso).
router.post('/devices', requireAuth, wrap(async (req, res) => {
  const name = String(req.body?.name || 'iPhone').trim().slice(0, 60);
  // Gli allenamenti finiscono nella sezione del proprietario del dispositivo:
  // l'amministratore puo' quindi generare il token per conto di un altro
  // atleta, senza che questi debba entrare nella dashboard per farlo da se'
  let proprietario = req.user.id;
  if (req.body?.user_id && req.user.role === 'admin') {
    const u = (await q('SELECT id FROM users WHERE id=$1', [req.body.user_id])).rows[0];
    if (!u) return res.status(404).json({ error: 'Utente non trovato' });
    proprietario = u.id;
  }
  const token = 'cd_' + randomToken(32);
  const approved = req.user.role === 'admin';
  const riga = (await q(`INSERT INTO devices(user_id,name,token_hash,token_hint,approved) VALUES($1,$2,$3,$4,$5)
                         RETURNING id,name,approved,(SELECT name FROM users WHERE id=$1) AS owner`,
    [proprietario, name, sha256(token), token.slice(0, 6) + '\u2026' + token.slice(-4), approved])).rows[0];
  const host = req.get('x-forwarded-host') || req.get('host');
  const schema = req.get('x-forwarded-proto') || req.protocol;
  res.json({ ...riga, token, endpoint: `${schema}://${host}/api/ingest/health` });
}));
router.post('/devices/:id/approve', requireAuth, requireAdmin, wrap(async (req, res) => {
  await q('UPDATE devices SET approved=$2 WHERE id=$1', [req.params.id, req.body?.approved !== false]); res.json({ ok: true });
}));
router.delete('/devices/:id', requireAuth, wrap(async (req, res) => {
  const cond = req.user.role === 'admin' ? '' : ' AND user_id=$2';
  await q(`DELETE FROM devices WHERE id=$1${cond}`, req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user.id]);
  res.json({ ok: true });
}));
