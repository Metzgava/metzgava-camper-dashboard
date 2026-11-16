// Camper Servizi — gli impianti del camper, da remoto.
import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './lib/db.js';
import { router as auth } from './routes/auth.js';
import { router as stato } from './routes/stato.js';
import { registra, configurato as bluettiConfigurato } from './lib/bluetti.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const PUBBLICA = path.join(QUI, '..', 'public');

const app = express();
app.set('trust proxy', 1);                 // dietro il proxy di Railway
app.use(express.json({ limit: '256kb' }));

const segreto = process.env.APP_SECRET || process.env.SESSION_SECRET;
if (!segreto) { console.error('APP_SECRET mancante.'); process.exit(1); }
app.use(cookieSession({
  name: 'servizi',
  keys: [segreto],
  maxAge: 90 * 24 * 3600 * 1000,
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
}));

// Un controllo di salute che non interroga l'archivio: se il database e'
// lento, il servizio non deve risultare morto e farsi riavviare in loop.
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'camper-servizi' }));

app.use('/api', auth);
app.use('/api', stato);

// La pagina e il suo codice cambiano a ogni pubblicazione: vanno riconvalidati
// a ogni visita, altrimenti dopo un aggiornamento il telefono continua a
// mostrare la versione vecchia.
app.use(express.static(PUBBLICA, {
  etag: true,
  setHeaders: (res, file) => {
    if (/\.(html|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));
app.get('*splat', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Non trovato' });
  res.sendFile(path.join(PUBBLICA, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Errore interno' });
});

const porta = process.env.PORT || 3000;
migrate().then(() => {
  app.listen(porta, () => console.log(`Camper Servizi su porta ${porta}`));

  // Le letture periodiche. Non servono a mostrare lo stato — quello si chiede
  // aprendo la pagina — ma a costruire la fila storica: un numero dice com'e'
  // adesso, solo una fila dice se sta scendendo e quanto in fretta.
  const passo = Number(process.env.LETTURE_MINUTI || 15);
  if (passo > 0 && bluettiConfigurato()) {
    const leggi = () => registra()
      .then(r => { if (r.errore) console.warn('lettura Bluetti:', r.errore); })
      .catch(e => console.warn('lettura Bluetti:', e.message));
    setTimeout(leggi, 20_000);
    setInterval(leggi, passo * 60 * 1000);
  } else {
    console.log(bluettiConfigurato() ? 'letture periodiche spente' : 'cloud Bluetti non configurato: nessuna lettura');
  }
}).catch(e => { console.error('Migrazione fallita', e); process.exit(1); });

// Una promessa caduta e non raccolta fa uscire Node: qui si scrive e si tira
// avanti, perche' un guasto in un lavoro di sfondo non deve spegnere tutto.
process.on('unhandledRejection', e => console.error('promessa non raccolta:', e?.message || e));
