import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './lib/db.js';
import { SECRET } from './lib/util.js';
import { router as auth, requireAuth } from './routes/auth.js';
import { router as trips } from './routes/trips.js';
import { router as workouts, ingest, syncAllKomoot } from './routes/workouts.js';
import { router as photos, UPLOAD_DIR } from './routes/photos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// L’export di Health Auto Export con le tracce GPS supera facilmente i 10 MB
const jsonNormale = express.json({ limit: '10mb' });
const jsonIngest = express.json({ limit: '50mb' });
app.use((req, res, next) => (req.path.startsWith('/api/ingest') ? jsonIngest : jsonNormale)(req, res, next));
app.use(cookieSession({
  name: 'camper.sid',
  secret: SECRET,
  maxAge: 90 * 24 * 3600 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

// Header di sicurezza base
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));
app.use('/api/auth', auth);
app.use('/api/ingest', ingest);
app.use('/api', trips);
app.use('/api', workouts);
app.use('/api', photos);
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

// La pagina e il suo codice cambiano a ogni pubblicazione: vanno riconvalidati a
// ogni visita, altrimenti dopo un aggiornamento il browser continua a mostrare la
// versione vecchia fino allo scadere della cache. Le librerie in vendor/ e le
// immagini non cambiano mai, e restano memorizzate.
const indice = path.join(__dirname, '..', 'public', 'index.html');
const daRiconvalidare = f => /\.(html|js|css|json)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`);
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res, f) => { if (daRiconvalidare(f)) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get(/^\/(?!api|uploads).*/, (req, res) => res.set('Cache-Control', 'no-cache').sendFile(indice));

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File troppo grande' });
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Errore interno' });
});

const port = process.env.PORT || 3000;
migrate().then(() => {
  app.listen(port, () => console.log(`Camper dashboard su porta ${port}`));
  const every = Number(process.env.KOMOOT_SYNC_HOURS || 6);
  if (every > 0) { setTimeout(syncAllKomoot, 60_000); setInterval(syncAllKomoot, every * 3600 * 1000); }
}).catch(e => { console.error('Migrazione fallita', e); process.exit(1); });
