// Percorsi presi da Google Maps: si incolla il collegamento e se ne cavano i
// punti. Google li scrive in tre modi diversi, e nessuno dei tre e' un'API:
//   .../maps/dir/Susegana/Caorle/Ravenna/@45.6,12.5,9z/data=...
//   .../maps/dir/?api=1&origin=Susegana&destination=Ravenna&waypoints=Caorle|Jesolo
//   https://maps.app.goo.gl/xxxx  (un rimando ai primi due)
// Qui si estraggono solo i nomi e le coordinate: niente chiavi, niente servizi.

import { haversineKm } from './util.js';

// Dopo la @, nel collegamento, Google scrive dov'era centrata la mappa quando
// si e' premuto «condividi». Non e' il posto, ma gli sta vicino: e' quello che
// permette di scegliere fra i tre «Bolzano» che il geocoder propone, invece di
// prendere sempre il primo e piantarne uno venti chilometri in la'.
export function centroDelLink(url) {
  const m = String(url || '').match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:,|\/|$)/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const COORDINATA = /^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/;

const pulisci = s => {
  let t = String(s || '').replace(/\+/g, ' ');
  try { t = decodeURIComponent(t); } catch { }
  return t.trim();
};

// Un punto e' un nome da cercare oppure una coppia di coordinate gia' pronta
function comePunto(pezzo) {
  const t = pulisci(pezzo);
  if (!t || t === 'My+Location' || /^(la mia posizione|my location|your location)$/i.test(t)) return null;
  const c = t.match(COORDINATA);
  if (c) {
    const lat = +c[1], lon = +c[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { name: `${lat}, ${lon}`, lat, lon };
  }
  return { name: t };
}

export function puntiDaLinkMaps(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return []; }
  if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && !/goo\.gl$/i.test(u.hostname)) return [];

  // Forma con i parametri: e' quella che generiamo anche noi
  const origin = u.searchParams.get('origin'), destination = u.searchParams.get('destination');
  if (origin || destination) {
    const mezzo = (u.searchParams.get('waypoints') || '').split(/\||%7C/).filter(Boolean);
    return [origin, ...mezzo, destination].map(comePunto).filter(Boolean);
  }

  // Forma con il percorso: /maps/dir/A/B/C/@... — i pezzi dopo «dir» sono i punti,
  // e si smette al primo che parla di mappa (@zoom, data=, am=t) e non di luoghi
  const pezzi = u.pathname.split('/').filter(Boolean);
  const i = pezzi.findIndex(p => p === 'dir');
  if (i < 0) return [];
  const punti = [];
  for (const p of pezzi.slice(i + 1)) {
    if (p.startsWith('@') || p.startsWith('data=') || p.startsWith('am=') || p === 'preview') break;
    const q = comePunto(p);
    if (q) punti.push(q);
  }
  return punti;
}

// I collegamenti brevi non dicono niente da soli: bisogna seguirli. Si guarda
// solo dove portano, senza leggere la pagina.
export async function seguiLinkBreve(url) {
  const u = String(url).trim();
  if (!/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(u)) return u;
  const r = await fetch(u, {
    redirect: 'follow',
    headers: { 'User-Agent': 'CamperDashboard/1.0 (+percorsi da Google Maps)', 'Accept-Language': 'it' },
    signal: AbortSignal.timeout(12000),
  });
  return r.url || u;
}

// Nei suoi collegamenti Google scrive i nomi, non le coordinate: «Susegana»,
// non «45.85, 12.24». Un nome pero' non e' un punto, e una strada senza punti
// non si puo' contare - ne' i chilometri, ne' le ore, ne' il gasolio. Qui si
// colma la differenza, e chi cerca lo passa chi chiama: questo file non
// telefona a nessuno da solo.
//
// Quello che non si trova si dice. Mettere in mappa il paese sbagliato perche'
// suonava simile e' peggio che ammettere di non averlo trovato.
export async function completaPunti(punti, cerca, vicinoA = null) {
  const fuori = [], mancanti = [];
  const buone = p => Number.isFinite(+p?.lat) && Number.isFinite(+p?.lon);
  // Fra i posti che portano lo stesso nome vince quello piu' vicino a dove
  // stava la mappa; senza un centro da cui giudicare si prende il primo.
  const scegli = candidati => {
    const buoni = (candidati || []).filter(buone);
    if (!buoni.length || !buone(vicinoA)) return buoni[0] || null;
    return buoni.reduce((a, b) => haversineKm([+b.lat, +b.lon], [vicinoA.lat, vicinoA.lon])
      < haversineKm([+a.lat, +a.lon], [vicinoA.lat, vicinoA.lon]) ? b : a);
  };
  for (const p of punti || []) {
    if (buone(p)) { fuori.push({ ...p, lat: +p.lat, lon: +p.lon }); continue; }
    const nome = String(p?.name || '').trim();
    if (!nome) continue;
    let trovato = null;
    try { trovato = scegli(await cerca(nome)); } catch { /* geocoder muto: il punto resta senza posto */ }
    if (buone(trovato)) fuori.push({ name: nome, lat: +trovato.lat, lon: +trovato.lon });
    else mancanti.push(nome);
  }
  return { punti: fuori, mancanti };
}
