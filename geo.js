// Servizi geografici gratuiti basati su OpenStreetMap
import { fetchJson, haversineKm, samplePoints } from './util.js';

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const PHOTON = process.env.PHOTON_URL || 'https://photon.komoot.io';

// Ricerca luoghi (autocomplete)
export async function geocode(query, lang = 'it') {
  const url = `${PHOTON}/api/?q=${encodeURIComponent(query)}&limit=6&lang=${lang}&lat=45.9&lon=12.3`;
  const data = await fetchJson(url);
  return (data.features || []).map(f => {
    const p = f.properties;
    const parts = [p.name, p.city || p.town || p.village, p.state, p.country].filter(Boolean);
    return { name: [...new Set(parts)].join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], type: p.osm_value };
  });
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
