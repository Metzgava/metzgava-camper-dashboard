// Camper Servizi — gli impianti del camper, da remoto.
import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './lib/db.js';
import { router as auth } from './routes/auth.js';
import { router as stato, aperte as statoAperte } from './routes/stato.js';
import { router as taratura } from './routes/taratura.js';
import { router as ingresso } from './routes/ingresso.js';
import { registra, collegato } from './lib/bluetti.js';
import { segnaGiro } from './lib/ritmo.js';
import { conImpronta } from './lib/pagina.js';

import crypto from 'node:crypto';
import fs from 'node:fs';

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

// L'impronta del programma della pagina, calcolata all'avvio. Serve a una cosa
// sola, ma importante: un'app aggiunta alla schermata Home di iPhone **non si
// ricarica da sola**. Il sistema la tiene sospesa e riaprendola riprende la
// pagina di prima. Con questa impronta la pagina se ne accorge e si ricarica,
// invece di mostrare una versione vecchia a chi non sa di averla.
const IMPRONTA = (() => {
  try {
    const h = crypto.createHash('sha1');
    for (const f of ['app.js', 'stile.css', 'index.html']) h.update(fs.readFileSync(path.join(PUBBLICA, f)));
    return h.digest('hex').slice(0, 10);
  } catch { return String(Date.now()); }
})();

// Un controllo di salute che non interroga l'archivio: se il database e'
// lento, il servizio non deve risultare morto e farsi riavviare in loop.
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'camper-servizi', versione: IMPRONTA }));

app.use('/api/ingresso', ingresso);
app.use('/api', statoAperte);
app.use('/api', auth);
app.use('/api', stato);
app.use('/api', taratura);

// La pagina si serve a mano, per sostituire il `?v=` dei suoi file con
// l'impronta. Deve stare **prima** di express.static, che altrimenti
// risponderebbe lei a «/» con il file cosi' com'e' sul disco.
//
// Letta una volta sola all'avvio: pesa trecento byte, e a ogni pubblicazione
// il contenitore riparte comunque.
const PAGINA = (() => {
  try { return conImpronta(fs.readFileSync(path.join(PUBBLICA, 'index.html'), 'utf8'), IMPRONTA); }
  catch { return null; }
})();
app.get(['/', '/index.html'], (req, res, next) => {
  if (!PAGINA) return next();
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.type('html').send(PAGINA);
});

// La pagina e il suo codice cambiano a ogni pubblicazione: vanno riconvalidati
// a ogni visita, altrimenti dopo un aggiornamento il telefono continua a
// mostrare la versione vecchia.
app.use(express.static(PUBBLICA, {
  etag: true,
  setHeaders: (res, file) => {
    // «no-store» e non «no-cache»: il primo vieta proprio di tenerne una copia,
    // il secondo permette di tenerla e chiedere se va ancora bene. Su iPhone
    // quella differenza si e' vista - una pagina vecchia che restava li'. La
    // pagina pesa trecento byte: non c'e' niente da risparmiare a conservarla.
    if (/\.(html|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));
app.get('*splat', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Non trovato' });
  // Questa strada non passa dalle intestazioni dello static: gliele si rimette
  // a mano, altrimenti un indirizzo qualunque servirebbe una pagina che il
  // telefono puo' conservare per sempre.
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
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
  if (passo > 0) {
    // Non si decide all'avvio se leggere: il collegamento Bluetti puo' nascere
    // dopo, da un tasto nella pagina, e il giro deve accorgersene da solo.
    const leggi = async () => {
      if (!await collegato()) return;
      const r = await registra();
      if (r.errore) console.warn('lettura Bluetti:', r.errore);
    };
    // Si segna il ritmo **prima** di leggere, non dopo: la pagina deve sapere
    // quando scatta il giro, e una lettura che impiega dieci secondi non deve
    // spostare in avanti il conto alla rovescia di dieci secondi a ogni volta.
    const giro = () => { segnaGiro(); return leggi().catch(e => console.warn('lettura Bluetti:', e.message)); };
    setTimeout(giro, 20_000);
    setInterval(giro, passo * 60 * 1000);
  }
}).catch(e => { console.error('Migrazione fallita', e); process.exit(1); });

// Una promessa caduta e non raccolta fa uscire Node: qui si scrive e si tira
// avanti, perche' un guasto in un lavoro di sfondo non deve spegnere tutto.
process.on('unhandledRejection', e => console.error('promessa non raccolta:', e?.message || e));
