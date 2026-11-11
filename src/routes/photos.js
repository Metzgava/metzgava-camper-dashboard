import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import exifr from 'exifr';
import { q } from '../lib/db.js';
import { wrap, randomToken } from '../lib/util.js';
import { requireAuth } from './auth.js';
import { luogoDaCoordinate } from '../lib/geo.js';

// Su Railway monta un Volume su /data e imposta UPLOAD_DIR=/data/uploads per non perdere le foto ai redeploy
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMMAGINE = /\.(jpe?g|png|heic|heif|webp|gif|tiff?|avif|bmp)$/i;
// I video del telefono: quelli di iPhone sono .mov, gli altri quasi sempre .mp4
const VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;
const eVideo = f => /^video\//.test(f.mimetype || '') || VIDEO.test(f.originalname || '');
// Non tutti dichiarano il tipo: chi carica da uno script manda spesso
// «application/octet-stream», e un filmato preso per foto finirebbe a fare da
// copertina. Quando il nome dice che e' un video, il tipo si scrive da qui.
const tipoFile = f => /^video\//.test(f.mimetype || '') ? f.mimetype
  : VIDEO.test(f.originalname || '') ? `video/${(f.originalname.split('.').pop() || 'mp4').toLowerCase().replace('mov', 'quicktime')}`
  : (f.mimetype || null);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomToken(6)}${path.extname(file.originalname || '.jpg').toLowerCase() || '.jpg'}`),
  }),
  // Un video pesa quanto cinquanta foto: il limite sale, ma non tanto da
  // riempire il disco con un filmato solo
  limits: { fileSize: 200 * 1024 * 1024 },
  // Il tipo dichiarato non basta: certi file trascinati arrivano come
  // application/octet-stream, e scartarli in silenzio significa una foto che
  // sparisce senza che nessuno sappia perche'
  fileFilter: (req, file, cb) => {
    const va = /^image\//.test(file.mimetype) || IMMAGINE.test(file.originalname || '') || eVideo(file);
    if (!va) console.warn(`file rifiutato: ${file.originalname} (${file.mimetype})`);
    cb(null, va);
  },
});

// La posizione non e' un'etichetta scritta nel file: e' un calcolo su gradi,
// minuti e secondi che stanno in un blocco a parte. Chiedendo «latitude» in un
// elenco di etichette da leggere, quel blocco non viene nemmeno aperto e le
// coordinate non arrivano mai — ed e' quello che succedeva qui, in silenzio, a
// ogni foto caricata.
const leggiExif = percorso => exifr.parse(percorso, { gps: true });

// Le foto caricate finche' le coordinate non arrivavano sono ancora sul disco,
// e dentro ce le hanno. Si rileggono all'avvio: chi ha gia' caricato non deve
// ricaricare niente per vedersele comparire sulla mappa.
export async function completaExifMancanti() {
  const mancanti = (await q('SELECT id, filename FROM photos WHERE lat IS NULL ORDER BY id DESC LIMIT 500')).rows;
  if (!mancanti.length) return 0;
  let trovate = 0, senza = 0, perse = 0;
  for (const p of mancanti) {
    const percorso = path.join(UPLOAD_DIR, p.filename);
    if (!fs.existsSync(percorso)) { perse++; continue; }
    let e = null;
    try { e = await leggiExif(percorso); } catch { }
    if (!e?.latitude) { senza++; continue; }
    await q('UPDATE photos SET lat=$2, lon=$3, taken_at=coalesce(taken_at,$4) WHERE id=$1',
      [p.id, e.latitude, e.longitude, e.DateTimeOriginal || null]);
    trovate++;
  }
  console.log(`foto: coordinate recuperate in ${trovate} su ${mancanti.length} (${senza} senza posizione, ${perse} senza file)`);
  return trovate;
}

// I nomi dei posti delle foto, pochi per volta: i geocoder gratuiti non si
// tengono buoni a forza di richieste. Anche il buco si segna - stringa vuota -
// altrimenti lo stesso posto lo si richiederebbe all'infinito.
export async function completaLuoghiFoto(quanti = 40) {
  const senza = (await q(`SELECT id, lat, lon FROM photos
      WHERE luogo IS NULL AND lat IS NOT NULL AND lon IS NOT NULL
      ORDER BY coalesce(taken_at, created_at) DESC LIMIT $1`, [quanti])).rows;
  if (!senza.length) return 0;
  let trovati = 0;
  for (const f of senza) {
    const nome = await luogoDaCoordinate(Number(f.lat), Number(f.lon)).catch(() => null);
    await q('UPDATE photos SET luogo=$2 WHERE id=$1', [f.id, nome || '']);
    if (nome) trovati++;
    await new Promise(r => setTimeout(r, 1200));
  }
  console.log(`luoghi delle foto: ${trovati} trovati su ${senza.length} cercati`);
  return trovati;
}

export const router = Router();
router.use(requireAuth);

// Quando il caricamento si rompe dalla parte del browser, qui non arriva niente
// da leggere: il guasto resta sullo schermo di chi ci ha provato, e chi deve
// aggiustarlo tira a indovinare. Questo e' il filo per farcelo sapere.
router.post('/diagnostica', wrap(async (req, res) => {
  const b = req.body || {};
  const corto = (v, n) => String(v ?? '').slice(0, n);
  console.warn('browser:', JSON.stringify({
    chi: req.user?.name,
    dove: corto(b.dove, 60),
    esito: corto(b.esito, 300),
    agente: corto(b.agente, 160),
    tipi: (Array.isArray(b.tipi) ? b.tipi : []).slice(0, 10).map(t => corto(t, 40)),
    elementi: (Array.isArray(b.elementi) ? b.elementi : []).slice(0, 10),
    file: (Array.isArray(b.file) ? b.file : []).slice(0, 10),
  }));
  res.json({ ok: true });
}));

router.post('/trips/:id/photos', upload.array('photos', 20), wrap(async (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    // Un video non ha l'exif di una foto: le coordinate, quando ci sono, stanno
    // in un altro formato che questa libreria non legge. Non si prova nemmeno.
    let exif = {};
    if (!eVideo(f)) { try { exif = (await leggiExif(f.path)) || {}; } catch { } }
    const row = (await q('INSERT INTO photos(user_id,trip_id,leg_id,stop_id,filename,caption,taken_at,lat,lon,mime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [req.user.id, req.params.id, req.body.leg_id || null, req.body.stop_id || null, f.filename, req.body.caption || null, exif.DateTimeOriginal || null, exif.latitude || null, exif.longitude || null, tipoFile(f)])).rows[0];
    out.push(row);
  }
  res.json(out);
}));
// Si cambia solo quello che arriva. Prima bastava mandare una didascalia
// perche' la foto perdesse la tappa e la sosta a cui apparteneva: campi non
// nominati, azzerati lo stesso.
router.put('/photos/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const dato = k => Object.prototype.hasOwnProperty.call(b, k);
  const r = (await q(`UPDATE photos SET
      caption = CASE WHEN $2 THEN $3 ELSE caption END,
      leg_id  = CASE WHEN $4 THEN $5 ELSE leg_id END,
      stop_id = CASE WHEN $6 THEN $7 ELSE stop_id END
    WHERE id=$1 RETURNING *`,
    [req.params.id, dato('caption'), String(b.caption ?? '').trim().slice(0, 300) || null,
      dato('leg_id'), b.leg_id || null, dato('stop_id'), b.stop_id || null])).rows[0];
  if (!r) return res.status(404).json({ error: 'Foto non trovata' });
  res.json(r);
}));
// Piu' foto in una volta: con venti scatti da togliere, venti richieste e venti
// conferme sono venti occasioni di sbagliare. I file spariscono dal disco solo
// dopo che la riga e' stata tolta davvero.
router.post('/photos/elimina', wrap(async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'Nessuna foto indicata' });
  const tolte = (await q('DELETE FROM photos WHERE id = ANY($1::int[]) AND (user_id=$2 OR $3) RETURNING filename',
    [ids, req.user.id, req.user.role === 'admin'])).rows;
  for (const p of tolte) fs.rm(path.join(UPLOAD_DIR, p.filename), () => {});
  console.log(`foto: eliminate ${tolte.length} su ${ids.length} richieste, utente=${req.user.id}`);
  res.json({ ok: true, eliminate: tolte.length });
}));

router.delete('/photos/:id', wrap(async (req, res) => {
  const p = (await q('DELETE FROM photos WHERE id=$1 AND (user_id=$2 OR $3) RETURNING filename', [req.params.id, req.user.id, req.user.role === 'admin'])).rows[0];
  if (p) fs.rm(path.join(UPLOAD_DIR, p.filename), () => {});
  res.json({ ok: !!p });
}));
