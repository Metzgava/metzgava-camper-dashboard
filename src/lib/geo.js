// Servizi geografici gratuiti basati su OpenStreetMap
import { fetchJson, haversineKm, samplePoints } from './util.js';

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const PHOTON = process.env.PHOTON_URL || 'https://photon.komoot.io';

const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const UA = 'camper-dashboard/1.0 (uso personale; contatto: admin@camper-dashboard.local)';
let lastNominatim = 0;

// Ricerca luoghi (autocomplete): Photon, con Nominatim come riserva
export async function geocode(query, lang = 'it') {
  let photonErr;
  try {
    const url = `${PHOTON}/api/?q=${encodeURIComponent(query)}&limit=6&lang=${lang}&lat=45.9&lon=12.3`;
    const data = await fetchJson(url, { headers: { 'User-Agent': UA } }, 10000);
    const res = (data.features || []).map(f => {
      const p = f.properties;
      const parts = [p.name, p.city || p.town || p.village, p.state, p.country].filter(Boolean);
      return { name: [...new Set(parts)].join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], type: p.osm_value };
    });
    if (res.length) return res;
  } catch (e) { photonErr = e; }
  // Nominatim: max 1 richiesta al secondo
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatim = Date.now();
  try {
    const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&accept-language=${lang}&countrycodes=it,fr,at,si,hr,ch,de,es`;
    const data = await fetchJson(url, { headers: { 'User-Agent': UA } }, 10000);
    return (Array.isArray(data) ? data : []).map(r => ({ name: r.display_name.split(',').slice(0, 3).join(','), lat: +r.lat, lon: +r.lon, type: r.type }));
  } catch (e) {
    if (photonErr) throw Object.assign(new Error(`geocoder non disponibile (Photon: ${photonErr.message}; Nominatim: ${e.message})`), { status: 502 });
    throw e;
  }
}

// Percorso stradale tra due punti. Restituisce km, minuti e geometria [[lat,lon],...]
export async function route(from, to) {
  const url = `${OSRM}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`;
  try {
    const data = await fetchJson(url, {}, 20000);
    const r = data.routes?.[0];
    if (!r) throw new Error('nessun percorso');
    const coords = r.geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)]);
    return {
      distance_km: +(r.distance / 1000).toFixed(1),
      duration_min: Math.round(r.duration / 60 * 1.15), // camper: ~15% più lento dell'auto
      geometry: samplePoints(coords, 600),
      source: 'osrm',
    };
  } catch (e) {
    // Fallback: distanza in linea d'aria * 1.3 (stima stradale)
    const air = haversineKm([from.lat, from.lon], [to.lat, to.lon]);
    return { distance_km: +(air * 1.3).toFixed(1), duration_min: Math.round(air * 1.3 / 65 * 60), geometry: [[from.lat, from.lon], [to.lat, to.lon]], source: 'stima', warning: 'Routing non disponibile: distanza stimata' };
  }
}

// ---------- varianti di percorso ----------
// OSRM sa dare solo la strada piu' veloce. Per avere anche quella che evita i
// pedaggi serve OpenRouteService: gratuito, stessi dati OpenStreetMap, ma vuole
// una chiave. Senza chiave tutto continua a funzionare con la sola variante
// rapida, e chi guarda lo vede scritto invece di credere a un dato che non c'e'.
const ORS = process.env.ORS_URL || 'https://api.openrouteservice.org';
// Il nome della variabile si scrive volentieri in minuscolo, e su Linux le
// maiuscole contano: si accettano tutte le forme invece di far cercare l'errore
const CHIAVE_ORS = (Object.entries(process.env)
  .find(([k]) => k.toLowerCase() === 'ors_api_key')?.[1] || '').trim();
export const sannoEvitareIPedaggi = () => !!CHIAVE_ORS;
let avvisatoOrs = false;

async function percorsoOrs(from, to, evitare = []) {
  const corpo = {
    coordinates: [[from.lon, from.lat], [to.lon, to.lat]],
    units: 'km',
    ...(evitare.length ? { options: { avoid_features: evitare } } : {}),
  };
  const data = await fetchJson(`${ORS}/v2/directions/driving-car/geojson`, {
    method: 'POST',
    headers: { Authorization: CHIAVE_ORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  }, 25000);
  const f = data.features?.[0];
  if (!f) throw new Error('nessun percorso');
  const s = f.properties.summary || {};
  if (!s.distance) throw new Error('percorso senza distanza');
  return {
    distance_km: +s.distance.toFixed(1),
    duration_min: Math.round(s.duration / 60 * 1.15),   // il camper va piu' piano
    geometry: samplePoints(f.geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)]), 600),
    source: 'openrouteservice',
  };
}

// Le varianti di un singolo tratto. Quella senza pedaggi compare solo se esiste
// davvero ed e' diversa dalla rapida: proporre due volte la stessa strada
// sarebbe una scelta finta.
export async function variantiTratto(from, to) {
  const fuori = [];
  const rapido = CHIAVE_ORS
    ? await percorsoOrs(from, to).catch(() => route(from, to))
    : await route(from, to);
  fuori.push({ chiave: 'rapido', nome: 'Il piu\u2019 rapido', ...rapido });
  if (CHIAVE_ORS) {
    try {
      const senza = await percorsoOrs(from, to, ['tollways']);
      avvisatoOrs = false;
      const differisce = Math.abs(senza.distance_km - rapido.distance_km) > 0.5
        || Math.abs(senza.duration_min - rapido.duration_min) > 3;
      if (differisce) fuori.push({ chiave: 'senza_pedaggi', nome: 'Senza pedaggi', evita_pedaggi: true, ...senza });
    } catch (e) {
      // Un rifiuto sistematico di solito e' la chiave: dirlo una volta sola,
      // perche' a ogni tratto di ogni viaggio riempirebbe il registro
      if (!avvisatoOrs) { avvisatoOrs = true; console.warn('percorsi: OpenRouteService non ha dato la variante senza pedaggi:', String(e.message).slice(0, 160)); }
    }
  }
  return fuori;
}

// Il percorso completo di un viaggio: partenza, soste intermedie, arrivo. Ogni
// variante porta con se' le tratte gia' pronte da salvare come tappe.
export async function percorsiConTappe(punti) {
  const tratte = [];
  for (let i = 0; i + 1 < punti.length; i++) tratte.push(await variantiTratto(punti[i], punti[i + 1]));
  const chiavi = ['rapido', ...(tratte.every(t => t.some(v => v.chiave === 'senza_pedaggi')) ? ['senza_pedaggi'] : [])];
  return chiavi.map(chiave => {
    const scelte = tratte.map((t, i) => ({
      ...(t.find(v => v.chiave === chiave) || t[0]),
      from: punti[i], to: punti[i + 1],
    }));
    return {
      chiave,
      nome: chiave === 'rapido' ? 'Il piu\u2019 rapido' : 'Senza pedaggi',
      evita_pedaggi: chiave === 'senza_pedaggi',
      distance_km: +scelte.reduce((a, t) => a + t.distance_km, 0).toFixed(1),
      duration_min: scelte.reduce((a, t) => a + t.duration_min, 0),
      stimato: scelte.some(t => t.source === 'stima'),
      tratte: scelte,
    };
  });
}

// POI lungo il percorso: aree sosta camper, campeggi e borghi/paesi attraversati
export async function poisAlongRoute(geometry, radiusM = 4000) {
  if (!geometry || geometry.length < 2) return { stops: [], villages: [] };
  // Un corridoio di pochi punti per limitare il carico su Overpass
  const pts = samplePoints(geometry, 25);
  const around = pts.map(([lat, lon]) => `${lat},${lon}`).join(',');
  const query = `[out:json][timeout:25];
(
  nwr["tourism"="caravan_site"](around:${radiusM},${around});
  nwr["tourism"="camp_site"]["caravans"!="no"](around:${radiusM},${around});
  nwr["amenity"="sanitary_dump_station"](around:${radiusM},${around});
  node["place"~"^(town|village)$"](around:${Math.max(radiusM, 5000)},${around});
);
out center tags 120;`;
  let data;
  try {
    data = await fetchJson(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 40000);
  } catch (e) {
    return { stops: [], villages: [], warning: 'Servizio POI momentaneamente non disponibile' };
  }
  const stops = [], villages = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    if (t.place) {
      // Borghi: considera "caratteristico" se ha tag storici/turistici o popolazione piccola
      const pop = Number(t.population) || null;
      villages.push({ name: t.name || 'Paese', lat, lon, place: t.place, population: pop,
        historic: !!(t.historic || t['heritage'] || t['wikipedia']), wikipedia: t.wikipedia || null });
    } else {
      const kind = t.tourism === 'caravan_site' ? 'area_sosta' : t.amenity ? 'camper_service' : 'campeggio';
      stops.push({ name: t.name || (kind === 'area_sosta' ? 'Area sosta camper' : kind === 'campeggio' ? 'Campeggio' : 'Camper service'),
        kind, lat, lon, fee: t.fee || null, website: t.website || t['contact:website'] || null, phone: t.phone || null,
        opening_hours: t.opening_hours || null, capacity: t.capacity || null, power: t.power_supply || null, drinking_water: t.drinking_water || null });
    }
  }
  // Ordina i borghi: prima i piccoli con presenza su Wikipedia (più probabilmente "caratteristici"), max 20
  villages.sort((a, b) => (b.historic - a.historic) || ((a.population || 1e9) - (b.population || 1e9)));
  const seen = new Set();
  const uniq = arr => arr.filter(v => !seen.has(v.name) && seen.add(v.name));
  return { stops: uniq(stops).slice(0, 40), villages: uniq(villages).slice(0, 20) };
}
