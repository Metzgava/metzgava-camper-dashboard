// Camper Servizi — gli impianti del camper, da remoto.
import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, segna } from './lib/db.js';
import { passaggioCloud } from './lib/avarie.js';
import { router as auth } from './routes/auth.js';
import { router as stato, aperte as statoAperte } from './routes/stato.js';
import { router as taratura } from './routes/taratura.js';
import { router as ingresso } from './routes/ingresso.js';
import { registra, collegato } from './lib/bluetti.js';
import { segnaGiro } from './lib/ritmo.js';
import { conImpronta, conImprontaNeiModuli } from './lib/pagina.js';

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
const SUOI = /\.(?:js|css|html|webmanifest)$/;
const IMPRONTA = (() => {
  try {
    const h = crypto.createHash('sha1');
    // Tutti i file della pagina, non un elenco scritto a mano. Un elenco va
    // aggiornato quando nasce un file, dimenticarlo non da' nessun segnale, e
    // il guasto che ne viene e' quello del 18/11: un pezzo vecchio servito per
    // un'ora dentro una pagina nuova. In ordine alfabetico, o l'impronta
    // cambierebbe a seconda di come il sistema elenca la cartella.
    for (const f of fs.readdirSync(PUBBLICA).filter(f => SUOI.test(f)).sort()) {
      h.update(fs.readFileSync(path.join(PUBBLICA, f)));
    }
    return h.digest('hex').slice(0, 10);
  } catch { return String(Date.now()); }
})();

// Un controllo di salute che non interroga l'archivio: se il database e'
// lento, il servizio non deve risultare morto e farsi riavviare in loop.
// `versione` e' l'impronta dei file di `public/`: non cambia quando la modifica
// tocca solo il server, e il 24/11/2026 questo ha reso impossibile verificare
// da fuori che una pubblicazione fosse arrivata davvero. `commit` copre quel
// buco: Railway lo mette in RAILWAY_GIT_COMMIT_SHA, e in locale resta `null`
// -- che e' la verita', non un ripiego.
const COMMIT = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null;
app.get('/api/health', (req, res) =>
  res.json({ ok: true, app: 'camper-servizi', versione: IMPRONTA, commit: COMMIT }));

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

// I moduli della pagina si servono a mano come lei, per mettere l'impronta
// negli `import` che hanno dentro: `app.js` importa `./rifondi.js`, e quel
// secondo indirizzo non passa da `index.html`, quindi nessun altro glielo
// mette. Deve stare **prima** di express.static, che altrimenti risponderebbe
// lei col file liscio.
const MODULI = (() => {
  const m = new Map();
  try {
    for (const f of fs.readdirSync(PUBBLICA)) {
      if (!f.endsWith('.js')) continue;
      const testo = fs.readFileSync(path.join(PUBBLICA, f), 'utf8');
      m.set('/' + f, conImprontaNeiModuli(testo, IMPRONTA));
    }
  } catch { /* nessun modulo da riscrivere: ci pensa lo static */ }
  return m;
})();
app.use((req, res, next) => {
  const corpo = MODULI.get(req.path);
  if (corpo === undefined) return next();
  // Ora che l'indirizzo porta l'impronta, tenerlo in tasca e' giusto: cambia
  // il file, cambia l'indirizzo, e il browser ne chiede uno nuovo da se'.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('js').send(corpo);
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
    // Quanto spesso il cloud di Bluetti ci lascia a piedi, e per quanto. Serve
    // a decidere con dei numeri se vale la pena leggerla via Bluetooth: una
    // avaria ogni sei mesi e' un'altra cosa da una ogni due settimane. Si
    // segnano i **passaggi**, non i tentativi, e la regola sta in
    // `lib/avarie.js`, dove girano le prove.
    let statoCloud = null;
    const leggi = async () => {
      if (!await collegato()) return;
      const r = await registra();
      if (r.errore) console.warn('lettura Bluetti:', r.errore);
      const p = passaggioCloud(statoCloud, !r.errore, Date.now(), String(r.errore || '').slice(0, 80));
      if (p) {
        statoCloud = p.stato;
        await segna(p.tipo, p.testo).catch(e => console.warn('evento non scritto:', e.message));
      } else if (statoCloud) {
        // Lo stato non cambia, ma l'istante dell'ultima conferma si': senza,
        // la durata di un'avaria futura partirebbe da chissa' quando.
        statoCloud = { ...statoCloud };
      } else {
        statoCloud = { ok: !r.errore, da: Date.now() };
      }
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
