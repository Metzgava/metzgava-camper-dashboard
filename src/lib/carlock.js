// Import dei viaggi esportati da my.carlock.co (CSV o XLS/XLSX)
// Colonne: Data, Orario di inizio, Orario di fine, Posizione di inizio, Posizione di fine, Distanza ( km ), Durata, Punteggio di guida, Tipo
import zlib from 'node:zlib';

// ---- lettura file ----
export function readCarlockFile(buffer, filename = '') {
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const text = isZip ? xlsxToCsvText(buffer) : buffer.toString('utf8');
  return parseCarlockCsv(fixEncoding(text));
}

// Excel a volte salva il CSV "così com'è" in una sola colonna: gestiamo entrambi i casi
function xlsxToCsvText(buf) {
  const files = unzip(buf);
  const shared = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlUnescape(t[1])).join(''));
  const sheetName = Object.keys(files).find(k => /^xl\/worksheets\/sheet1\.xml$/.test(k)) || Object.keys(files).find(k => k.startsWith('xl/worksheets/sheet'));
  const sheet = files[sheetName] || '';
  const rows = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] || '';
      const col = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? '';
      if (type === 's') v = shared[+v] ?? '';
      else if (type === 'inlineStr') v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => xmlUnescape(t[1])).join('');
      else v = xmlUnescape(v);
      cells.push({ col, v });
    }
    rows.push(cells);
  }
  // se ogni riga ha una sola cella che contiene virgole -> è un CSV incollato in colonna A
  const single = rows.every(r => r.filter(c => c.v !== '').length <= 1);
  if (single) return rows.map(r => r[0]?.v || '').join('\n');
  return rows.map(r => r.map(c => `"${String(c.v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function unzip(buf) {
  const out = {};
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    let csize = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26), extraLen = buf.readUInt16LE(p + 28);
    const flags = buf.readUInt16LE(p + 6);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    let dataStart = p + 30 + nameLen + extraLen;
    if (flags & 8) { // data descriptor: prendi la dimensione dal central directory
      csize = sizeFromCentralDir(buf, name) ?? csize;
    }
    const data = buf.subarray(dataStart, dataStart + csize);
    try { out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'); } catch { }
    p = dataStart + csize + ((flags & 8) ? 16 : 0);
    if (flags & 8 && buf.readUInt32LE(p - 16) !== 0x08074b50) p -= 4; // descriptor senza firma
  }
  return out;
}
function sizeFromCentralDir(buf, name) {
  let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (p < 0) return null;
  let cd = buf.readUInt32LE(p + 16);
  while (cd + 46 <= buf.length && buf.readUInt32LE(cd) === 0x02014b50) {
    const n = buf.readUInt16LE(cd + 28), e = buf.readUInt16LE(cd + 30), c = buf.readUInt16LE(cd + 32);
    if (buf.subarray(cd + 46, cd + 46 + n).toString('utf8') === name) return buf.readUInt32LE(cd + 20);
    cd += 46 + n + e + c;
  }
  return null;
}
const xmlUnescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// "LocalitÃ\xa0" -> "Località" (UTF-8 letto come Latin-1)
function fixEncoding(s) {
  if (!/Ã|Â/.test(s)) return s;
  try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; }
}

// ---- CSV ----
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// CarLock scrive i numeri all'italiana — 1.482,5 — ma esportato in altre lingue
// usa il punto come decimale. Togliere i punti a occhi chiusi trasformava 148.2
// in 1482: il punto e' un separatore di migliaia solo se raggruppa tre cifre.
const num = s => {
  let t = String(s ?? '').trim().replace(/[^\d.,-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');        // 1.482,5
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');    // 1.482
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? +m[0] : 0;
};
// «1h 29m», «1 h 29 min», «45m», «45 min»: i minuti a volte sono «min» e a
// volte «m», e leggendo solo «min» un'ora e mezza diventava un'ora tonda
const durMin = s => {
  const t = String(s || '');
  const h = +(t.match(/(\d+)\s*h/) || [0, 0])[1];
  const m = +(t.match(/(\d+)\s*m(?:in)?\b/) || [0, 0])[1];
  return h * 60 + m;
};

// Fra due orari la durata non si legge: si conta. Quando ci sono l'inizio e la
// fine, quelli comandano — nessun formato da indovinare. Dopo la mezzanotte
// l'arrivo e' il giorno dopo.
const minutiFraOrari = (inizio, fine) => {
  const m = t => { const x = String(t).match(/(\d{1,2}):(\d{2})/); return x ? +x[1] * 60 + +x[2] : null; };
  const a = m(inizio), b = m(fine);
  if (a == null || b == null) return null;
  return b >= a ? b - a : b + 24 * 60 - a;
};
function parseDate(s) {
  const m = String(s).match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function parseCarlockCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const idx = (...names) => header.findIndex(h => names.some(n => h.includes(n)));
  const iDate = idx('data', 'date'), iStart = idx('inizio', 'start time'), iEnd = idx('fine', 'end time');
  const iFrom = idx('posizione di inizio', 'start location', 'start address'), iTo = idx('posizione di fine', 'end location', 'end address');
  const iKm = idx('distanza', 'distance'), iDur = idx('durata', 'duration'), iType = idx('tipo', 'type');
  const trips = [];
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const date = parseDate(c[iDate]);
    if (!date) continue; // riga dei totali o vuota
    const km = num(c[iKm]);
    trips.push({
      date, start: c[iStart] || '', end: c[iEnd] || '', from: c[iFrom] || '', to: c[iTo] || '',
      km, duration_min: minutiFraOrari(c[iStart], c[iEnd]) ?? durMin(c[iDur]), type: c[iType] || '',
      external_id: `carlock:${date}:${c[iStart]}:${c[iEnd]}`,
    });
  }
  return trips.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

// Unisce i tragitti consecutivi separati da soste brevi (rifornimenti, pause)
export function mergeTrips(trips, gapMin = 30) {
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const out = [];
  for (const t of trips) {
    const last = out[out.length - 1];
    if (last && last.date === t.date && gapMin > 0 && toMin(t.start) - toMin(last.end) <= gapMin && toMin(t.start) >= toMin(last.end)) {
      last.end = t.end; last.to = t.to; last.km = +(last.km + t.km).toFixed(1); last.duration_min += t.duration_min; last.merged = (last.merged || 1) + 1;
      // **Il capo d'arrivo porta appresso le sue coordinate**, quando ci sono.
      // Dal file non arrivano e restano `undefined`, come e' sempre stato; dal
      // rubinetto di CarLock si'. Senza queste due righe una tappa unita
      // terrebbe le coordinate d'arrivo del PRIMO tragitto -- un capo nel
      // posto sbagliato, e muto -- mentre il nome, due righe sopra, era quello
      // giusto.
      if (t.a_lat != null) { last.a_lat = t.a_lat; last.a_lon = t.a_lon; }
      last.external_id += '+' + t.external_id.split(':').pop();
    } else out.push({ ...t });
  }
  return out;
}

const PROVINCES = `Agrigento|Alessandria|Ancona|Aosta|Valle d'Aosta|Arezzo|Ascoli Piceno|Asti|Avellino|Bari|Barletta-Andria-Trani|Belluno|Benevento|Bergamo|Biella|Bologna|Bolzano|South Tyrol|Brescia|Brindisi|Cagliari|Caltanissetta|Campobasso|Caserta|Catania|Catanzaro|Chieti|Como|Cosenza|Cremona|Crotone|Cuneo|Enna|Fermo|Ferrara|Florence|Firenze|Foggia|Forlì-Cesena|Forli-Cesena|Frosinone|Genoa|Genova|Gorizia|Grosseto|Imperia|Isernia|La Spezia|L'Aquila|Latina|Lecce|Lecco|Livorno|Lodi|Lucca|Macerata|Mantua|Mantova|Massa and Carrara|Massa-Carrara|Matera|Messina|Milan|Milano|Modena|Monza and Brianza|Monza e Brianza|Naples|Napoli|Novara|Nuoro|Oristano|Padua|Padova|Palermo|Parma|Pavia|Perugia|Pesaro and Urbino|Pesaro e Urbino|Pescara|Piacenza|Pisa|Pistoia|Pordenone|Potenza|Prato|Ragusa|Ravenna|Reggio Calabria|Reggio Emilia|Rieti|Rimini|Rome|Roma|Rovigo|Salerno|Sassari|Savona|Siena|Syracuse|Siracusa|Sondrio|South Sardinia|Sud Sardegna|Taranto|Teramo|Terni|Turin|Torino|Trapani|Trento|Treviso|Trieste|Udine|Varese|Venice|Venezia|Verbano-Cusio-Ossola|Vercelli|Verona|Vibo Valentia|Vicenza|Viterbo`.split('|');
const provRe = new RegExp(`\\s+(?:(?:Province of|Provincia di|Metropolitan City of|Città Metropolitana di)\\s+.+|(?:${PROVINCES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))$`, 'i');

// CarLock scrive gli indirizzi stranieri incollando insediamento e comune:
// "402, Nova Gorica Nova Gorica City", "Tolmin Tolmin Municipality". Quel nome
// doppio non esiste per nessun geocoder, e il comune ripetuto non aggiunge
// niente a quello che si sa: via le parole che descrivono l'ente e via la
// ripetizione, resta il nome del posto.
const ENTI = /[ ,]+(?:urban municipality|municipality|city|town|comune|ob[c\u010d]ina|gemeinde|commune|district|county|prefecture)$/i;
function senzaRipetizioni(nome) {
  let t = String(nome).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && ENTI.test(t); i++) t = t.replace(ENTI, '').trim();
  const w = t.split(' ');
  // "Nova Gorica Nova Gorica" -> "Nova Gorica": la seconda meta' ripete la prima.
  // Si parte dal pezzo piu' lungo, cosi' una parola uguale per caso non inganna
  for (let n = Math.floor(w.length / 2); n >= 1; n--) {
    if (w.slice(0, n).join(' ').toLowerCase() === w.slice(n, 2 * n).join(' ').toLowerCase()) {
      return [...w.slice(0, n), ...w.slice(2 * n)].join(' ').trim();
    }
  }
  return t;
}

// "31058 Susegana Treviso" -> { cap: "31058", town: "Susegana" }
function capTown(addr) {
  const parts = String(addr).replace(/\s+/g, ' ').trim().split(',').map(s => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  let m = last.match(/^(\d{5})\s+(.+)$/);
  if (m) return { cap: m[1], town: senzaRipetizioni(m[2].replace(provRe, '')) };
  // formato "…, Caorle, Venice 30021": provincia + CAP in coda, comune nel pezzo precedente
  m = last.match(/^(.+?)\s+(\d{5})$/);
  if (m) { const prev = parts[parts.length - 2]; const town = senzaRipetizioni((prev && !/\d/.test(prev) ? prev : m[1]).replace(provRe, '')); return { cap: m[2], town }; }
  return { cap: null, town: senzaRipetizioni(last.replace(provRe, '')) };
}

// Candidati per il geocoder, dal più preciso al più generico
export function addressCandidates(addr) {
  const a = String(addr).replace(/\s+/g, ' ').trim();
  const parts = a.split(',').map(s => s.trim());
  const { cap, town } = capTown(a);
  const street = parts.length > 1 ? parts[0] : null;
  const cands = [];
  if (street && cap) cands.push(`${street}, ${cap} ${town}`);
  if (street) cands.push(`${street}, ${town}`);
  if (cap) cands.push(`${cap} ${town}`);
  cands.push(town);
  // Ultima rete: il nome accorciato di una parola per volta. CarLock al comune
  // incolla a volte la frazione o la regione, e "Most na Soci Tolmin" non
  // esiste per nessuna mappa mentre "Most na Soci" si trova. Si tagliano al
  // massimo due parole: oltre, si rischia di finire in un altro paese
  const w = town.split(' ').filter(Boolean);
  for (let n = w.length - 1; n >= Math.max(1, w.length - 2); n--) cands.push(w.slice(0, n).join(' '));
  return [...new Set(cands.filter(Boolean))];
}

// Nome breve per la tappa: il comune
export function shortName(addr) { return capTown(addr).town || String(addr); }

// Nome completo per l'elenco: comune e via, ma solo se la via c'e' davvero.
// CarLock all'estero scrive spesso il solo numero civico ("402, Nova Gorica
// City"), e un numero da solo non dice dove si era: sta meglio fuori
export function nomeTappa(addr) {
  const parts = String(addr).split(',').map(x => x.trim()).filter(Boolean);
  const via = parts.length > 1 ? parts[0] : null;
  return via && !/^\d+\s*[a-z]?$/i.test(via) ? `${shortName(addr)}, ${via}` : shortName(addr);
}
