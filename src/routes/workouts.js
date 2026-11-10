import { Router } from 'express';
import multer from 'multer';
import { q } from '../lib/db.js';
import { luogoDaCoordinate } from '../lib/geo.js';
import { wrap, encrypt, decrypt, num, samplePoints, haversineKm } from '../lib/util.js';
import { parseGpx } from '../lib/gpx.js';
import * as komoot from '../lib/komoot.js';
import * as strava from '../lib/strava.js';
import crypto from 'node:crypto';
import { requireAuth, requireDevice } from './auth.js';
import { agganciaAllenamenti } from './trips.js';

export const router = Router();
export const ingest = Router(); // montato PRIMA delle rotte con sessione: usa il token dispositivo
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
// L'export di mesi di allenamenti puo' superare il limite pensato per un singolo GPX
const uploadJson = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Chi e' stato cancellato a mano non torna: si riconosce dall'identificativo
// della sorgente, e in piu' dall'istante di partenza, perche' lo stesso giro
// cancellato su Komoot potrebbe ripresentarsi come record di Salute.
const CONDIZIONE_CESTINO = `user_id=$1 AND ((source=$2 AND external_id=$3)
  OR (started_at IS NOT NULL AND abs(extract(epoch FROM (started_at - $4::timestamptz))) <= 120))`;

async function saveWorkout(userId, w, tripId = null, opzioni = {}) {
  const idEsterno = w.external_id || `${w.source}-${new Date(w.started_at).toISOString()}`;
  const chiavi = [userId, w.source, idEsterno, w.started_at];
  if (opzioni.forzato) {
    // Caricato o scritto a mano adesso: la volonta' di oggi cancella quella di ieri
    await q(`DELETE FROM deleted_workouts WHERE ${CONDIZIONE_CESTINO}`, chiavi);
  } else if ((await q(`SELECT 1 FROM deleted_workouts WHERE ${CONDIZIONE_CESTINO} LIMIT 1`, chiavi)).rowCount) {
    return null;
  }
  // Nessuna app ha dichiarato la salita? La si conta sulla traccia, se porta la quota
  if (w.elevation_up_m == null) w.elevation_up_m = salitaDallaTraccia(w.track);
  // E quella dichiarata si controlla: se e' impossibile per la distanza, si
  // riconta sulla traccia, e se nemmeno quella risponde si lascia vuota. Un
  // numero sbagliato in grande gonfia i totali del mese e non si sospetta.
  w.elevation_up_m = salitaCredibile(w.elevation_up_m, w.distance_m, w.track);
  // Il nome dell'attivita' viene ricondotto alla forma unica; il titolo cambia solo
  // se coincideva col tipo, cosi' un nome scelto a mano resta intatto
  const sportNorm = normalizzaSport(w.sport);
  const nomeNorm = (w.name && w.sport && String(w.name).trim() === String(w.sport).trim()) ? sportNorm : w.name;
  w = { ...w, sport: sportNorm, name: nomeNorm };
  const r = await q(`INSERT INTO workouts(user_id,trip_id,source,external_id,sport,name,started_at,duration_s,distance_m,elevation_up_m,calories,hr_avg,hr_max,speed_avg_kmh,track,hr_track,meta)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (user_id,source,external_id) DO UPDATE SET
      sport=CASE WHEN workouts.sport_manual THEN workouts.sport ELSE coalesce(EXCLUDED.sport,workouts.sport) END,
      name=CASE WHEN workouts.sport_manual THEN workouts.name ELSE coalesce(EXCLUDED.name,workouts.name) END,
      duration_s=coalesce(EXCLUDED.duration_s,workouts.duration_s),
      distance_m=coalesce(EXCLUDED.distance_m,workouts.distance_m), elevation_up_m=coalesce(EXCLUDED.elevation_up_m,workouts.elevation_up_m),
      calories=coalesce(EXCLUDED.calories,workouts.calories), hr_avg=coalesce(EXCLUDED.hr_avg,workouts.hr_avg), hr_max=coalesce(EXCLUDED.hr_max,workouts.hr_max),
      speed_avg_kmh=coalesce(EXCLUDED.speed_avg_kmh,workouts.speed_avg_kmh), track=coalesce(EXCLUDED.track,workouts.track),
      hr_track=coalesce(EXCLUDED.hr_track,workouts.hr_track), meta=coalesce(workouts.meta,'{}')::jsonb || coalesce(EXCLUDED.meta,'{}')::jsonb,
      trip_id=coalesce(workouts.trip_id, EXCLUDED.trip_id)
    RETURNING *`,
    [userId, tripId ?? await guessTrip(w.started_at), w.source, idEsterno, w.sport || null, w.name || null, w.started_at,
      w.duration_s ?? null, w.distance_m ?? null, w.elevation_up_m ?? null, w.calories ?? null, w.hr_avg ?? null, w.hr_max ?? null, w.speed_avg_kmh ?? null,
      w.track ? JSON.stringify(w.track) : null, w.hr_track ? JSON.stringify(w.hr_track) : null, w.meta ? JSON.stringify(w.meta) : null]);
  return r.rows[0];
}

// Associa automaticamente l'allenamento al viaggio in corso in quella data
async function guessTrip(startedAt) {
  const d = new Date(startedAt);
  const r = await q(`SELECT id FROM trips WHERE (start_date IS NULL OR start_date <= $1::date) AND (end_date IS NULL OR end_date >= $1::date) AND (status='open' OR end_date IS NOT NULL) ORDER BY status='open' DESC, start_date DESC LIMIT 1`, [d]);
  return r.rows[0]?.id || null;
}

// Abbina un allenamento Salute (senza GPS) a uno Komoot/GPX vicino nel tempo, unendo battito/calorie
async function mergeHealthIntoTrack(userId, w) {
  const start = new Date(w.started_at);
  const r = await q(`SELECT * FROM workouts WHERE user_id=$1 AND source IN ('komoot','gpx','strava') AND abs(extract(epoch FROM (started_at - $2::timestamptz))) < 900 ORDER BY abs(extract(epoch FROM (started_at - $2::timestamptz))) LIMIT 1`, [userId, start]);
  const match = r.rows[0];
  if (!match) return null;
  // Con una curva vera arrivano anche la media e il massimo: se il pacchetto non
  // li dichiara si contano sulla curva, e comunque prendono il posto di quelli
  // ricostruiti dalle letture della giornata. Lasciare una media di 99 accanto a
  // una curva che sta sui 130 e' il modo piu' rapido di non capirci piu' niente.
  const curva = Array.isArray(w.hr_track) && w.hr_track.length ? w.hr_track : null;
  const medio = w.hr_avg ?? (curva ? Math.round(curva.reduce((a, p) => a + (+p[1] || 0), 0) / curva.length) : null);
  const massimo = w.hr_max ?? (curva ? Math.max(...curva.map(p => +p[1] || 0)) : null);
  await q(`UPDATE workouts SET calories=coalesce($2,calories),
      hr_avg=${curva ? '$3' : 'coalesce($3,hr_avg)'}, hr_max=${curva ? '$4' : 'coalesce($4,hr_max)'},
      hr_track=coalesce($6::jsonb,hr_track), meta=coalesce(meta,'{}')::jsonb || $5::jsonb WHERE id=$1`,
    [match.id, w.calories ?? null, medio, massimo,
      // Con il battito vero dell'orologio la ricostruzione non c'e' piu', e il
      // segno che la dichiarava andrebbe a raccontare una cosa falsa
      JSON.stringify({ health: w.meta || {}, merged_from_health: true,
        ...(w.hr_track ? { battiti_da_letture: null } : {}), ...(w.calories != null ? { calorie_da_letture: null } : {}) }),
      w.hr_track ? JSON.stringify(w.hr_track) : null]);
  return match.id;
}

// HAE dichiara la durata in secondi: quando ci sono inizio e fine usiamo quelli, che non dipendono dall’unità
function healthDuration(w) {
  const start = new Date(w.start), end = w.end ? new Date(w.end) : null;
  if (end && !isNaN(start) && !isNaN(end) && end > start) return Math.round((end - start) / 1000);
  return w.duration != null ? Math.round(num(w.duration)) : null;
}

// Il dislivello non arriva sempre con lo stesso nome, e non tutte le versioni
// dell'app lo esportano: si guardano i nomi che usa, e l'unita' dichiarata,
// perche' letta in piedi un'escursione di trecento metri ne dichiarerebbe mille.
function salitaAllenamento(w) {
  const q = w?.elevationUp ?? w?.elevationAscended ?? w?.totalAscent ?? w?.elevation?.ascent ?? w?.elevationGain;
  const valore = num(q?.qty ?? q);
  if (!Number.isFinite(valore) || valore <= 0) return null;
  const u = String(q?.units || w?.elevation?.units || 'm').toLowerCase().replace(/[^a-z]/g, '');
  const metri = (u === 'ft' || u.startsWith('feet') || u.startsWith('foot')) ? valore * 0.3048 : valore;
  return Math.round(metri);
}

// Converte la distanza nell’unità dichiarata da HAE (km, miglia, iarde, piedi; altrimenti metri)
// L'energia arriva con la sua unita': Salute la esporta spesso in kilojoule e
// prenderli per chilocalorie gonfia tutto di quattro volte. Per Apple "Cal" e'
// la chilocaloria, la caloria piccola non si usa.
const inKcal = (valore, unita) => {
  const u = String(unita || 'kcal').toLowerCase().replace(/[^a-z]/g, '');
  return (u === 'kj' || u.includes('joule')) ? valore / 4.184 : valore;
};
function healthEnergy(e) {
  if (e?.qty == null) return null;
  const q = num(e.qty);
  if (!Number.isFinite(q) || q <= 0) return null;   // uno zero vale quanto un dato assente
  return Math.round(inKcal(q, e.units));
}

// Sulle uscite in bici il telefono spesso segna energia attiva zero e riempie
// solo quella totale: meglio il totale, che comprende il metabolismo basale ed
// e' quindi un po' generoso, che un allenamento senza calorie. Da dove viene il
// numero resta scritto accanto all'allenamento.
function energiaAllenamento(w) {
  const attiva = healthEnergy(w.activeEnergy) ?? healthEnergy(w.activeEnergyBurned);
  if (attiva != null) return { kcal: attiva, da: 'attiva', unita: w.activeEnergy?.units || w.activeEnergyBurned?.units };
  const totale = healthEnergy(w.totalEnergy) ?? healthEnergy(w.totalEnergyBurned);
  if (totale != null) return { kcal: totale, da: 'totale', unita: w.totalEnergy?.units || w.totalEnergyBurned?.units };
  return { kcal: null, da: null, unita: undefined };
}

function healthDistance(d) {
  if (!d || d.qty == null) return null;
  const u = String(d.units || '').trim().toLowerCase();
  const f = u.startsWith('km') ? 1000 : u.startsWith('mi') ? 1609.344 : u.startsWith('yd') ? 0.9144 : u.startsWith('ft') ? 0.3048 : 1;
  return Math.round(num(d.qty) * f);
}

// I punti della traccia arrivano come lat/lon oppure latitude/longitude secondo la versione di HAE
// Salute manda un punto al secondo: una camminata di tre ore ne porta
// diecimila, e sulla mappa se ne distinguono seicento. Komoot e Strava
// arrivano gia' ridotti, e tenere le tracce leggere alleggerisce ogni cosa che
// le rilegge — la pulizia dei doppioni per prima.
// Il battito che arriva da Salute non e' un numero solo: e' una serie di misure
// con l'ora di ognuna. Qui diventa [[secondi dall'inizio, bpm], ...], che occupa
// un terzo dello spazio e si disegna uguale. Le misure prima della partenza o
// dopo l'arrivo restano fuori: sono di un altro momento.
function serieBattiti(w) {
  const dati = Array.isArray(w?.heartRateData) ? w.heartRateData : null;
  if (!dati?.length) return null;
  const inizio = new Date(w.start).getTime();
  if (!Number.isFinite(inizio)) return null;
  const fine = w.end ? new Date(w.end).getTime() : null;
  const punti = dati
    .map(x => [new Date(x?.date).getTime(), Math.round(num(x?.qty ?? x?.Avg ?? x?.avg))])
    .filter(([t, bpm]) => Number.isFinite(t) && bpm > 20 && bpm < 260 && t >= inizio - 60_000 && (!fine || t <= fine + 60_000))
    .sort((a, b) => a[0] - b[0])
    .map(([t, bpm]) => [Math.max(0, Math.round((t - inizio) / 1000)), bpm]);
  return punti.length > 1 ? samplePoints(punti, 400) : null;
}

// Dove e' successo. Un'escursione arriva chiamata «Escursione» da qualunque
// telefono: il posto lo sanno solo le coordinate della traccia. Si chiede una
// volta sola, piano - i servizi gratuiti vanno trattati bene - e resta scritto.
// Le salite assurde gia' in archivio: quelle contate quando lo zero valeva per
// una quota, e quelle arrivate sbagliate dalle app. Dove la traccia porta le
// quote si riconta; dove non c'e' niente su cui ricontare si svuota, che un
// campo vuoto si puo' riempire a mano mentre un numero sbagliato resta li' a
// gonfiare i totali.
export async function sistemaDislivelliAssurdi() {
  const righe = (await q(`SELECT id, distance_m, elevation_up_m, track FROM workouts
    WHERE elevation_up_m IS NOT NULL AND distance_m > 0
      AND elevation_up_m > greatest(200, distance_m / 1000.0 * 250)`)).rows;
  // E quelle in cui la traccia comincia (o passa) per zero: li' il conto di
  // prima aggiungeva in un colpo tutta l'altezza del paese
  const conZeri = (await q(`SELECT id, distance_m, elevation_up_m, track FROM workouts
    WHERE track IS NOT NULL AND elevation_up_m IS NOT NULL AND distance_m > 0
      AND jsonb_array_length(track->0) > 2 AND (track->0->>2) = '0'`)).rows;
  const tutte = [...righe, ...conZeri.filter(r => !righe.some(x => x.id === r.id))];
  if (!tutte.length) return 0;
  let ricontate = 0, svuotate = 0;
  for (const w of tutte) {
    const contata = salitaDallaTraccia(w.track);
    const tetto = salitaPossibile(w.distance_m);
    const impossibile = w.elevation_up_m > tetto;
    // Lo zero iniziale gonfiava di tutta l'altezza del paese: si riconosce dal
    // fatto che il numero vecchio e' molte volte quello nuovo, e di parecchio.
    // Uno scarto di qualche decina di metri invece no: li' il dato dell'app
    // vale piu' del nostro conto su una traccia alleggerita, e si lascia stare.
    const gonfiato = contata != null && w.elevation_up_m > contata * 2 && w.elevation_up_m - contata > 300;
    if (!impossibile && !gonfiato) continue;
    const buona = contata != null && contata <= tetto ? contata : null;
    if (buona === w.elevation_up_m) continue;
    await q('UPDATE workouts SET elevation_up_m=$2 WHERE id=$1', [w.id, buona]);
    if (buona == null) svuotate++; else ricontate++;
  }
  if (ricontate || svuotate) console.log(`dislivelli: ${ricontate} ricontati sulla traccia, ${svuotate} svuotati perche' impossibili`);
  return ricontate + svuotate;
}

export async function completaLuoghiMancanti(quanti = 40) {
  const senza = (await q(`SELECT id, track->0 AS p FROM workouts
      WHERE luogo IS NULL AND track IS NOT NULL ORDER BY started_at DESC LIMIT $1`, [quanti])).rows;
  if (!senza.length) return 0;
  let trovati = 0;
  for (const w of senza) {
    const lat = Number(w.p?.[0]), lon = Number(w.p?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const nome = await luogoDaCoordinate(lat, lon).catch(() => null);
    // Anche il buco si segna, altrimenti si richiede all'infinito lo stesso posto
    await q('UPDATE workouts SET luogo=$2 WHERE id=$1', [w.id, nome || '']);
    if (nome) trovati++;
    await new Promise(r => setTimeout(r, 1200));
  }
  console.log(`luoghi degli allenamenti: ${trovati} trovati su ${senza.length} cercati`);
  return trovati;
}

// ---------- battiti e calorie ricavati dalle letture della giornata ----------
// L'orologio misura il battito tutto il giorno anche quando nessuno ha avviato
// un allenamento. Chi registra il giro con komoot si ritrova percio' il
// tracciato ma nessun battito: in Salute, di quelle ore, non esiste nessuna
// sessione a cui attaccarli. Le letture pero' il telefono le manda lo stesso,
// fra le metriche, e finora le buttavamo via tutte tranne il peso. Si tengono
// da parte qualche settimana e, quando un allenamento di quelle ore non ha
// battiti, gliele si ritaglia addosso. Non e' la curva di un allenamento vero
// - li' c'e' una misura ogni pochi secondi, qui ogni pochi minuti - e proprio
// per questo resta scritto da dove viene.
const LETTURE_UTILI = { heart_rate: 'battiti', active_energy: 'energia' };
const GIORNI_LETTURE = 45;
const MIN_LETTURE = 3;

export function lettureDaPacchetto(body) {
  const metriche = Array.isArray(body?.data?.metrics) ? body.data.metrics : [];
  const viste = new Map();
  for (const m of metriche) {
    const tipo = LETTURE_UTILI[String(m?.name || '').toLowerCase()];
    if (!tipo) continue;
    for (const p of (Array.isArray(m.data) ? m.data : [])) {
      const quando = new Date(p?.date || p?.start || p?.startDate);
      const grezzo = num(p?.qty ?? p?.Avg ?? p?.avg ?? p?.value);
      if (isNaN(quando) || !Number.isFinite(grezzo) || grezzo <= 0) continue;
      const valore = tipo === 'energia' ? inKcal(grezzo, p.units || m.units) : grezzo;
      if (tipo === 'battiti' && (valore < 25 || valore > 260)) continue;
      // Lo stesso istante puo' arrivare due volte, dall'orologio e dal telefono:
      // due righe uguali manderebbero in errore l'inserimento in blocco
      viste.set(`${tipo}|${quando.toISOString()}`, { tipo, at: quando, valore: Math.round(valore * 100) / 100 });
    }
  }
  return [...viste.values()];
}

export async function archiviaLetture(userId, letture) {
  if (!letture.length) return 0;
  // Ogni invio ripete le letture del giorno gia' mandate: la chiave le fa
  // ricadere sulle stesse righe invece di moltiplicarle
  const r = await q(`INSERT INTO health_samples(user_id,kind,at,value)
      SELECT $1, k, t, v FROM unnest($2::text[], $3::timestamptz[], $4::float8[]) AS x(k,t,v)
      ON CONFLICT (user_id,kind,at) DO UPDATE SET value=EXCLUDED.value`,
    [userId, letture.map(l => l.tipo), letture.map(l => l.at), letture.map(l => l.valore)]);
  await q(`DELETE FROM health_samples WHERE at < now() - ($1 || ' days')::interval`, [GIORNI_LETTURE]);
  return r.rowCount;
}

// Attacca le letture agli allenamenti di quelle ore che ne sono senza. Non
// tocca niente di quello che e' arrivato davvero da Salute o dall'orologio:
// riempie solo i vuoti, e lascia detto che quel battito e' ricostruito.
export async function recuperaDaLetture(userId, giorni = 30) {
  // Si ricostruisce solo dove non si sa niente. Un allenamento registrato
  // dall'orologio ha gia' la sua media vera: appiccicargli accanto una curva di
  // letture passive, che sta venti battiti piu' in basso, farebbe litigare due
  // numeri sulla stessa pagina. Li' la curva vera si recupera riesportando
  // l'allenamento da Salute, non inventandola.
  const senza = (await q(`SELECT id, started_at, duration_s, calories, hr_avg, (hr_track IS NOT NULL) AS ha_battiti
      FROM workouts WHERE user_id=$1 AND started_at > now() - ($2 || ' days')::interval
        AND meta->'copiato_da' IS NULL
        AND ((hr_track IS NULL AND hr_avg IS NULL) OR calories IS NULL)
      ORDER BY started_at DESC`, [userId, giorni])).rows;
  let battiti = 0, calorie = 0;
  for (const w of senza) {
    const durata = Math.max(60, +w.duration_s || 0);
    const righe = (await q(`SELECT kind, extract(epoch FROM (at - $2::timestamptz))::int AS s, value
        FROM health_samples WHERE user_id=$1
          AND at >= $2::timestamptz - interval '2 minutes'
          AND at <= $2::timestamptz + ($3 || ' seconds')::interval + interval '2 minutes'
        ORDER BY at`, [userId, w.started_at, durata])).rows;
    if (!w.ha_battiti && w.hr_avg == null) {
      const bpm = righe.filter(x => x.kind === 'battiti');
      if (bpm.length >= MIN_LETTURE) {
        const serie = samplePoints(bpm.map(x => [Math.max(0, x.s), Math.round(x.value)]), 400);
        const medio = Math.round(bpm.reduce((a, x) => a + x.value, 0) / bpm.length);
        const massimo = Math.round(Math.max(...bpm.map(x => x.value)));
        await q(`UPDATE workouts SET hr_track=$2::jsonb, hr_avg=coalesce(hr_avg,$3), hr_max=coalesce(hr_max,$4),
            meta=coalesce(meta,'{}')::jsonb || $5::jsonb WHERE id=$1`,
          [w.id, JSON.stringify(serie), medio, massimo, JSON.stringify({ battiti_da_letture: bpm.length })]);
        battiti++;
      }
    }
    if (w.calories == null) {
      const kcal = righe.filter(x => x.kind === 'energia').reduce((a, x) => a + x.value, 0);
      if (kcal >= 1) {
        await q(`UPDATE workouts SET calories=$2, meta=coalesce(meta,'{}')::jsonb || $3::jsonb WHERE id=$1`,
          [w.id, Math.round(kcal), JSON.stringify({ calorie_da_letture: true })]);
        calorie++;
      }
    }
  }
  return { battiti, calorie, esaminati: senza.length };
}

function healthTrack(route) {
  if (!Array.isArray(route)) return null;
  const pts = route
    .map(p => [Number(p?.lat ?? p?.latitude), Number(p?.lon ?? p?.longitude), Number(p?.altitude ?? p?.alt ?? p?.elevation)])
    .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo))
    // La quota viaggia col punto: e' quella che, a fine giro, dice quanto si e'
    // salito anche quando nessuna app lo dichiara
    .map(([la, lo, q]) => Number.isFinite(q) ? [+la.toFixed(5), +lo.toFixed(5), Math.round(q)] : [+la.toFixed(5), +lo.toFixed(5)]);
  return pts.length ? samplePoints(pts, 600) : null;
}

// La salita contata sulla traccia, quando la traccia porta la quota: si sommano
// solo i dislivelli positivi, e si ignorano gli scalini sotto la soglia, che
// sono il tremolio del GPS e non una salita. Serve a chi registra con komoot e
// in Salute si ritrova l'uscita senza dislivello: il numero c'e' lo stesso,
// senza doverlo scrivere a mano.
const SOGLIA_SALITA_M = 2;
// Lo zero, nelle tracce, non vuol dire «livello del mare»: vuol dire che la
// quota non c'era. Una camminata a Valdobbiadene che comincia con uno zero e
// prosegue a mille metri non e' salita di mille metri nel primo passo. Si
// buttano via gli zeri, e anche i salti impossibili fra due punti vicini -
// quaranta metri in un battito sono un errore del sensore, non una parete.
const QUOTA_MINIMA = -430;            // il punto piu' basso di terra emersa
const SALTO_IMPOSSIBILE_M = 40;
// Oltre il quarantacinque per cento non e' piu' una salita da camminare: e'
// una parete. Nei primi secondi di registrazione la quota del GPS si assesta -
// parte da zero o da trenta metri e in un minuto arriva ai millecinquecento
// veri - e quella rampa, letta passo per passo, sommava settecento metri di
// dislivello a una passeggiata in pianoro. Misurata contro la strada fatta si
// riconosce: cinquanta metri di quota in dieci metri di terreno non li fa
// nessuno.
const PENDENZA_MASSIMA = 0.45;
export function salitaDallaTraccia(track) {
  const punti = (Array.isArray(track) ? track : [])
    .filter(p => Array.isArray(p) && p.length > 2)
    .map(p => ({ lat: Number(p[0]), lon: Number(p[1]), q: Number(p[2]) }))
    .filter(p => Number.isFinite(p.q) && p.q !== 0 && p.q > QUOTA_MINIMA && p.q < 9000
      && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (punti.length < 10) return null;
  let totale = 0, riferimento = punti[0].q, precedente = punti[0];
  for (const p of punti) {
    const passo = haversineKm([precedente.lat, precedente.lon], [p.lat, p.lon]) * 1000;
    const salto = Math.abs(p.q - precedente.q);
    // Il margine fisso serve quando due punti stanno quasi nello stesso posto:
    // li' la pendenza non significa niente
    if (salto > SALTO_IMPOSSIBILE_M || salto > passo * PENDENZA_MASSIMA + 5) {
      precedente = p; riferimento = p.q; continue;
    }
    precedente = p;
    if (p.q > riferimento + SOGLIA_SALITA_M) { totale += p.q - riferimento; riferimento = p.q; }
    else if (p.q < riferimento) riferimento = p.q;
  }
  return Math.round(totale) || null;
}

// Quanto puo' essere salito chi ha percorso quei metri. Il venticinque per
// cento di pendenza media e' gia' roba da ferrata: oltre, il numero non e' una
// salita - di solito e' la quota sul livello del mare scambiata per dislivello,
// come quei mille e cento metri a San Candido, che e' l'altezza del paese.
export const salitaPossibile = distanzaM => Math.max(200, (distanzaM || 0) / 1000 * 250);
export function salitaCredibile(salita, distanzaM, track) {
  if (salita == null || !(distanzaM > 0)) return salita ?? null;
  if (salita <= salitaPossibile(distanzaM)) return salita;
  const contata = salitaDallaTraccia(track);
  return contata != null && contata <= salitaPossibile(distanzaM) ? contata : null;
}

// Ogni sorgente chiama gli sport a modo suo: Salute traduce alla lettera ("Interno
// Esegui" per Indoor Run), Komoot usa sigle ("touringbicycle", "mtb_easy"), Strava
// l'inglese ("Ride"). Qui si riconduce tutto a un nome solo per disciplina, cosi'
// elenco, filtri e grafici parlano la stessa lingua. Applicata nel salvataggio,
// quindi vale per tutte le sorgenti; l'originale resta nel campo meta.
const GIA_NORMALIZZATI = new Set(['bicicletta', 'escursione', 'camminata', 'corsa', 'nuoto',
  'nuoto in piscina', 'nuoto in acque libere', 'camminata su tapis', 'corsa su tapis',
  'scialpinismo', 'sci di fondo', 'sci', 'snowboard']);

export function normalizzaSport(valore) {
  const originale = String(valore || '').trim();
  if (!originale) return valore;
  const t = originale.toLowerCase();
  if (GIA_NORMALIZZATI.has(t)) return originale;
  // Al chiuso viene prima: "Interno Camminata" e' camminata, ma soprattutto e' tapis
  const alChiuso = /interno|indoor|coperto|tapis|treadmill/.test(t);
  if (alChiuso && /camminat|walk/.test(t)) return 'Camminata su tapis';
  if (alChiuso && /cors|run|esegui/.test(t)) return 'Corsa su tapis';
  if (/ciclism|cycl|bicycle|bicicl|bike|mtb|gravel|ebike|ride|spinning/.test(t)) return 'Bicicletta';
  // La neve prima della montagna: «scialpinismo» contiene «alpinis» e senza
  // questa riga finirebbe fra le escursioni, che e' un'altra cosa
  if (/scialpinis|sci.?(di )?alpinis|ski.?tour|skitour/.test(t)) return 'Scialpinismo';
  if (/sci di fondo|fondo|cross.?country ski|nordic ski/.test(t)) return 'Sci di fondo';
  if (/snowboard|tavola da neve/.test(t)) return 'Snowboard';
  if (/^sci\b|sci alpino|downhill ski|alpine ski|[^a-z]ski[^a-z]|^ski$/.test(t)) return 'Sci';
  if (/escursion|hike|hiking|trekking|alpinis|mountaineer/.test(t)) return 'Escursione';
  if (/piscina|pool/.test(t) && /nuot|swim/.test(t)) return 'Nuoto in piscina';
  if (/acqua|acque|open water/.test(t) && /nuot|swim/.test(t)) return 'Nuoto in acque libere';
  if (/nuot|swim/.test(t)) return 'Nuoto';
  if (/camminat|walk/.test(t)) return 'Camminata';
  if (/cors|run|jogging|esegui/.test(t)) return 'Corsa';
  return originale;
}

// ---------- arrivo dei dati da iPhone ----------
// Ricava gli allenamenti dal pacchetto: sia il formato di "Health Auto Export"
// (data.workouts[]) sia quello semplice dei Comandi Rapidi
export function itemsDaPacchetto(body, origine) {
  if (Array.isArray(body.data?.workouts)) {
    return body.data.workouts.map(w => ({
      source: 'health', external_id: w.id || `${w.name}-${w.start}`, sport: w.name, name: w.name,
      started_at: new Date(w.start), duration_s: healthDuration(w),
      distance_m: healthDistance(w.distance),
      calories: energiaAllenamento(w).kcal,
      hr_avg: w.avgHeartRate?.qty != null ? Math.round(num(w.avgHeartRate.qty)) : (w.heartRate?.avg?.qty != null ? Math.round(num(w.heartRate.avg.qty)) : null),
      hr_max: w.maxHeartRate?.qty != null ? Math.round(num(w.maxHeartRate.qty)) : (w.heartRate?.max?.qty != null ? Math.round(num(w.heartRate.max.qty)) : null),
      elevation_up_m: salitaAllenamento(w),
      track: healthTrack(w.route), hr_track: serieBattiti(w),
      meta: { device: origine, steps: w.stepCount?.qty ?? null, temperature: w.temperature?.qty ?? null,
        nome_originale: w.name !== normalizzaSport(w.name) ? w.name : undefined,
        energia_da: energiaAllenamento(w).da || undefined,
        raw_units: { distance: w.distance?.units, energia: energiaAllenamento(w).unita } },
    }));
  }
  const list = Array.isArray(body) ? body : Array.isArray(body.workouts) ? body.workouts : [body];
  return list.filter(w => w && (w.start || w.started_at)).map(w => ({
    source: 'health', external_id: w.id || w.uuid || null, sport: w.type || w.sport || null, name: w.name || w.type || 'Allenamento',
    started_at: new Date(w.start || w.started_at), duration_s: w.duration_s != null ? num(w.duration_s) : (w.duration_min != null ? Math.round(num(w.duration_min) * 60) : null),
    distance_m: w.distance_m != null ? num(w.distance_m) : (w.distance_km != null ? Math.round(num(w.distance_km) * 1000) : null),
    calories: w.calories != null ? Math.round(num(w.calories)) : null, hr_avg: w.hr_avg != null ? Math.round(num(w.hr_avg)) : null, hr_max: w.hr_max != null ? Math.round(num(w.hr_max)) : null,
    elevation_up_m: w.elevation_up_m != null ? num(w.elevation_up_m) : null,
    track: Array.isArray(w.track) ? w.track : null, meta: { device: origine, ...(w.meta || {}) },
  }));
}
// Salva gli allenamenti, fondendo quelli senza GPS con l'attivita' Komoot/GPX corrispondente
export async function archivia(userId, items) {
  const saved = [], merged = [];
  let scartati = 0;
  for (const w of items) {
    const m = w.track ? null : await mergeHealthIntoTrack(userId, w);
    if (m) { merged.push(m); continue; }
    const riga = await saveWorkout(userId, w);
    if (riga) saved.push(riga.id); else scartati++;   // cancellato a mano: resta fuori
  }
  return { saved: saved.length, merged: merged.length, scartati };
}

// ---------- pesate ----------
// Salute esporta il peso fra le "metriche", non fra gli allenamenti:
// { data: { metrics: [ { name: "weight_body_mass", units: "kg",
//                        data: [ { date: "2024-05-03 07:12:00 +0200", qty: 72.4 } ] } ] } }
// Altre metriche hanno avg/min/max invece di qty, e le bilance americane mandano
// libbre: qui si tiene solo il peso corporeo, convertito in chilogrammi.
const PESO_CORPOREO = /weight|body_?mass|peso|massa.?corp/i;
// «body_mass_index» contiene «body_mass» e passava per peso: l'indice di massa
// corporea di chi pesa 71 kg vale 24, che e' un peso possibile per una persona,
// e con la regola della pesata piu' bassa vinceva sempre lui.
const NON_PESO = /index|indice|\bbmi\b|lean|fat|magra|grass|percent|perc\b|ratio|rapporto/i;
// Fra piu' metriche che somigliano al peso vince quella che il peso lo e' per
// nome: le altre sono misure derivate che gli assomigliano solo di numero.
const PESO_ESATTO = /^weight_body_mass$|^body_mass$|^weight$/i;
const inChili = (valore, unita) => {
  const u = String(unita || 'kg').toLowerCase();
  if (u.startsWith('lb') || u.includes('libbr') || u.includes('pound')) return valore * 0.45359237;
  if (u.startsWith('st')) return valore * 6.35029318;
  if (u === 'g' || u.startsWith('gramm')) return valore / 1000;
  return valore;                                   // kg e tutto il resto
};

// Diagnostica: quando un invio porta metriche ma nessun peso, sapere quali
// metriche c'erano dentro dice subito se il peso non e' stato scelto
// nell'automazione oppure se in Salute non c'e' proprio. Solo i nomi dei tipi
// di dato, mai un valore.
const nomiMetriche = body => (Array.isArray(body?.data?.metrics) ? body.data.metrics : [])
  .map(m => `${String(m?.name || '?')}[${Array.isArray(m?.data) ? m.data.length : 0}]`);

// Il peso si tiene con un decimale solo, tagliato e non arrotondato: 71,35 resta
// 71,3, e cosi' 71,38. Il centesimo che la bilancia manda non lo guarda nessuno,
// e arrotondarlo farebbe comparire nel grafico un numero che sul display della
// bilancia non c'e' mai stato. Il giro per i millesimi serve a togliere di mezzo
// la polvere della virgola mobile, che su 71,35 per poco non fa 71,34.
export const aUnDecimale = kg => Math.floor(Math.round(kg * 1000) / 100) / 10;

export function pesiDaPacchetto(body) {
  const metriche = body?.data?.metrics;
  if (!Array.isArray(metriche)) return [];
  const fuori = [];
  const candidate = metriche.filter(m => {
    const nome = String(m?.name || '');
    return PESO_CORPOREO.test(nome) && !NON_PESO.test(nome);
  });
  // Se c'e' la metrica che si chiama proprio «peso corporeo», le altre si lasciano stare
  const esatte = candidate.filter(m => PESO_ESATTO.test(String(m?.name || '')));
  for (const m of (esatte.length ? esatte : candidate)) {
    for (const p of (Array.isArray(m.data) ? m.data : [])) {
      const valore = num(p?.qty ?? p?.avg ?? p?.Avg ?? p?.value);
      const quando = new Date(p?.date || p?.start || p?.startDate);
      if (!Number.isFinite(valore) || valore <= 0 || isNaN(quando)) continue;
      const kg = inChili(valore, m.units || p.units);
      // Una bilancia che sballa non deve inquinare il grafico
      if (kg < 20 || kg > 400) continue;
      fuori.push({ measured_at: quando, kg: aUnDecimale(kg) });
    }
  }
  return fuori;
}

// Di una giornata resta la pesata del mattino, e fra piu' pesate del mattino la
// piu' bassa: e' quella che racconta il peso vero, prima che mangiare e bere lo
// muovano. Mattino vuol dire prima di mezzogiorno, ora italiana; nelle giornate
// in cui ci si e' pesati solo nel pomeriggio resta la minore di quelle, altrimenti
// la giornata sparirebbe dal grafico.
// La pesata corretta a mano vince su Salute, quale che sia il numero e l'ora:
// altrimenti il primo invio del telefono cancellerebbe la correzione appena fatta.
// Il confronto non guarda l'ordine di arrivo: lo stesso file ricaricato, o gli
// stessi invii in ordine diverso, portano sempre allo stesso risultato.
const E_MATTINO = ora => `coalesce(extract(hour FROM ${ora} AT TIME ZONE 'Europe/Rome') < 12, false)`;
export async function archiviaPesi(userId, pesi) {
  // Si contano le giornate, non le letture: due pesate dello stesso giorno
  // valgono per una, altrimenti il riepilogo direbbe numeri gonfiati
  const giornate = new Set(), respinte = [];
  for (const p of pesi) {
    const r = await q(`INSERT INTO weights(user_id, day, kg, measured_at, source)
                       VALUES($1, ($2::timestamptz AT TIME ZONE 'Europe/Rome')::date, $3, $2, 'health')
                       ON CONFLICT (user_id, day) DO UPDATE SET kg = EXCLUDED.kg, measured_at = EXCLUDED.measured_at
                       WHERE weights.source <> 'manual' AND (
                         (${E_MATTINO('EXCLUDED.measured_at')} AND NOT ${E_MATTINO('weights.measured_at')})
                         OR (${E_MATTINO('EXCLUDED.measured_at')} = ${E_MATTINO('weights.measured_at')}
                             AND EXCLUDED.kg < weights.kg))
                       RETURNING to_char(day,'YYYY-MM-DD') AS day`, [userId, p.measured_at, p.kg]);
    if (r.rowCount) { giornate.add(r.rows[0].day); continue; }
    // Una lettura che non entra ha sempre un motivo: dirlo evita di dover
    // indovinare perche' «la pesata di oggi non si vede»
    const ora = new Date(p.measured_at);
    const giorno = ora.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const attuale = (await q('SELECT kg::float AS kg, source, measured_at FROM weights WHERE user_id=$1 AND day=$2', [userId, giorno])).rows[0];
    respinte.push(`${giorno} ${ora.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}: `
      + (!attuale ? 'non inserita'
        : attuale.source === 'manual' ? 'quel giorno ha una pesata scritta a mano'
        : 'non batte quella gia\u2019 registrata'));
  }
  if (respinte.length) console.log(`pesate non entrate (${respinte.length}): ${respinte.slice(0, 6).join(' | ')}`);
  return giornate.size;
}

const formaPacchetto = body => Array.isArray(body.data?.workouts) || Array.isArray(body.data?.metrics)
  ? `data.workouts[${body.data?.workouts?.length || 0}] data.metrics[${body.data?.metrics?.length || 0}]`
  : `non riconosciuta (chiavi: ${Object.keys(body).join(',') || 'nessuna'}${body.data ? '; dentro data: ' + Object.keys(body.data).join(',') : ''})`;

ingest.post('/health', requireDevice, wrap(async (req, res) => {
  const body = req.body || {};
  const items = itemsDaPacchetto(body, req.device.name);
  const r = await archivia(req.user.id, items);
  const pesiTrovati = pesiDaPacchetto(body);
  const pesate = await archiviaPesi(req.user.id, pesiTrovati);
  // Battito ed energia della giornata si mettono da parte anche quando non
  // servono a niente: servono il giorno dopo, se arriva un giro senza battiti
  const letture = lettureDaPacchetto(body);
  await archiviaLetture(req.user.id, letture);
  const recuperati = await recuperaDaLetture(req.user.id);
  // Traccia l'esito: un invio accettato ma vuoto altrimenti non lascerebbe alcun segno.
  // Registriamo solo la forma del pacchetto e i conteggi, mai i dati sanitari.
  const metriche = nomiMetriche(body);
  console.log(`ingest: forma=${formaPacchetto(body)} elementi=${items.length} salvati=${r.saved} uniti=${r.merged}`
    + ` scartati=${r.scartati} letture-peso=${pesiTrovati.length} pesate=${pesate} letture=${letture.length}`
    + ` recuperi=${recuperati.battiti}b/${recuperati.calorie}k dispositivo=${req.device.name}`);
  // Un'uscita all'aperto senza dislivello: sapere quali campi c'erano nel
  // pacchetto dice se il telefono non lo esporta o se lo scrive con un nome che
  // non leggiamo. Solo i nomi dei campi, mai un valore.
  const senzaSalita = (body.data?.workouts || []).find((w, i) => items[i]?.elevation_up_m == null && (w?.route || w?.distance));
  if (senzaSalita) console.log(`ingest: uscita senza dislivello, campi nel pacchetto -> ${Object.keys(senzaSalita).join(' ').slice(0, 400)}`);
  if (metriche.length && !pesiTrovati.length) {
    console.log(`ingest: nessun peso fra le metriche di ${req.device.name} -> ${metriche.join(' ').slice(0, 400)}`);
  }
  if (r.saved) await rimuoviDoppioniAutomatici(req.user.id).catch(e => console.warn('pulizia doppioni fallita:', e.message));
  res.json({ ok: true, ...r, pesate, letture: letture.length, recuperati, device: req.device.name });
}));

// ---------- rotte autenticate ----------
router.use(requireAuth);

// Le discipline si riconoscono dal nome dell'attivita', non da un elenco fisso di
// valori: le sorgenti li scrivono in modi diversi e nella lingua del telefono.
// Salute manda "Interno Camminata" o "All'aperto Ciclismo", Komoot "hike",
// "touringbicycle", "mtb_easy". I criteri coprono italiano e inglese, cosi'
// valgono anche per gli allenamenti che arriveranno in futuro.
const TAPIS = `(
  lower(w.sport) ~ '(interno|indoor|coperto).*(camminat|esegui|cors|walk|run)'
  OR lower(w.sport) ~ '(camminat|esegui|cors|walk|run).*(interno|indoor|coperto)'
  OR lower(w.sport) ~ '(tapis|treadmill)'
)`;
// Tutto cio' che si fa sulla neve, in una definizione sola
const NEVE = `lower(w.sport) ~ '(sci|ski|snowboard|slalom)'`;
const DISCIPLINE = {
  tapis: TAPIS,
  // all'aperto: le versioni al chiuso sono gia' contate come tapis roulant
  camminata: `(lower(w.sport) ~ '(camminat|walk)' AND NOT ${TAPIS})`,
  corsa: `(lower(w.sport) ~ '(cors|running|[^a-z]run|^run|esegui)' AND NOT ${TAPIS})`,
  // «Scialpinismo» contiene «alpinis»: senza l'esclusione finirebbe anche qui,
  // contato due volte e in un gruppo che non e' il suo
  trekking: `(lower(w.sport) ~ '(escursion|hike|hiking|trekking|alpinis|mountaineer)' AND NOT ${NEVE})`,
  nuoto: `lower(w.sport) ~ '(nuot|swim)'`,
  // comprende mtb, gravel, bici da corsa e da cicloturismo
  ciclismo: `lower(w.sport) ~ '(ciclism|cycl|bicycle|bicicl|bike|bici|mtb|gravel|ebike|spinning|ride)'`,
  // Sci, scialpinismo, fondo e snowboard: tutto cio' che si fa sulla neve
  neve: NEVE,
};
DISCIPLINE.altro = `NOT (${Object.values(DISCIPLINE).join(' OR ')})`;
const CONDIZIONE_TAPIS = TAPIS;

router.get('/workouts', wrap(async (req, res) => {
  const { from, to, user_id, trip_id } = req.query;
  // Quante attivita' restituire: il vecchio tetto fisso di 300 tagliava fuori gli
  // archivi piu' lunghi anche senza filtri. Resta comunque un limite, per non
  // spedire l'intero storico a ogni apertura della pagina.
  const tetto = Math.min(Math.max(1, Number(req.query.limit) || 1000), 5000);
  const conds = [], params = [];
  if (from) { params.push(from); conds.push(`started_at >= $${params.length}`); }
  if (to) { params.push(to); conds.push(`started_at < $${params.length}::date + 1`); }
  if (user_id) { params.push(+user_id); conds.push(`w.user_id = $${params.length}`); }
  // trip_id accetta piu' valori separati da virgola; 'none' sono i non associati
  // tapis=1 mostra solo il tapis roulant, tapis=0 lo esclude
  if (req.query.tapis === '1') conds.push(CONDIZIONE_TAPIS);
  else if (req.query.tapis === '0') conds.push(`NOT ${CONDIZIONE_TAPIS}`);
  // disciplina accetta piu' valori separati da virgola: l'elenco li somma
  if (req.query.disciplina) {
    const scelte = String(req.query.disciplina).split(',').map(v => v.trim()).filter(v => DISCIPLINE[v]);
    if (scelte.length) conds.push('(' + scelte.map(v => DISCIPLINE[v]).join(' OR ') + ')');
  }
  if (trip_id) {
    const voci = String(trip_id).split(',').map(v => v.trim()).filter(Boolean);
    const ids = voci.filter(v => v !== 'none').map(Number).filter(Number.isInteger);
    const pezzi = [];
    if (ids.length) { params.push(ids); pezzi.push(`w.trip_id = ANY($${params.length}::int[])`); }
    if (voci.includes('none')) pezzi.push('w.trip_id IS NULL');
    if (pezzi.length) conds.push('(' + pezzi.join(' OR ') + ')');
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  // Il peso di quella giornata, e solo di quella: se sulla bilancia non ci si e'
  // saliti, accanto all'allenamento non compare nulla. Meglio il vuoto di un
  // numero preso in prestito da un altro giorno.
  const rows = (await q(`SELECT w.id,w.user_id,w.trip_id,w.source,w.sport,w.name,w.started_at,w.duration_s,w.distance_m,w.elevation_up_m,w.calories,w.hr_avg,w.hr_max,w.speed_avg_kmh,w.meta,(w.track IS NOT NULL) AS has_track,u.name AS athlete,t.title AS trip_title,
      p.kg AS peso_kg, p.day AS peso_giorno
    FROM workouts w JOIN users u ON u.id=w.user_id LEFT JOIN trips t ON t.id=w.trip_id
    LEFT JOIN weights p ON p.user_id = w.user_id
      AND p.day = (w.started_at AT TIME ZONE 'Europe/Rome')::date
    ${where} ORDER BY started_at DESC LIMIT $${params.length + 1}`, [...params, tetto])).rows;
  res.json(rows);
}));
// ---------- doppioni ----------
// Stessa uscita registrata due volte, di solito una da Komoot o da un GPX e una
// da Salute: capita quando su iPhone e' acceso l'invio del percorso, perche' con
// una traccia propria l'allenamento non si fonde con quello esistente.

// Komoot e Salute chiamano lo stesso sport in modi diversi: riconduciamoli a famiglie
// I nomi arrivano in inglese da Komoot e Strava, in italiano da Salute: servono entrambi,
// altrimenti "Escursionismo" e "hike" risultano discipline diverse e i doppioni sfuggono
const FAMIGLIE = {
  escursione: ['hike', 'hiking', 'escursion', 'trekking', 'alpinis', 'mountaineer'],
  camminata: ['walk', 'walking', 'camminat', 'passeggiat'],
  corsa: ['run', 'running', 'jogging', 'cors', 'esegui'],
  bici: ['bike', 'cycling', 'touringbicycle', 'mtb', 'racebike', 'ebike', 'ride', 'ciclism', 'bicicl', 'gravel'],
  nuoto: ['swim', 'swimming', 'nuot'],
  sci: ['ski', 'skitour', 'sci'],
};
function famigliaSport(s) {
  const t = String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return 'ignoto';
  for (const [fam, voci] of Object.entries(FAMIGLIE)) if (voci.some(v => t.includes(v))) return fam;
  return 'altro:' + t;
}

// Quanto e' completo un record: a parita' di uscita teniamo quello che dice di piu'
const ricchezza = w => (w.has_track ? 4 : 0) + (w.has_hr ? 1 : 0) + (['komoot', 'gpx', 'strava'].includes(w.source) ? 2 : 0)
  + (w.calories ? 1 : 0) + (w.hr_avg ? 1 : 0) + (w.elevation_up_m ? 1 : 0);

// Due record sono lo stesso allenamento se stesso atleta, stessa famiglia di sport,
// inizio a meno di 15 minuti e distanze compatibili (o entrambe assenti)
function stessoAllenamento(a, b) {
  if (a.user_id !== b.user_id) return false;
  if (Math.abs(new Date(a.started_at) - new Date(b.started_at)) > 15 * 60 * 1000) return false;
  const fa = famigliaSport(a.sport), fb = famigliaSport(b.sport);
  if (fa !== fb && fa !== 'ignoto' && fb !== 'ignoto') return false;
  const da = a.distance_m, db = b.distance_m;
  if (da == null && db == null) return true;
  if (da == null || db == null) return false;
  return Math.abs(da - db) <= 0.15 * Math.max(da, db);
}

// Quante attivita' per disciplina: serve a non proporre filtri che non selezionano nulla
router.get('/workouts/discipline', wrap(async (req, res) => {
  const atleta = req.query.user_id ? +req.query.user_id : null;
  const pezzi = Object.entries(DISCIPLINE).map(([k, c]) => `count(*) FILTER (WHERE ${c}) AS ${k}`);
  const r = (await q(`SELECT ${pezzi.join(', ')} FROM workouts w ${atleta ? 'WHERE w.user_id=$1' : ''}`, atleta ? [atleta] : [])).rows[0];
  res.json(Object.fromEntries(Object.keys(DISCIPLINE).map(k => [k, Number(r[k])])));
}));

// Gli atleti dell'installazione: servono al menu, che ha una voce per ciascuno,
// e alla copia degli allenamenti da una persona all'altra. Solo nomi, nessun dato
// riservato, quindi basta essere autenticati.
router.get('/athletes', wrap(async (req, res) => {
  const rows = (await q(`SELECT id, name FROM users WHERE approved ORDER BY id`)).rows;
  res.json(rows);
}));

// Copia uno o piu' allenamenti su un altro atleta. La copia e' indipendente:
// correggere poi l'originale non la tocca. Conserva traccia, orari, dislivello e
// il viaggio, e ricorda da chi proviene.
router.post('/workouts/copy', wrap(async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger);
  const dest = Number(req.body?.to_user_id);
  if (!ids.length) return res.status(400).json({ error: 'Nessun allenamento indicato' });
  if (!Number.isInteger(dest)) return res.status(400).json({ error: 'Atleta di destinazione mancante' });
  const atleta = (await q('SELECT id, name FROM users WHERE id=$1 AND approved', [dest])).rows[0];
  if (!atleta) return res.status(404).json({ error: 'Atleta di destinazione non trovato' });

  const originali = (await q('SELECT * FROM workouts WHERE id = ANY($1::int[])', [ids])).rows;
  let copiati = 0, gia = 0;
  for (const o of originali) {
    if (o.user_id === dest) continue;                       // e' gia' suo
    // L'identificativo della copia e' distinto da quello della sorgente, cosi' un
    // domani un import di Cate non si sovrascrive con questa copia
    const r = await q(`INSERT INTO workouts(user_id,trip_id,trip_manual,source,external_id,sport,name,started_at,duration_s,distance_m,
        elevation_up_m,calories,hr_avg,hr_max,speed_avg_kmh,track,hr_track,meta)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (user_id,source,external_id) DO NOTHING RETURNING id`,
      [dest, o.trip_id, o.trip_manual, o.source, `copia-${o.id}`, o.sport, o.name, o.started_at, o.duration_s, o.distance_m,
        o.elevation_up_m, o.calories, o.hr_avg, o.hr_max, o.speed_avg_kmh, o.track ? JSON.stringify(o.track) : null,
        o.hr_track ? JSON.stringify(o.hr_track) : null,
        JSON.stringify({ ...(o.meta || {}), copiato_da: { id: o.id, atleta: req.user.name } })]);
    if (r.rows[0]) copiati++; else gia++;
  }
  console.log(`copia allenamenti: ${copiati} verso ${atleta.name}, ${gia} gia' presenti`);
  res.json({ ok: true, copiati, gia_presenti: gia, atleta: atleta.name });
}));

// Anni in cui esiste almeno un allenamento, per il selettore del periodo
// Chi puo' scrivere nell'archivio di un altro: solo l'amministratore, come
// per i dispositivi e per l'importazione dei file
async function archivioDi(req, res) {
  const chiesto = req.body?.user_id ?? req.query?.user_id;
  if (chiesto == null || +chiesto === req.user.id) return req.user.id;
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Solo amministratore' }); return null; }
  const u = (await q('SELECT id FROM users WHERE id=$1', [+chiesto])).rows[0];
  if (!u) { res.status(404).json({ error: 'Utente non trovato' }); return null; }
  return u.id;
}

// Pesata inserita o corretta a mano: vale per la giornata e prende il posto di
// quella di Salute, che non tornera' a sovrascriverla
router.post('/weights', wrap(async (req, res) => {
  const chi = await archivioDi(req, res); if (chi == null) return;
  const giorno = String(req.body?.day || '').slice(0, 10);
  const kg = aUnDecimale(num(req.body?.kg));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno) || isNaN(new Date(giorno))) return res.status(400).json({ error: 'Data non valida' });
  if (giorno > new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })) return res.status(400).json({ error: 'Non si puo\u2019 pesare un giorno futuro' });
  if (!Number.isFinite(kg) || kg < 20 || kg > 400) return res.status(400).json({ error: 'Peso fuori misura: sono ammessi da 20 a 400 kg' });
  const r = (await q(`INSERT INTO weights(user_id, day, kg, measured_at, source) VALUES($1,$2,$3,NULL,'manual')
                      ON CONFLICT (user_id, day) DO UPDATE SET kg = EXCLUDED.kg, measured_at = NULL, source = 'manual'
                      RETURNING to_char(day,'YYYY-MM-DD') AS day, kg::float AS kg, source`, [chi, giorno, kg])).rows[0];
  res.json(r);
}));

router.delete('/weights/:day', wrap(async (req, res) => {
  const chi = await archivioDi(req, res); if (chi == null) return;
  const r = await q('DELETE FROM weights WHERE user_id=$1 AND day=$2', [chi, String(req.params.day).slice(0, 10)]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Nessuna pesata quel giorno' });
}));

// Le pesate di un atleta, per il grafico dell'andamento nel tempo
router.get('/weights', wrap(async (req, res) => {
  const chi = req.query.user_id ? +req.query.user_id : req.user.id;
  const conds = ['user_id = $1'], params = [chi];
  if (req.query.from) { params.push(req.query.from); conds.push(`day >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); conds.push(`day <= $${params.length}`); }
  // L'ora della misura serve a capire se le pesate arrivano vere o gia'
  // aggregate: una pesata a mezzanotte non l'ha fatta nessuno
  const rows = (await q(`SELECT to_char(day,'YYYY-MM-DD') AS day, kg::float AS kg, source,
      to_char(measured_at AT TIME ZONE 'Europe/Rome','HH24:MI') AS ora FROM weights
                         WHERE ${conds.join(' AND ')} ORDER BY day`, params)).rows;
  res.json(rows);
}));

router.get('/workouts/anni', wrap(async (req, res) => {
  const atleta = req.query.user_id ? +req.query.user_id : null;
  const rows = (await q(`SELECT DISTINCT extract(year FROM started_at AT TIME ZONE 'Europe/Rome')::int AS anno FROM workouts
    ${atleta ? 'WHERE user_id=$1' : ''} ORDER BY anno DESC`, atleta ? [atleta] : [])).rows;
  res.json(rows.map(r => r.anno));
}));

// Rimozione automatica dei doppioni con lo stesso orario di partenza.
// Regola voluta: fra due registrazioni della stessa uscita resta quella di Salute.
// Prima di eliminare l'altra le si travasa tutto cio' che al superstite manca -
// soprattutto la traccia GPS, che Salute spesso non ha - cosi' non si perde niente.
// La finestra e' di due minuti, non i quindici della ricerca manuale: qui nessuno
// conferma, e un criterio largo cancellerebbe attivita' diverse ma ravvicinate.
const FINESTRA_AUTO_MS = 2 * 60 * 1000;
// A piedi la stessa uscita puo' essere "camminata" per una app ed "escursione" per
// un'altra: per il confronto vanno considerate la stessa cosa
const A_PIEDI = ['camminata', 'escursione'];
function disciplineCompatibili(s1, s2) {
  const f1 = famigliaSport(s1), f2 = famigliaSport(s2);
  if (f1 === f2 || f1 === 'ignoto' || f2 === 'ignoto') return true;
  return A_PIEDI.includes(f1) && A_PIEDI.includes(f2);
}
const CAMPI_DA_TRAVASARE = ['track', 'distance_m', 'duration_s', 'elevation_up_m', 'calories', 'hr_avg', 'hr_max', 'speed_avg_kmh', 'trip_id'];
// Misure dove uno zero vuol dire «non lo so», non «zero»
const SALITA_O_SFORZO = ['elevation_up_m', 'calories', 'hr_avg', 'hr_max', 'speed_avg_kmh'];

// Riporta alla forma unica anche i nomi gia' in archivio. Gira all'avvio e usa la
// stessa funzione dei dati in arrivo, cosi' non esistono due tabelle da tenere allineate.
export async function normalizzaNomiEsistenti() {
  const rows = (await q('SELECT DISTINCT sport FROM workouts WHERE sport IS NOT NULL')).rows;
  let cambiati = 0;
  for (const { sport } of rows) {
    const nuovo = normalizzaSport(sport);
    if (nuovo === sport) continue;
    const r = await q('UPDATE workouts SET sport=$2, name=CASE WHEN name=$1 THEN $2 ELSE name END WHERE sport=$1 AND NOT sport_manual', [sport, nuovo]);
    console.log(`nomi: "${sport}" -> "${nuovo}" (${r.rowCount})`);
    cambiati += r.rowCount;
  }
  return cambiati;
}

export async function rimuoviDoppioniAutomatici(userId = null) {
  const dove = userId ? 'WHERE w.user_id=$1' : '';
  // La traccia non si legge qui: pesa quanto tutto il resto messo insieme e
  // questa pulizia gira dopo ogni invio dal telefono. Serve solo sapere se c'e',
  // e il contenuto si va a prendere per il singolo record che lo deve cedere.
  const rows = (await q(`SELECT w.id, w.user_id, w.source, w.sport, w.started_at, w.distance_m, w.duration_s,
      w.elevation_up_m, w.calories, w.hr_avg, w.hr_max, w.speed_avg_kmh, w.trip_id, (w.track IS NOT NULL) AS has_track,
      (w.hr_track IS NOT NULL) AS has_hr
    FROM workouts w ${dove} ORDER BY w.started_at`, userId ? [userId] : [])).rows;

  const visti = new Set();
  let eliminati = 0, travasati = 0;
  for (let i = 0; i < rows.length; i++) {
    if (visti.has(rows[i].id)) continue;
    const gruppo = [rows[i]];
    for (let j = i + 1; j < rows.length; j++) {
      if (visti.has(rows[j].id)) continue;
      if (new Date(rows[j].started_at) - new Date(rows[i].started_at) > FINESTRA_AUTO_MS) break;
      const a = rows[i], b = rows[j];
      if (a.user_id !== b.user_id) continue;
      // Entro un minuto la coincidenza basta da sola: nessuno comincia due attivita'
      // diverse cosi' a ridosso, e le app danno nomi diversi alla stessa uscita
      const vicinissimi = Math.abs(new Date(b.started_at) - new Date(a.started_at)) <= 60 * 1000;
      if (!vicinissimi && !disciplineCompatibili(a.sport, b.sport)) continue;
      gruppo.push(b);
    }
    if (gruppo.length < 2) continue;
    gruppo.forEach(g => visti.add(g.id));

    // Salute ha la precedenza; a parita' vince il record piu' completo, poi il piu' vecchio
    const ordinati = [...gruppo].sort((a, b) =>
      (b.source === 'health') - (a.source === 'health') || ricchezza(b) - ricchezza(a) || a.id - b.id);
    const tenuto = ordinati[0], scartati = ordinati.slice(1);

    // Lo zero, su queste misure, non e' un valore: e' un dato che manca. Salute
    // scrive spesso dislivello zero su una camminata in collina, e finche' lo
    // zero valeva come numero la cifra vera di komoot finiva nel cestino insieme
    // al suo record. Distanza e durata invece lo zero se lo tengono: li' non c'e'
    // niente da indovinare.
    const vuoto = (w, campo) => w[campo] == null || (SALITA_O_SFORZO.includes(campo) && !w[campo]);
    const mancanti = {};
    for (const campo of CAMPI_DA_TRAVASARE) {
      if (campo === 'track') continue;                       // la traccia ha una strada sua, qui sotto
      if (!vuoto(tenuto, campo)) continue;
      const donatore = scartati.find(x => !vuoto(x, campo));
      if (donatore) mancanti[campo] = donatore[campo];
    }
    // La traccia e la curva del battito si vanno a prendere solo se al superstite
    // mancano e qualcuno ce le ha: pesano, e leggerle per tutti sarebbe sprecato
    for (const [campo, ce] of [['track', 'has_track'], ['hr_track', 'has_hr']]) {
      if (tenuto[ce]) continue;
      const donatore = scartati.find(x => x[ce]);
      if (!donatore) continue;
      const v = (await q(`SELECT ${campo} AS v FROM workouts WHERE id=$1`, [donatore.id])).rows[0]?.v;
      if (v) mancanti[campo] = v;
    }
    // Con la traccia appena ereditata si puo' contare la salita che non aveva
    // dichiarato nessuno dei due
    if (vuoto(tenuto, 'elevation_up_m') && mancanti.elevation_up_m == null && mancanti.track) {
      const contata = salitaDallaTraccia(mancanti.track);
      if (contata) mancanti.elevation_up_m = contata;
    }
    const chiavi = Object.keys(mancanti);
    if (chiavi.length) {
      const set = chiavi.map((k, n) => `${k}=$${n + 2}`).join(', ');
      await q(`UPDATE workouts SET ${set} WHERE id=$1`,
        [tenuto.id, ...chiavi.map(k => (k === 'track' || k === 'hr_track' ? JSON.stringify(mancanti[k]) : mancanti[k]))]);
      travasati++;
    }
    await q('DELETE FROM workouts WHERE id = ANY($1::int[])', [scartati.map(x => x.id)]);
    eliminati += scartati.length;
  }
  if (eliminati) console.log(`doppioni automatici: eliminati ${eliminati}, dati recuperati in ${travasati} record`);
  return { eliminati, travasati };
}

router.get('/workouts/duplicates', wrap(async (req, res) => {
  const rows = (await q(`SELECT w.id,w.user_id,w.source,w.sport,w.name,w.started_at,w.duration_s,w.distance_m,w.elevation_up_m,w.calories,w.hr_avg,
      (w.track IS NOT NULL) AS has_track, u.name AS athlete, t.title AS trip_title
    FROM workouts w JOIN users u ON u.id=w.user_id LEFT JOIN trips t ON t.id=w.trip_id ORDER BY w.started_at`)).rows;
  const visti = new Set(), gruppi = [];
  for (let i = 0; i < rows.length; i++) {
    if (visti.has(rows[i].id)) continue;
    const gruppo = [rows[i]];
    for (let j = i + 1; j < rows.length; j++) {
      if (visti.has(rows[j].id)) continue;
      if (new Date(rows[j].started_at) - new Date(rows[i].started_at) > 15 * 60 * 1000) break;
      if (gruppo.some(g => stessoAllenamento(g, rows[j]))) gruppo.push(rows[j]);
    }
    if (gruppo.length < 2) continue;
    gruppo.forEach(g => visti.add(g.id));
    const ordinati = [...gruppo].sort((a, b) => ricchezza(b) - ricchezza(a) || a.id - b.id);
    gruppi.push({ tieni: ordinati[0], elimina: ordinati.slice(1) });
  }
  res.json({ gruppi, totale_da_eliminare: gruppi.reduce((a, g) => a + g.elimina.length, 0) });
}));

// Elimina solo gli id indicati, e solo se sono davvero doppioni di qualcosa che resta
router.post('/workouts/duplicates/remove', wrap(async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return res.status(400).json({ error: 'Nessun allenamento indicato' });
  const eliminati = await cestina(ids, req);
  console.log(`doppioni: eliminati ${eliminati} allenamenti su ${ids.length} richiesti, utente=${req.user.id}`);
  res.json({ ok: true, eliminati });
}));

// ---------- uscite spezzate in piu' tronconi ----------
// Una camminata interrotta dal pranzo, o una gita registrata in tre riprese,
// arriva come piu' allenamenti dello stesso tipo a poche decine di minuti l'uno
// dall'altro. Non sono doppioni — descrivono tratti diversi — quindi non si
// scarta nulla: si sommano le grandezze che si sommano e si mettono in fila le
// tracce. E' una scelta di chi guarda, mai automatica: due giri in bici davvero
// distinti nella stessa mattina hanno lo stesso aspetto.
function stacco(precedente, seguente) {
  const fine = new Date(precedente.started_at).getTime() + (precedente.duration_s || 0) * 1000;
  return (new Date(seguente.started_at).getTime() - fine) / 60000;   // minuti
}

async function gruppiRavvicinati(userId, minuti) {
  const rows = (await q(`SELECT id, trip_id, source, sport, name, started_at, duration_s, distance_m,
      elevation_up_m, calories, hr_avg, hr_max, (track IS NOT NULL) AS has_track,
      to_char(started_at AT TIME ZONE 'Europe/Rome','YYYY-MM-DD') AS giorno
    FROM workouts WHERE user_id=$1 ORDER BY started_at`, [userId])).rows;
  const perGiornoEsport = new Map();
  for (const r of rows) {
    const chiave = `${r.giorno}|${r.sport || ''}`;
    if (!perGiornoEsport.has(chiave)) perGiornoEsport.set(chiave, []);
    perGiornoEsport.get(chiave).push(r);
  }
  const gruppi = [];
  for (const lista of perGiornoEsport.values()) {
    let corrente = [lista[0]];
    for (let i = 1; i < lista.length; i++) {
      if (stacco(corrente[corrente.length - 1], lista[i]) <= minuti) corrente.push(lista[i]);
      else { if (corrente.length > 1) gruppi.push(corrente); corrente = [lista[i]]; }
    }
    if (corrente.length > 1) gruppi.push(corrente);
  }
  return gruppi;
}

// Distanza, durata, dislivello e calorie si sommano perche' sono tratti diversi
// della stessa uscita. Il battito no: si fa la media pesata sulla durata, perche'
// mezz'ora a 150 e due ore a 110 non fanno 130. La media oraria si ricalcola.
function fondiPezzi(pezzi) {
  const ord = [...pezzi].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  const somma = campo => {
    const v = ord.reduce((t, p) => p[campo] != null ? t + Number(p[campo]) : t, 0);
    return ord.some(p => p[campo] != null) ? Math.round(v) : null;
  };
  const durata = somma('duration_s'), distanza = somma('distance_m');
  const conBattito = ord.filter(p => p.hr_avg != null && p.duration_s > 0);
  const secondi = conBattito.reduce((t, p) => t + p.duration_s, 0);
  return {
    started_at: ord[0].started_at,
    sport: ord[0].sport, name: ord[0].name,
    duration_s: durata, distance_m: distanza,
    elevation_up_m: somma('elevation_up_m'), calories: somma('calories'),
    hr_avg: secondi ? Math.round(conBattito.reduce((t, p) => t + p.hr_avg * p.duration_s, 0) / secondi) : null,
    hr_max: ord.reduce((m, p) => (p.hr_max != null && (m == null || p.hr_max > m)) ? p.hr_max : m, null),
    speed_avg_kmh: (distanza && durata) ? Math.round((distanza / 1000) / (durata / 3600) * 100) / 100 : null,
    trip_id: ord.find(p => p.trip_id != null)?.trip_id ?? null,
    pezzi: ord.length,
  };
}

router.get('/workouts/gruppi', wrap(async (req, res) => {
  const chi = req.query.user_id ? +req.query.user_id : req.user.id;
  const minuti = Math.min(Math.max(1, Number(req.query.minuti) || 60), 600);
  const gruppi = (await gruppiRavvicinati(chi, minuti)).map(g => ({
    pezzi: g.map(p => ({ id: p.id, source: p.source, sport: p.sport, name: p.name, started_at: p.started_at,
      duration_s: p.duration_s, distance_m: p.distance_m, calories: p.calories, hr_avg: p.hr_avg, has_track: p.has_track })),
    stacchi: g.slice(1).map((p, i) => Math.round(stacco(g[i], p))),
    unione: fondiPezzi(g),
  }));
  res.json({ minuti, gruppi });
}));

// L'unione tiene il primo troncone e gli versa dentro gli altri. I pezzi vengono
// tenuti fuori dalle prossime sincronizzazioni, altrimenti tornerebbero a pezzi,
// e l'unione prende un identificativo suo perche' nessuno la riscriva.
router.post('/workouts/gruppi/unisci', wrap(async (req, res) => {
  const gruppi = Array.isArray(req.body?.gruppi) ? req.body.gruppi : [];
  if (!gruppi.length) return res.status(400).json({ error: 'Nessun gruppo indicato' });
  let unite = 0, assorbiti = 0;
  for (const voci of gruppi) {
    const ids = (voci || []).map(Number).filter(Number.isInteger);
    if (ids.length < 2) continue;
    const righe = (await q(`SELECT * FROM workouts WHERE id = ANY($1::int[]) AND (user_id=$2 OR $3) ORDER BY started_at`,
      [ids, req.user.id, req.user.role === 'admin'])).rows;
    if (righe.length < 2) continue;
    const u = fondiPezzi(righe);
    const tenuto = righe[0];
    const traccia = righe.filter(r => r.track).flatMap(r => r.track);
    // Le curve del battito dei tronconi si rimettono in fila, ognuna spostata di
    // quanto e' distante il suo inizio dall'inizio del primo
    const zero = new Date(righe[0].started_at).getTime();
    const battiti = righe.filter(r => r.hr_track?.length).flatMap(r => {
      const scarto = Math.max(0, Math.round((new Date(r.started_at).getTime() - zero) / 1000));
      return r.hr_track.map(([t, bpm]) => [t + scarto, bpm]);
    }).sort((a, b) => a[0] - b[0]);
    await q(`UPDATE workouts SET duration_s=$2, distance_m=$3, elevation_up_m=$4, calories=$5, hr_avg=$6, hr_max=$7,
        speed_avg_kmh=$8, track=$9, hr_track=$14, trip_id=$10, external_id=$11,
        meta = coalesce(meta,'{}')::jsonb || jsonb_build_object('unito_da', $12::jsonb, 'pezzi_uniti', $13::int)
      WHERE id=$1`,
      [tenuto.id, u.duration_s, u.distance_m, u.elevation_up_m, u.calories, u.hr_avg, u.hr_max, u.speed_avg_kmh,
        traccia.length ? JSON.stringify(traccia) : null, u.trip_id, `unione-${tenuto.id}`,
        JSON.stringify(righe.map(r => ({ id: r.id, source: r.source, external_id: r.external_id, started_at: r.started_at,
          duration_s: r.duration_s, distance_m: r.distance_m, calories: r.calories, hr_avg: r.hr_avg }))),
        righe.length, battiti.length ? JSON.stringify(battiti) : null]);
    // I tronconi non devono tornare col prossimo scarico, nemmeno il primo, che
    // ora vive sotto un altro identificativo
    for (const r of righe) {
      await q(`INSERT INTO deleted_workouts(user_id, source, external_id, sport, name, started_at)
               VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, source, external_id) DO UPDATE SET deleted_at = now()`,
        [r.user_id, r.source, r.external_id, r.sport, r.name, r.started_at]);
    }
    await q('DELETE FROM workouts WHERE id = ANY($1::int[])', [righe.slice(1).map(r => r.id)]);
    unite++; assorbiti += righe.length - 1;
  }
  console.log(`unioni: ${unite} uscite ricomposte, ${assorbiti} tronconi assorbiti, utente=${req.user.id}`);
  res.json({ ok: true, unite, assorbiti });
}));

// Gli allenamenti tenuti fuori, con la possibilita' di riaprire la porta
router.get('/workouts/esclusi', wrap(async (req, res) => {
  const chi = req.query.user_id ? +req.query.user_id : req.user.id;
  res.json((await q(`SELECT id, source, sport, name, started_at FROM deleted_workouts
                     WHERE user_id=$1 ORDER BY started_at DESC NULLS LAST LIMIT 500`, [chi])).rows);
}));

router.delete('/workouts/esclusi/:id', wrap(async (req, res) => {
  const r = await q('DELETE FROM deleted_workouts WHERE id=$1 AND (user_id=$2 OR $3)',
    [req.params.id, req.user.id, req.user.role === 'admin']);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Non trovato' });
}));

router.get('/workouts/:id', wrap(async (req, res) => {
  const r = (await q(`SELECT w.*, u.name AS athlete, t.title AS trip_title, p.kg AS peso_kg, p.day AS peso_giorno
    FROM workouts w JOIN users u ON u.id=w.user_id LEFT JOIN trips t ON t.id=w.trip_id
    LEFT JOIN weights p ON p.user_id = w.user_id
      AND p.day = (w.started_at AT TIME ZONE 'Europe/Rome')::date
    WHERE w.id=$1`, [req.params.id])).rows[0];
  r ? res.json(r) : res.status(404).json({ error: 'Non trovato' });
}));
router.put('/workouts/:id', wrap(async (req, res) => {
  const b = req.body || {};
  // trip_auto: torna all'abbinamento automatico in base alle date del viaggio.
  // Altrimenti il viaggio si tocca solo se il chiamante lo manda davvero, cosi'
  // rinominare non lo slega; e una scelta esplicita resta tale, anche "nessun viaggio".
  const tornaAutomatico = b.trip_auto === true;
  const cambiaViaggio = tornaAutomatico || Object.prototype.hasOwnProperty.call(b, 'trip_id');
  const nome = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : null;
  // Un campo assente resta com'e'; un campo vuoto vale zero, non "non toccare"
  const numero = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const distanza = numero(b.distance_m), durata = numero(b.duration_s);
  let r = (await q(`UPDATE workouts SET
      trip_id=CASE WHEN $2 THEN $3::int ELSE trip_id END,
      trip_manual=CASE WHEN $11 THEN false WHEN $2 THEN true ELSE trip_manual END,
      -- Cambiando disciplina, un titolo che era solo il nome della disciplina la
      -- segue; un titolo scritto a mano resta quello che e'
      name=CASE WHEN $5::text IS NOT NULL AND name = sport THEN $5::text ELSE coalesce($4,name) END,
      sport=coalesce($5,sport), sport_manual=CASE WHEN $5::text IS NOT NULL THEN true ELSE sport_manual END,
      calories=coalesce($6,calories), hr_avg=coalesce($7,hr_avg), hr_max=coalesce($8,hr_max),
      distance_m=coalesce($12,distance_m), duration_s=coalesce($13,duration_s), elevation_up_m=coalesce($14,elevation_up_m)
    WHERE id=$1 AND (user_id=$9 OR $10) RETURNING *`,
    [req.params.id, cambiaViaggio, tornaAutomatico ? null : (b.trip_id || null), nome, b.sport, b.calories, b.hr_avg, b.hr_max, req.user.id, req.user.role === 'admin', tornaAutomatico,
      distanza, durata, numero(b.elevation_up_m)])).rows[0];
  if (!r) return res.status(404).json({ error: 'Allenamento non trovato, o non tuo' });
  // La media va ricalcolata quando cambia distanza o durata, altrimenti resterebbe
  // quella vecchia e contraddirebbe i valori mostrati accanto
  if (distanza !== null || durata !== null) {
    r = (await q(`UPDATE workouts SET speed_avg_kmh = CASE WHEN coalesce(duration_s,0) > 0 AND distance_m IS NOT NULL
        THEN round(((distance_m/1000.0)/(duration_s/3600.0))::numeric, 2) ELSE NULL END
      WHERE id=$1 RETURNING *`, [req.params.id])).rows[0];
  }
  if (tornaAutomatico) {
    await agganciaAllenamenti();
    r = (await q('SELECT * FROM workouts WHERE id=$1', [req.params.id])).rows[0];
  }
  res.json(r);
}));
// Cancellazione voluta: prima di togliere la riga se ne prende nota, cosi' la
// prossima sincronizzazione non la riporta indietro
async function cestina(ids, req) {
  const r = await q(`DELETE FROM workouts WHERE id = ANY($1::int[]) AND (user_id=$2 OR $3)
                     RETURNING user_id, source, external_id, sport, name, started_at`,
    [ids, req.user.id, req.user.role === 'admin']);
  for (const w of r.rows) {
    await q(`INSERT INTO deleted_workouts(user_id,source,external_id,sport,name,started_at)
             VALUES($1,$2,$3,$4,$5,$6)
             ON CONFLICT (user_id,source,external_id) DO UPDATE SET deleted_at = now()`,
      [w.user_id, w.source, w.external_id, w.sport, w.name, w.started_at]);
  }
  return r.rowCount;
}

router.delete('/workouts/:id', wrap(async (req, res) => {
  await cestina([+req.params.id], req); res.json({ ok: true });
}));

// Importazione manuale del JSON di Health Auto Export: serve per recuperare lo
// storico, visto che l'automazione sul telefono copre al massimo sette giorni.
router.post('/workouts/health-json', uploadJson.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File JSON mancante' });
  let body;
  try { body = JSON.parse(req.file.buffer.toString('utf8')); }
  catch { return res.status(400).json({ error: 'Il file non e\u2019 un JSON valido' }); }
  // Il file si carica dalla pagina di un atleta e finisce nel suo archivio:
  // chi amministra puo' quindi caricare lo storico anche per gli altri
  let destinatario = req.user.id;
  if (req.body?.user_id && +req.body.user_id !== req.user.id) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo amministratore' });
    const u = (await q('SELECT id FROM users WHERE id=$1', [req.body.user_id])).rows[0];
    if (!u) return res.status(404).json({ error: 'Utente non trovato' });
    destinatario = u.id;
  }
  // Un'esportazione puo' contenere gli allenamenti, le pesate o tutti e due:
  // si prende quello che c'e' e si rifiuta solo il file che non porta nulla
  const items = itemsDaPacchetto(body, `file ${req.file.originalname}`);
  const pesi = pesiDaPacchetto(body);
  if (!items.length && !pesi.length) {
    return res.status(400).json({ error: `Nel file non ci sono ne\u2019 allenamenti ne\u2019 pesate (forma: ${formaPacchetto(body)}). Esporta il tipo di dato "Allenamenti" per le attivita\u2019 e "weight_body_mass" fra le metriche per il peso.` });
  }
  const r = await archivia(destinatario, items);
  const pesate = await archiviaPesi(destinatario, pesi);
  const letture = lettureDaPacchetto(body);
  await archiviaLetture(destinatario, letture);
  const recuperati = await recuperaDaLetture(destinatario);
  // Letture e giornate non coincidono: piu' pesate nello stesso giorno valgono
  // per una sola. Il periodo coperto dice subito se il file conteneva davvero
  // tutto l'arco di tempo che ci si aspettava.
  const giorni = pesi.map(x => x.measured_at.toISOString().slice(0, 10)).sort();
  const periodoPesi = giorni.length ? { dal: giorni[0], al: giorni[giorni.length - 1] } : null;
  console.log(`importazione file: elementi=${items.length} salvati=${r.saved} uniti=${r.merged} scartati=${r.scartati}`
    + ` letture-peso=${pesi.length} pesate=${pesate}${periodoPesi ? ` (dal ${periodoPesi.dal} al ${periodoPesi.al})` : ''} utente=${destinatario}`);
  const metriche = nomiMetriche(body);
  if (metriche.length && !pesi.length) {
    console.log(`importazione file: nessun peso fra le metriche -> ${metriche.join(' ').slice(0, 400)}`);
  }
  if (r.saved) await rimuoviDoppioniAutomatici(destinatario).catch(e => console.warn('pulizia doppioni fallita:', e.message));
  res.json({ ok: true, letti: items.length, pesate, letture_peso: pesi.length, periodo_pesi: periodoPesi, letture: letture.length, recuperati, ...r });
}));

// Upload GPX manuale
router.post('/workouts/gpx', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File GPX mancante' });
  const w = parseGpx(req.file.buffer.toString('utf8'));
  w.source = 'gpx'; w.external_id = `${req.file.originalname}-${w.started_at.toISOString()}`;
  const saved = await saveWorkout(req.user.id, w, req.body.trip_id ? +req.body.trip_id : null, { forzato: true });
  res.json(saved);
}));

// ---------- Komoot ----------
router.get('/komoot', wrap(async (req, res) => {
  const r = (await q(`SELECT external_user_id, last_sync_at FROM integrations WHERE user_id=$1 AND provider='komoot'`, [req.user.id])).rows[0];
  res.json({ connected: !!r, ...(r || {}) });
}));
router.post('/komoot/connect', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email e password Komoot obbligatorie' });
  let login;
  try { login = await komoot.login(email, password); }
  catch (e) { return res.status(400).json({ error: 'Login Komoot fallito: ' + (e.status === 401 || e.status === 403 ? 'credenziali errate' : e.message) }); }
  await q(`INSERT INTO integrations(user_id,provider,external_user_id,secret_enc) VALUES($1,'komoot',$2,$3)
           ON CONFLICT (user_id,provider) DO UPDATE SET external_user_id=$2, secret_enc=$3`, [req.user.id, login.userId, encrypt(login.token)]);
  res.json({ connected: true, external_user_id: login.userId, displayName: login.displayName });
}));
router.delete('/komoot', wrap(async (req, res) => { await q(`DELETE FROM integrations WHERE user_id=$1 AND provider='komoot'`, [req.user.id]); res.json({ ok: true }); }));

// Il token e' cifrato con una chiave derivata da SESSION_SECRET: se l'app viene
// spostata su un'installazione con un segreto diverso, il token non e' piu'
// leggibile e l'unica via e' rifare il collegamento.
function leggiSegreto(r, servizio) {
  try { return decrypt(r.secret_enc); }
  catch { throw new Error(`collegamento ${servizio} non piu' leggibile su questa installazione: scollega e ricollega ${servizio}`); }
}

export async function syncKomootFor(userId, { full = false } = {}) {
  const r = (await q(`SELECT * FROM integrations WHERE user_id=$1 AND provider='komoot'`, [userId])).rows[0];
  if (!r) return { skipped: true };
  const token = leggiSegreto(r, 'Komoot');
  const since = full ? null : (r.last_sync_at ? new Date(new Date(r.last_sync_at).getTime() - 86400000 * 2) : null);
  const tours = await komoot.listTours(r.external_user_id, token, { limit: full ? 200 : 30, since });
  let n = 0;
  for (const t of tours) {
    const exists = (await q(`SELECT id FROM workouts WHERE user_id=$1 AND source='komoot' AND external_id=$2 AND track IS NOT NULL`, [userId, String(t.id)])).rows[0];
    if (exists && !full) continue;
    if (await saveWorkout(userId, await komoot.tourToWorkout(r.external_user_id, token, t))) n++;   // null: cancellato a mano
  }
  await q('UPDATE integrations SET last_sync_at=now() WHERE id=$1', [r.id]);
  if (n) await rimuoviDoppioniAutomatici(userId).catch(e => console.warn('pulizia doppioni fallita:', e.message));
  // Komoot porta il tracciato ma non il battito: se le letture di quelle ore
  // sono gia' arrivate dal telefono, il giro le trova qui ad aspettarlo
  if (n) await recuperaDaLetture(userId).catch(e => console.warn('recupero battiti fallito:', e.message));
  return { imported: n, checked: tours.length };
}
router.post('/komoot/sync', wrap(async (req, res) => {
  try { res.json(await syncKomootFor(req.user.id, { full: req.body?.full === true })); }
  catch (e) {
    // Senza questa riga la causa resta solo nel messaggio a schermo e i log non aiutano
    console.warn(`Komoot sync a richiesta fallito, utente ${req.user.id}: ${e.message}`);
    res.status(502).json({ error: 'Sincronizzazione Komoot fallita: ' + e.message });
  }
}));

// Sync periodico per tutti gli utenti collegati (chiamato dal server ogni 6 ore)
// ---------- Strava ----------
// Dietro il proxy di Railway l'intestazione Host puo' contenere il nome interno del
// contenitore: l'indirizzo pubblico sta in x-forwarded-host, che va preferito.
// Con un dominio sbagliato Strava rifiuta l'autorizzazione con redirect_uri invalid.
const redirectStrava = req => {
  const host = req.get('x-forwarded-host') || req.get('host');
  const schema = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${schema}://${host}/api/strava/callback`;
};

router.get('/strava', wrap(async (req, res) => {
  const r = (await q(`SELECT external_user_id, last_sync_at FROM integrations WHERE user_id=$1 AND provider='strava'`, [req.user.id])).rows[0];
  res.json({ connected: !!r, configurato: strava.configurato(), ...(r || {}) });
}));

// Porta l'utente su Strava; lo stato casuale evita che la risposta venga contraffatta
router.get('/strava/connect', wrap(async (req, res) => {
  if (!strava.configurato()) return res.status(400).json({ error: 'Strava non e\u2019 configurato: mancano STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET' });
  const stato = crypto.randomBytes(16).toString('hex');
  req.session.stravaStato = stato;
  const ritorno = redirectStrava(req);
  // Il dominio di questo indirizzo deve coincidere con quello registrato su Strava
  console.log(`strava: indirizzo di ritorno proposto = ${ritorno}`);
  res.redirect(strava.urlAutorizzazione(ritorno, stato));
}));

router.get('/strava/callback', wrap(async (req, res) => {
  const { code, state, error } = req.query;
  const esito = m => res.redirect('/#/impostazioni?strava=' + encodeURIComponent(m));
  if (error) return esito('negato');
  if (!code || !state || state !== req.session.stravaStato) return esito('stato-non-valido');
  req.session.stravaStato = null;
  try {
    const t = await strava.scambiaCodice(String(code));
    await q(`INSERT INTO integrations(user_id,provider,external_user_id,secret_enc) VALUES($1,'strava',$2,$3)
             ON CONFLICT (user_id,provider) DO UPDATE SET external_user_id=$2, secret_enc=$3`,
      [req.user.id, String(t.atleta?.id || ''), encrypt(JSON.stringify(t))]);
    syncStravaFor(req.user.id, { full: true }).catch(e => console.warn('primo scarico Strava fallito:', e.message));
    return esito('collegato');
  } catch (e) { console.warn('collegamento Strava fallito:', e.message); return esito('errore'); }
}));

router.delete('/strava', wrap(async (req, res) => {
  await q(`DELETE FROM integrations WHERE user_id=$1 AND provider='strava'`, [req.user.id]);
  res.json({ ok: true });
}));

// Strava concede 100 chiamate ogni quarto d'ora: le calorie stanno solo sul dettaglio,
// quindi ne chiediamo al massimo 40 per giro e le restanti arrivano alla sincronizzazione dopo
const MAX_DETTAGLI = 40;

export async function syncStravaFor(userId, { full = false } = {}) {
  const r = (await q(`SELECT * FROM integrations WHERE user_id=$1 AND provider='strava'`, [userId])).rows[0];
  if (!r) return { skipped: true };
  const { tok, rinnovato } = await strava.tokenValido(JSON.parse(leggiSegreto(r, 'Strava')));
  if (rinnovato) await q('UPDATE integrations SET secret_enc=$2 WHERE id=$1', [r.id, encrypt(JSON.stringify(tok))]);
  const dopo = full ? null : (r.last_sync_at ? new Date(new Date(r.last_sync_at).getTime() - 2 * 86400000) : null);
  const attivita = await strava.listaAttivita(tok.access_token, { dopo });
  let n = 0, dettagliChiesti = 0;
  for (const a of attivita) {
    const gia = (await q(`SELECT id FROM workouts WHERE user_id=$1 AND source='strava' AND external_id=$2`, [userId, String(a.id)])).rows[0];
    if (gia && !full) continue;
    let dettaglio = null;
    if (dettagliChiesti < MAX_DETTAGLI) {
      dettagliChiesti++;
      try { dettaglio = await strava.dettaglioAttivita(tok.access_token, a.id); } catch { /* restano i dati di riepilogo */ }
    }
    if (await saveWorkout(userId, strava.attivitaToWorkout(a, dettaglio))) n++;   // null: cancellato a mano
  }
  await q('UPDATE integrations SET last_sync_at=now() WHERE id=$1', [r.id]);
  if (n) await rimuoviDoppioniAutomatici(userId).catch(e => console.warn('pulizia doppioni fallita:', e.message));
  return { imported: n, checked: attivita.length };
}

router.post('/strava/sync', wrap(async (req, res) => {
  try { res.json(await syncStravaFor(req.user.id, { full: req.body?.full === true })); }
  catch (e) {
    console.warn(`Strava sync a richiesta fallito, utente ${req.user.id}: ${e.message}`);
    res.status(502).json({ error: 'Sincronizzazione Strava fallita: ' + e.message });
  }
}));

// Sincronizzazione periodica per tutti gli utenti collegati
export async function syncAllStrava() {
  for (const r of (await q(`SELECT user_id FROM integrations WHERE provider='strava'`)).rows) {
    try { await syncStravaFor(r.user_id); } catch (e) { console.warn('Strava sync utente', r.user_id, e.message); }
  }
}

export async function syncAllKomoot() {
  for (const r of (await q(`SELECT user_id FROM integrations WHERE provider='komoot'`)).rows) {
    try { await syncKomootFor(r.user_id); } catch (e) { console.warn('Komoot sync utente', r.user_id, e.message); }
  }
}
