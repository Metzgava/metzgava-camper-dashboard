// Chi entra. Elenco utenti suo: l'app dei viaggi ha il proprio, e qui non si
// mescolano. Le password si cifrano con bcrypt, lo stesso schema dell'altra
// app, cosi' se un giorno vorrai un elenco solo le righe sono compatibili.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, segna } from '../lib/db.js';

export const router = Router();

const wrap = f => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);
const pulito = u => u && { id: u.id, email: u.email, nome: u.nome, ruolo: u.ruolo };

export async function nessunoAncora() {
  return +(await q('SELECT count(*)::int AS n FROM utenti')).rows[0].n === 0;
}

export const serveAccesso = wrap(async (req, res, next) => {
  if (!req.session?.uid) return res.status(401).json({ error: 'Non autenticato' });
  const u = (await q('SELECT * FROM utenti WHERE id=$1', [req.session.uid])).rows[0];
  if (!u) { req.session = null; return res.status(401).json({ error: 'Non autenticato' }); }
  req.utente = u;
  next();
});

router.get('/io', wrap(async (req, res) => {
  // Primo avvio: la pagina deve sapere che tocca creare l'amministratore
  if (!req.session?.uid) return res.json({ utente: null, primoAvvio: await nessunoAncora() });
  const u = (await q('SELECT * FROM utenti WHERE id=$1', [req.session.uid])).rows[0];
  res.json({ utente: pulito(u), primoAvvio: false });
}));

router.post('/registra', wrap(async (req, res) => {
  // Si registra solo il primo: dopo, gli altri li crea chi c'e' gia'. Una app
  // che espone una registrazione aperta su internet e' una app che prima o poi
  // ospita qualcuno che non hai invitato.
  if (!await nessunoAncora()) return res.status(403).json({ error: 'Registrazione chiusa: c’e’ gia’ un amministratore' });
  const { email, nome, password } = req.body || {};
  if (!email || !nome || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'Servono email, nome e una password di almeno 8 caratteri' });
  }
  const hash = await bcrypt.hash(String(password), 10);
  const u = (await q(`INSERT INTO utenti (email, nome, password_hash, ruolo)
    VALUES ($1,$2,$3,'admin') RETURNING *`,
    [String(email).toLowerCase().trim(), String(nome).trim(), hash])).rows[0];
  req.session.uid = u.id;
  await segna('accesso', `Creato l’amministratore ${u.nome}`, u.email);
  res.json({ utente: pulito(u) });
}));

router.post('/entra', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = (await q('SELECT * FROM utenti WHERE email=$1', [String(email || '').toLowerCase().trim()])).rows[0];
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) {
    return res.status(401).json({ error: 'Credenziali errate' });
  }
  req.session.uid = u.id;
  res.json({ utente: pulito(u) });
}));

router.post('/esci', (req, res) => { req.session = null; res.json({ ok: true }); });
