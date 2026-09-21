// Client Strava (API ufficiale, OAuth 2.0).
// Si conservano solo i token, cifrati: l'accesso dura sei ore e viene rinnovato da solo
// con il refresh token, quindi il collegamento resta valido senza doverlo rifare.
import { fetchJson } from './util.js';

const AUTH = 'https://www.strava.com/oauth/authorize';
const TOKEN = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';

export const clientId = () => process.env.STRAVA_CLIENT_ID || '';
export const clientSecret = () => process.env.STRAVA_CLIENT_SECRET || '';
export const configurato = () => !!(clientId() && clientSecret());

// L'indirizzo a cui Strava rimanda dopo l'autorizzazione: deve stare sullo stesso
// dominio dichiarato nell'applicazione Strava
export function urlAutorizzazione(redirectUri, stato) {
  const p = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: 'activity:read_all',
    state: stato,
  });
  return `${AUTH}?${p}`;
}

async function postToken(corpo) {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId(), client_secret: clientSecret(), ...corpo }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Strava HTTP ${r.status}`);
  return data;
}

// Scambia il codice usa e getta con la coppia di token
export async function scambiaCodice(code) {
  const d = await postToken({ code, grant_type: 'authorization_code' });
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at,
    atleta: d.athlete ? { id: d.athlete.id, nome: [d.athlete.firstname, d.athlete.lastname].filter(Boolean).join(' ') } : null,
  };
}

// Rinnova l'accesso quando manca meno di un minuto alla scadenza
export async function tokenValido(tok) {
  if (tok.access_token && tok.expires_at && tok.expires_at * 1000 > Date.now() + 60_000) return { tok, rinnovato: false };
  const d = await postToken({ refresh_token: tok.refresh_token, grant_type: 'refresh_token' });
  return { tok: { ...tok, access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at }, rinnovato: true };
}

export async function listaAttivita(accessToken, { dopo, perPagina = 100 } = {}) {
  const p = new URLSearchParams({ per_page: String(perPagina) });
  if (dopo) p.set('after', String(Math.floor(new Date(dopo).getTime() / 1000)));
  return fetchJson(`${API}/athlete/activities?${p}`, { headers: { Authorization: `Bearer ${accessToken}` } });
}

// Le calorie stanno solo sul dettaglio della singola attività
export async function dettaglioAttivita(accessToken, id) {
  return fetchJson(`${API}/activities/${id}?include_all_efforts=false`, { headers: { Authorization: `Bearer ${accessToken}` } });
}

// Decodifica la polilinea compressa di Strava (algoritmo Google, precisione 5)
export function decodificaPolilinea(str) {
  if (!str) return null;
  const punti = [];
  let indice = 0, lat = 0, lon = 0;
  while (indice < str.length) {
    for (const asse of ['lat', 'lon']) {
      let risultato = 0, turno = 0, byte;
      do {
        byte = str.charCodeAt(indice++) - 63;
        risultato |= (byte & 0x1f) << turno;
        turno += 5;
      } while (byte >= 0x20);
      const delta = (risultato & 1) ? ~(risultato >> 1) : (risultato >> 1);
      if (asse === 'lat') lat += delta; else lon += delta;
    }
    punti.push([+(lat / 1e5).toFixed(5), +(lon / 1e5).toFixed(5)]);
  }
  return punti.length ? punti : null;
}

// Converte un'attività Strava nel formato workout della dashboard
export function attivitaToWorkout(a, dettaglio = null) {
  const d = dettaglio || a;
  return {
    source: 'strava',
    external_id: String(a.id),
    sport: a.sport_type || a.type || null,
    name: a.name || null,
    started_at: new Date(a.start_date),
    duration_s: a.moving_time || a.elapsed_time || null,
    distance_m: a.distance != null ? Math.round(a.distance) : null,
    elevation_up_m: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
    calories: d.calories != null ? Math.round(d.calories) : null,
    hr_avg: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
    hr_max: a.max_heartrate != null ? Math.round(a.max_heartrate) : null,
    speed_avg_kmh: a.average_speed != null ? +(a.average_speed * 3.6).toFixed(2) : null,
    track: decodificaPolilinea(a.map?.summary_polyline || d.map?.polyline || null),
    meta: { strava_url: `https://www.strava.com/activities/${a.id}`, tipo: a.sport_type || a.type || null },
  };
}
