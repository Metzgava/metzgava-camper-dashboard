// Client Komoot NON ufficiale (Komoot non pubblica un'API).
// Usa le stesse chiamate del sito web: login una volta -> si conserva solo il token (cifrato), mai la password.
// Può smettere di funzionare se Komoot cambia qualcosa: in tal caso resta il caricamento GPX manuale.
import { fetchJson } from './util.js';
import { parseGpx } from './gpx.js';

const API = 'https://api.komoot.de';
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

// Ritorna { userId, token, displayName }
export async function login(email, password) {
  const data = await fetchJson(`${API}/v006/account/email/${encodeURIComponent(email)}/`, {
    headers: { Authorization: basic(email, password), Accept: 'application/json' },
  });
  const userId = data.username || data.user?.username;
  const token = data.password || data.token;
  if (!userId || !token) throw new Error('Risposta Komoot inattesa');
  return { userId: String(userId), token, displayName: data.user?.displayname || data.displayname || null };
}

export async function listTours(userId, token, { limit = 50, since } = {}) {
  const url = `${API}/v007/users/${userId}/tours/?type=tour_recorded&sort_field=date&sort_direction=desc&limit=${limit}`;
  const data = await fetchJson(url, { headers: { Authorization: basic(userId, token), Accept: 'application/hal+json,application/json' } });
  let tours = data._embedded?.tours || data.items || [];
  if (since) tours = tours.filter(t => new Date(t.date) > since);
  return tours;
}

export async function tourGpx(userId, token, tourId) {
  const res = await fetch(`${API}/v007/tours/${tourId}.gpx`, { headers: { Authorization: basic(userId, token), 'User-Agent': 'camper-dashboard/1.0' } });
  if (!res.ok) throw new Error(`GPX Komoot HTTP ${res.status}`);
  return res.text();
}

// Converte un tour Komoot (con GPX opzionale) nel formato workout della dashboard
export async function tourToWorkout(userId, token, tour) {
  let parsed = null;
  try { parsed = parseGpx(await tourGpx(userId, token, tour.id)); } catch { /* traccia non disponibile */ }
  return {
    source: 'komoot',
    external_id: String(tour.id),
    sport: tour.sport || parsed?.sport || null,
    name: tour.name || parsed?.name,
    started_at: new Date(tour.date),
    duration_s: tour.time_in_motion || tour.duration || parsed?.duration_s || null,
    distance_m: Math.round(tour.distance || parsed?.distance_m || 0),
    elevation_up_m: Math.round(tour.elevation_up ?? parsed?.elevation_up_m ?? 0),
    calories: parsed?.calories || null,
    hr_avg: parsed?.hr_avg || null,
    hr_max: parsed?.hr_max || null,
    speed_avg_kmh: tour.time_in_motion ? +((tour.distance / 1000) / (tour.time_in_motion / 3600)).toFixed(2) : parsed?.speed_avg_kmh || null,
    track: parsed?.track || null,
    meta: { map_image: tour.map_image?.src || null, komoot_url: `https://www.komoot.com/tour/${tour.id}` },
  };
}
