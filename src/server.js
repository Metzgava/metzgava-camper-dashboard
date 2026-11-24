// **Le variabili d'ambiente da `.env`, se c'e'.**
//
// Il programma non le leggeva da nessuna parte: arrivavano solo dalla riga di
// comando (in locale) o dalle variabili del servizio (su Railway). Il
// 24/11/2026, aggiungendo le credenziali di CarLock, si e' scoperto che
// scriverle in `.env` non serviva a niente -- il file c'era, i segreti dentro,
// e il server non li vedeva.
//
// Su Railway non cambia nulla: `.env` e' fuori dal versionamento, quindi
// nell'immagine non c'e' e questa riga non fa niente. In locale invece basta
// scrivere una variabile nel file, come si e' sempre creduto di poter fare.
//
// Avvolto, perche' senza il file `loadEnvFile` lancia -- e un file di segreti
// che manca non deve impedire al server di partire.
try { process.loadEnvFile(); } catch { }

import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate, sistemaDurateCarlock, q } from './lib/db.js';
import { SECRET, wrap } from './lib/util.js';
import { router as auth, requireAuth } from './routes/auth.js';
import { router as trips, agganciaAllenamenti, completaCoordinateSoste } from './routes/trips.js';
import { router as workouts, ingest, syncAllKomoot, syncAllStrava, rimuoviDoppioniAutomatici, normalizzaNomiEsistenti, completaLuoghiMancanti, sistemaDislivelliAssurdi } from './routes/workouts.js';
import { router as photos, UPLOAD_DIR, completaExifMancanti, completaLuoghiFoto } from './routes/photos.js';
import { router as materiali } from './routes/materiali.js';
import { router as proposte } from './routes/proposte.js';
import { router as pianifica } from './routes/pianifica.js';
import { router as share, linkValido, viaggiVisibili, segnaVisita } from './routes/share.js';
import { sannoEvitareIPedaggi } from './lib/geo.js';
import { conImpronta } from './lib/pagina.js';

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

// L'impronta del programma della pagina, calcolata all'avvio.
//
// Serve a una cosa sola, ma importante: un'app aggiunta alla schermata Home
// **non si ricarica da sola**. Il sistema la tiene sospesa e riaprendola
// riprende la pagina di prima. Senza un modo di accorgersene, chi guarda usa
// una versione vecchia senza saperlo -- ed e' successo due volte: il 18/11
// nell'app dei servizi, il 22/11 qui, col tasto «Ridisegna» nuovo sul server e
// quello vecchio in mano.
//
// Tutti i file della pagina, non un elenco scritto a mano: un elenco va
// aggiornato quando nasce un file, e dimenticarlo non da' nessun segnale. In
// ordine alfabetico, o l'impronta cambierebbe a seconda di come il sistema
// elenca la cartella.
const PUBBLICA = path.join(__dirname, '..', 'public');
const SUOI = /\.(?:js|css|html|webmanifest)$/;
const IMPRONTA = (() => {
  try {
    const h = crypto.createHash('sha1');
    for (const f of fs.readdirSync(PUBBLICA).filter(x => SUOI.test(x)).sort()) {
      h.update(fs.readFileSync(path.join(PUBBLICA, f)));
    }
    return h.digest('hex').slice(0, 10);
  } catch { return String(Date.now()); }
})();

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date(), versione: IMPRONTA }));
app.use('/api/auth', auth);
app.use('/api/ingest', ingest);
// I link di sola lettura stanno davanti agli altri: le rotte dei viaggi
// chiedono il nome di chi le apre a chiunque passi di li', e un ospite un nome
// non ce l'ha
app.use('/api', share);
app.use('/api', trips);
app.use('/api', workouts);
app.use('/api', photos);
app.use('/api', materiali);
app.use('/api', proposte);
app.use('/api', pianifica);

// I file: a chi e' di casa si aprono tutti. A un ospite si apre una foto solo
// se e' di un viaggio che il suo link comprende e se le foto gliele hai date -
// altrimenti basterebbe indovinare un nome di file per girare tutto l'archivio.
const accessoAiFile = wrap(async (req, res, next) => {
  if (req.session?.uid) return next();
  const s = await linkValido(req.session?.ospite);
  if (!s || !s.foto) return res.status(401).json({ error: 'Non autorizzato' });
  const nome = decodeURIComponent(req.path.replace(/^\//, ''));
  const suoi = await viaggiVisibili(s);
  const ok = (await q('SELECT 1 FROM photos WHERE filename=$1 AND trip_id = ANY($2) LIMIT 1', [nome, suoi])).rowCount;
  if (!ok) return res.status(403).json({ error: 'Non autorizzato' });
  next();
});
app.use('/uploads', accessoAiFile, express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

// L'indirizzo che mandi a chi deve guardare. Apre la pagina dell'ospite e
// lascia nel browser il segno del link, che serve solo a farsi aprire le foto.
const paginaOspite = path.join(__dirname, '..', 'public', 'ospite.html');
app.get('/v/:token', wrap(async (req, res) => {
  const s = await linkValido(req.params.token);
  if (s) { req.session.ospite = req.params.token; segnaVisita(s.id); }
  res.set('Cache-Control', 'no-cache').sendFile(paginaOspite);
}));

// La pagina e il suo codice cambiano a ogni pubblicazione: vanno riconvalidati a
// ogni visita, altrimenti dopo un aggiornamento il browser continua a mostrare la
// versione vecchia fino allo scadere della cache. Le librerie in vendor/ e le
// immagini non cambiano mai, e restano memorizzate.
// Le icone fanno eccezione: cambiano di rado, ma quando cambiano devono
// arrivare subito. Chi aggiunge il collegamento alla schermata di casa si
// porta via l'icona di quel momento e se la tiene per sempre: se il browser
// gliene passa una vecchia tenuta in cache, se la tiene vecchia.
const indice = path.join(__dirname, '..', 'public', 'index.html');
// La pagina si serve **a mano**, per sostituire il `?v=` dei suoi file con
// l'impronta. Deve stare prima di `express.static`, che altrimenti
// risponderebbe lei col file cosi' com'e' sul disco.
//
// Letta una volta sola all'avvio: pesa poco, e a ogni pubblicazione il server
// riparte comunque.
const PAGINA = (() => {
  try { return conImpronta(fs.readFileSync(indice, 'utf8'), IMPRONTA); }
  catch { return null; }
})();
const servePagina = (req, res, next) => {
  if (!PAGINA) return next();
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.type('html').send(PAGINA);
};
app.get(['/', '/index.html'], servePagina);
const daRiconvalidare = f => !f.includes(`${path.sep}vendor${path.sep}`)
  && (/\.(html|js|css|json)$/.test(f) || /^icon[-.]/.test(path.basename(f)));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res, f) => { if (daRiconvalidare(f)) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get(/^\/(?!api|uploads).*/, servePagina);

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File troppo grande' });
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Troppi file in una volta sola' });
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Errore interno' });
});

const port = process.env.PORT || 3000;
// Le manutenzioni all'avvio: rimettono in ordine cose gia' in archivio, e
// nessuna serve a rispondere alla prima richiesta. Girano dopo che la porta e'
// aperta, una per volta, ognuna col suo catch. Tenute prima, allungavano
// l'avvio: e chi ci guarda da fuori aspetta un minuto, poi dichiara il servizio
// morto e lo riavvia — all'infinito, con la dashboard irraggiungibile.
async function manutenzioni() {
  // Recupera gli allenamenti gia' in archivio rimasti senza viaggio, per esempio
  // perche' il viaggio e' stato creato dopo averli importati
  await agganciaAllenamenti().catch(e => console.warn('aggancio allenamenti fallito:', e.message));
  await completaCoordinateSoste().catch(e => console.warn('soste senza posizione:', e.message));
  await normalizzaNomiEsistenti().catch(e => console.warn('uniformazione nomi fallita:', e.message));
  await completaExifMancanti().catch(e => console.warn('lettura exif fallita:', e.message));
  await sistemaDurateCarlock().catch(e => console.warn('durate CarLock non ricontate:', e.message));
  await sistemaDislivelliAssurdi().catch(e => console.warn('dislivelli non sistemati:', e.message));
  // Ripulisce anche i doppioni gia' in archivio, non solo quelli che arriveranno
  await rimuoviDoppioniAutomatici().catch(e => console.warn('pulizia doppioni fallita:', e.message));
  // Il nome del posto degli allenamenti: pochi per volta, che i geocoder
  // gratuiti non si tengono buoni a forza di richieste
  await completaLuoghiMancanti().catch(e => console.warn('luoghi degli allenamenti:', e.message));
  // E i posti delle foto, con lo stesso passo: servono a dire, rivedendo un
  // viaggio, dove si era quando si e' scattata
  await completaLuoghiFoto().catch(e => console.warn('luoghi delle foto:', e.message));
}

migrate().then(() => {
  app.listen(port, () => console.log(`Camper dashboard su porta ${port}`));
  console.log(sannoEvitareIPedaggi()
    ? 'percorsi: variante senza pedaggi attiva (OpenRouteService)'
    : 'percorsi: solo la variante piu\u2019 rapida (manca ORS_API_KEY)');
  manutenzioni().catch(e => console.warn('manutenzioni all\u2019avvio:', e.message));
  const every = Number(process.env.KOMOOT_SYNC_HOURS || 6);
  if (every > 0) {
    const giro = () => { syncAllKomoot(); syncAllStrava(); };
    setTimeout(giro, 60_000);
    setInterval(giro, every * 3600 * 1000);
  }
}).catch(e => { console.error('Migrazione fallita', e); process.exit(1); });

// Una promessa caduta e non raccolta fa uscire Node: qui si scrive e si tira
// avanti, perche' un guasto in un lavoro di sfondo non deve spegnere tutto
process.on('unhandledRejection', e => console.error('promessa non raccolta:', e?.message || e));
