import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import exifr from 'exifr';
import { q } from '../lib/db.js';
import { wrap, randomToken } from '../lib/util.js';
import { requireAuth } from './auth.js';

// Su Railway monta un Volume su /data e imposta UPLOAD_DIR=/data/uploads per non perdere le foto ai redeploy
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomToken(6)}${path.extname(file.originalname || '.jpg').toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

export const router = Router();
router.use(requireAuth);

router.post('/trips/:id/photos', upload.array('photos', 20), wrap(async (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    let exif = {};
    try { exif = (await exifr.parse(f.path, { gps: true, pick: ['DateTimeOriginal', 'latitude', 'longitude'] })) || {}; } catch { }
    const row = (await q('INSERT INTO photos(user_id,trip_id,leg_id,filename,caption,taken_at,lat,lon) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.id, req.params.id, req.body.leg_id || null, f.filename, req.body.caption || null, exif.DateTimeOriginal || null, exif.latitude || null, exif.longitude || null])).rows[0];
    out.push(row);
  }
  res.json(out);
}));
router.put('/photos/:id', wrap(async (req, res) => {
  const b = req.body || {};
  res.json((await q('UPDATE photos SET caption=$2, leg_id=$3 WHERE id=$1 RETURNING *', [req.params.id, b.caption ?? null, b.leg_id || null])).rows[0]);
}));
router.delete('/photos/:id', wrap(async (req, res) => {
  const p = (await q('DELETE FROM photos WHERE id=$1 AND (user_id=$2 OR $3) RETURNING filename', [req.params.id, req.user.id, req.user.role === 'admin'])).rows[0];
  if (p) fs.rm(path.join(UPLOAD_DIR, p.filename), () => {});
  res.json({ ok: !!p });
}));
