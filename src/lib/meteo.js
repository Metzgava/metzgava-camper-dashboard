// Il tempo che faceva quel giorno, in quel posto.
//
// Open-Meteo lo regala senza chiave: l'archivio per i giorni passati, le
// previsioni - che tengono anche tre mesi all'indietro - per quelli recenti,
// perche' l'archivio arriva con qualche giorno di ritardo. Ogni risposta si
// tiene da parte: lo stesso giorno nello stesso posto non si chiede due volte,
// e rivedere dieci volte lo stesso viaggio non diventa diecimila richieste a
// un servizio che non ci chiede niente.
import { q } from './db.js';

// I codici del tempo come li scrive l'Organizzazione meteorologica mondiale.
// Si raggruppano: dentro a un filmato serve sapere se c'era il sole o
// pioveva, non distinguere la pioggia debole dalla moderata.
const CODICI = [
  [[0], '☀️', 'sereno'],
  [[1], '🌤️', 'quasi sereno'],
  [[2], '⛅', 'poco nuvoloso'],
  [[3], '☁️', 'coperto'],
  [[45, 48], '🌫️', 'nebbia'],
  [[51, 53, 55, 56, 57], '🌦️', 'pioviggine'],
  [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'pioggia'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'neve'],
  [[95, 96, 99], '⛈️', 'temporale'],
];
export const facciaMeteo = codice => CODICI.find(([c]) => c.includes(codice)) || ['', '🌡️', ''];

const giornoValido = g => /^\d{4}-\d{2}-\d{2}$/.test(String(g || '')) ? String(g) : null;
const arrotonda = v => Math.round(Number(v) * 100) / 100;

export async function meteoDelGiorno(lat, lon, giorno) {
  const g = giornoValido(giorno);
  if (!g || !Number.isFinite(+lat) || !Number.isFinite(+lon)) return null;
  const la = arrotonda(lat), lo = arrotonda(lon);          // un centesimo di grado: circa un chilometro
  const gia = (await q('SELECT codice, tmin, tmax FROM meteo WHERE lat=$1 AND lon=$2 AND giorno=$3', [la, lo, g])).rows[0];
  if (gia) return vestito(gia);

  // L'archivio e' completo ma in ritardo di qualche giorno; le previsioni
  // coprono all'indietro tre mesi. Si sceglie in base a quanto e' lontano.
  const vecchio = (Date.now() - Date.parse(g + 'T12:00:00Z')) > 80 * 864e5;
  const base = vecchio ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${la}&longitude=${lo}&start_date=${g}&end_date=${g}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto';
  let d = null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'camper-dashboard/1.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    d = await r.json();
  } catch (e) {
    console.warn('meteo non disponibile:', String(e.message).slice(0, 120));
    return null;
  }
  const codice = d?.daily?.weather_code?.[0];
  const tmax = d?.daily?.temperature_2m_max?.[0];
  const tmin = d?.daily?.temperature_2m_min?.[0];
  if (codice == null && tmax == null) return null;
  const riga = { codice: codice ?? null, tmin: tmin ?? null, tmax: tmax ?? null };
  await q(`INSERT INTO meteo(lat, lon, giorno, codice, tmin, tmax) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (lat, lon, giorno) DO UPDATE SET codice=EXCLUDED.codice, tmin=EXCLUDED.tmin, tmax=EXCLUDED.tmax, preso_at=now()`,
    [la, lo, g, riga.codice, riga.tmin, riga.tmax]).catch(() => {});
  return vestito(riga);
}

const vestito = r => {
  const [, faccia, nome] = facciaMeteo(r.codice);
  return {
    codice: r.codice, nome,
    faccia,
    tmin: r.tmin != null ? Math.round(r.tmin) : null,
    tmax: r.tmax != null ? Math.round(r.tmax) : null,
  };
};
