import crypto from 'node:crypto';

export const SECRET = process.env.SESSION_SECRET || process.env.APP_SECRET || 'dev-secret-cambiami';

// ---- crittografia simmetrica per i token delle integrazioni ----
const key = crypto.createHash('sha256').update(SECRET).digest();
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
export function decrypt(payload) {
  const [iv, tag, enc] = payload.split('.').map(s => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const randomCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

// ---- geometria ----
export function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Campiona una traccia per non salvare migliaia di punti
export function samplePoints(points, max = 400) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
  out.push(points[points.length - 1]);
  return out;
}

// ---- fetch con timeout ----
export async function fetchJson(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'camper-dashboard/1.0', ...(opts.headers || {}) } });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} da ${new URL(url).host}`), { status: res.status, data });
    return data;
  } finally { clearTimeout(t); }
}

export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// ---- helper per le rotte express ----
export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
