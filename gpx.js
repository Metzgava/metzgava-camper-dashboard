// Parser GPX minimale (senza dipendenze): punti, tempi, quota, battito, calorie
import { haversineKm, samplePoints } from './util.js';

const attr = (tag, name) => { const m = tag.match(new RegExp(`${name}="([^"]*)"`)); return m ? m[1] : null; };
const inner = (xml, name) => { const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([^<]*)<`)); return m ? m[1].trim() : null; };

export function parseGpx(xml) {
  const name = inner(xml.match(/<trk[\s>][\s\S]*?<\/trk>/)?.[0] || xml, 'name') || inner(xml, 'name') || 'Traccia GPX';
  const type = inner(xml, 'type');
  const pts = [];
  const re = /<trkpt\s+([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\s+([^>]*)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1] || m[3] || '', body = m[2] || '';
    const lat = +attr(a, 'lat'), lon = +attr(a, 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = inner(body, 'ele'); const time = inner(body, 'time');
    const hr = inner(body, 'hr'); const cad = inner(body, 'cad');
    pts.push({ lat, lon, ele: ele != null ? +ele : null, t: time ? Date.parse(time) : null, hr: hr != null ? +hr : null, cad: cad != null ? +cad : null });
  }
  if (!pts.length) throw new Error('GPX senza punti traccia');
  let dist = 0, up = 0, hrSum = 0, hrN = 0, hrMax = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) {
      dist += haversineKm([pts[i - 1].lat, pts[i - 1].lon], [pts[i].lat, pts[i].lon]);
      if (pts[i].ele != null && pts[i - 1].ele != null) { const d = pts[i].ele - pts[i - 1].ele; if (d > 0) up += d; }
    }
    if (pts[i].hr) { hrSum += pts[i].hr; hrN++; hrMax = Math.max(hrMax, pts[i].hr); }
  }
  const times = pts.map(p => p.t).filter(Boolean);
  const started_at = times.length ? new Date(Math.min(...times)) : new Date();
  const duration_s = times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : null;
  const calMatch = xml.match(/<(?:[\w-]+:)?(?:calories|Calories)>(\d+)/);
  return {
    name, sport: type,
    started_at, duration_s,
    distance_m: Math.round(dist * 1000),
    elevation_up_m: Math.round(up),
    hr_avg: hrN ? Math.round(hrSum / hrN) : null,
    hr_max: hrMax || null,
    calories: calMatch ? +calMatch[1] : null,
    speed_avg_kmh: duration_s ? +(dist / (duration_s / 3600)).toFixed(2) : null,
    track: samplePoints(pts.map(p => p.ele != null ? [+p.lat.toFixed(5), +p.lon.toFixed(5), Math.round(p.ele)] : [+p.lat.toFixed(5), +p.lon.toFixed(5)]), 500),
  };
}
