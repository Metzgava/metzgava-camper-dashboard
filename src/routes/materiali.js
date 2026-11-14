// Il materiale con cui si prepara un viaggio: appunti, indirizzi di siti, il
// pdf del traghetto, la pagina di una rivista fotografata. Non sono le foto del
// viaggio - quelle nascono dopo, sulla strada - e non sono spese: stanno da
// parte, in un posto solo, cosi' quando si parte non si va a cercarli fra le
// chat e le mail.
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { q } from '../lib/db.js';
import { wrap, randomToken } from '../lib/util.js';
import { requireAuth } from './auth.js';
import { UPLOAD_DIR } from './photos.js';

export const router = Router();
router.use(requireAuth);

const IMMAGINE = /^image\//i;
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `m${Date.now()}-${randomToken(6)}${path.extname(file.originalname || '').toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const testo = (v, n) => { const t = String(v ?? '').trim(); return t ? t.slice(0, n) : null; };

// L'indirizzo si prende come lo si incolla, anche senza «https://» davanti:
// chi copia dalla barra del telefono spesso non se lo porta dietro.
function indirizzoValido(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const completo = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try { const u = new URL(completo); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null; }
  catch { return null; }
}

// Il titolo della pagina, per non ritrovarsi un elenco di indirizzi tutti
// uguali. Se il sito non risponde o non lo dice, resta il nome del sito: un
// link senza titolo e' comunque meglio di un errore.
export async function titoloDellaPagina(url) {
  const stop = AbortSignal.timeout(6000);
  try {
    const r = await fetch(url, { signal: stop, redirect: 'follow', headers: { 'User-Agent': 'camper-dashboard/1.0' } });
    if (!r.ok || !/text\/html/i.test(r.headers.get('content-type') || '')) return null;
    const html = (await r.text()).slice(0, 200_000);
    const m = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
    if (!m) return null;
    return m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, 200) || null;
  } catch { return null; }
}

export const materialiDi = async tripId =>
  (await q(`SELECT m.*, u.name AS chi FROM materiali m LEFT JOIN users u ON u.id=m.user_id
            WHERE m.trip_id=$1 ORDER BY m.created_at DESC, m.id DESC`, [tripId])).rows;

router.get('/trips/:id/materiali', wrap(async (req, res) => res.json(await materialiDi(req.params.id))));

// Appunto o indirizzo: arrivano come testo, e il tipo lo dice chi scrive
router.post('/trips/:id/materiali', wrap(async (req, res) => {
  const b = req.body || {};
  const tipo = b.tipo === 'link' ? 'link' : 'nota';
  let url = null, titolo = testo(b.titolo, 200);
  if (tipo === 'link') {
    url = indirizzoValido(b.url);
    if (!url) return res.status(400).json({ error: 'Indirizzo non valido: controlla che sia un sito' });
    if (!titolo) titolo = await titoloDellaPagina(url) || new URL(url).hostname.replace(/^www\./, '');
  } else if (!testo(b.testo, 20000) && !titolo) {
    return res.status(400).json({ error: 'Scrivi almeno due righe, o un titolo' });
  }
  const r = (await q(`INSERT INTO materiali(trip_id,user_id,tipo,titolo,testo,url,etichetta,dove)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id, req.user.id, tipo, titolo, testo(b.testo, 20000), url,
      testo(b.etichetta, 20) || null, testo(b.dove, 80) || null])).rows[0];
  res.json(r);
}));

// File: un pdf, un biglietto, la pagina di una rivista fotografata. Le immagini
// si riconoscono da sole e si mostrano come tali, il resto si apre e si scarica.
router.post('/trips/:id/materiali/file', upload.array('file', 10), wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nessun file ricevuto' });
  const fuori = [];
  for (const f of files) {
    const tipo = IMMAGINE.test(f.mimetype) ? 'immagine' : 'file';
    const r = (await q(`INSERT INTO materiali(trip_id,user_id,tipo,titolo,filename,mime,dimensione) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, req.user.id, tipo, testo(req.body?.titolo, 200) || f.originalname.slice(0, 200), f.filename, f.mimetype, f.size])).rows[0];
    fuori.push(r);
  }
  console.log(`materiali: viaggio ${req.params.id}, ${fuori.length} file caricati`);
  res.json(fuori);
}));

router.put('/materiali/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const r = (await q(`UPDATE materiali SET titolo=coalesce($2,titolo), testo=coalesce($3,testo) WHERE id=$1 RETURNING *`,
    [req.params.id, testo(b.titolo, 200), testo(b.testo, 20000)])).rows[0];
  if (!r) return res.status(404).json({ error: 'Non trovato' });
  res.json(r);
}));

// Il file se ne va col materiale: lasciarlo sul disco vorrebbe dire riempirlo
// di roba che nessuna pagina nomina piu'
router.delete('/materiali/:id', wrap(async (req, res) => {
  const r = (await q('DELETE FROM materiali WHERE id=$1 RETURNING filename', [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Non trovato' });
  if (r.filename) fs.rm(path.join(UPLOAD_DIR, r.filename), () => {});
  res.json({ ok: true });
}));
