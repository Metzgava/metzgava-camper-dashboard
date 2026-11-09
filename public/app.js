/* Camper dashboard – SPA senza framework */
(() => {
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(+n || 0);
const num = (n, d = 1) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(+n || 0);
const fdate = d => d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fdt = d => d ? new Date(d).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const iso = d => { if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10); const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const dur = s => { if (!s) return '—'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m} min`; };
const today = () => iso(new Date());
// Le valute che si possono scegliere su ogni importo. L'euro e' il metro con
// cui si fanno i totali: ogni spesa porta il cambio del suo giorno, congelato.
// L'elenco vero lo tiene il servizio, che e' anche quello che sa dare i cambi:
// qui dentro resta solo una scorta per i primi istanti, prima che arrivi.
let VALUTE = { EUR: '\u20ac Euro', CHF: 'CHF Franchi svizzeri', GBP: '\u00a3 Sterline', NOK: 'kr Corone norvegesi', SEK: 'kr Corone svedesi', DKK: 'kr Corone danesi' };
const scegliValuta = (nome, scelta) => `<select name="${nome}">${Object.entries(VALUTE).map(([c, e]) => `<option value="${c}" ${c === (scelta || 'EUR') ? 'selected' : ''}>${e}</option>`).join('')}</select>`;
// Un importo in valuta si legge com'e' stato speso, con accanto quanto fa in euro
const importoConValuta = (v, valuta, cambio) => valuta && valuta !== 'EUR'
  ? `${num(v, 2)} ${valuta} <span class="muted">(${eur(v * (cambio || 1))})</span>`
  : eur(v);

// Come si fa una tappa. In camper e' il caso normale; gli altri hanno una
// compagnia, un orario e un biglietto, e sulla mappa una linea tutta loro.
// Un viaggio ha tre momenti: lo si pensa, lo si fa, e poi resta.
const STATI = { bozza: 'in costruzione', open: 'in corso', closed: 'concluso' };
const nomeStato = t => STATI[t?.status] || t?.status || '';

const MEZZI = { camper: ['\ud83d\ude90', 'In camper'], traghetto: ['\u26f4\ufe0f', 'Traghetto'],
  aereo: ['\u2708\ufe0f', 'Aereo'], treno: ['\ud83d\ude86', 'Treno'], bus: ['\ud83d\ude8c', 'Bus'] };
const mezzoDi = l => MEZZI[l?.mezzo] ? l.mezzo : 'camper';
const inCamper = l => mezzoDi(l) === 'camper';

const CAT = { gasolio: ['⛽', 'Gasolio'], traghetto: ['⛴️', 'Traghetti'], area_sosta: ['🅿️', 'Aree sosta'], campeggio: ['⛺', 'Campeggi'], pedaggi: ['🛣️', 'Pedaggi'], vitto: ['🍝', 'Vitto'], spesa: ['🛒', 'Spesa'], visite: ['🏛️', 'Visite'], manutenzione: ['🔧', 'Manutenzione'], altro: ['💶', 'Altro'],
  // In coda, cosi' le categorie di prima tengono il colore che avevano
  bus: ['🚌', 'Bus'], treno: ['🚆', 'Treno'], aereo: ['✈️', 'Aereo'],
  spettacoli: ['🎭', 'Spettacoli'], sport: ['🏟️', 'Incontri sportivi'] };
const catLabel = c => CAT[c] ? `${CAT[c][0]} ${CAT[c][1]}` : c;
const catColor = c => `var(--c${(Object.keys(CAT).indexOf(c) + 15) % 15 + 1})`;
// Nessuna emoji rappresenta un tapis roulant: lo disegniamo (nastro, montante, console)
const ICO_TAPIS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="15" width="14" height="5" rx="2.5"/><path d="M16.5 17.2 19.6 7.4"/><path d="M17.6 7.4h4.2"/></svg>';
// Salute manda i nomi nella lingua del telefono, Komoot in inglese: qui stanno entrambi
const SPORT = { hike: '🥾', hiking: '🥾', escursion: '🥾', trekking: '🥾', alpinis: '🧗',
  walking: '🚶', walk: '🚶', camminat: '🚶', passeggiat: '🚶',
  running: '🏃', jogging: '🏃', cors: '🏃', esegui: '🏃', run: '🏃',
  touringbicycle: '🚴', mtb: '🚵', racebike: '🚴', cycling: '🚴', bike: '🚴', ride: '🚴',
  ciclism: '🚴', bicicl: '🚴', gravel: '🚵',
  swimming: '🏊', swim: '🏊', nuoto: '🏊', nuot: '🏊',
  scialpinis: '🎿', skitour: '🎿', ski: '🎿', sci: '🎿', snowboard: '🏂', mountaineering: '🧗',
  forza: '🏋️', strength: '🏋️', yoga: '🧘', riscaldamento: '🧘', raffreddamento: '🧘' };
// Il tapis roulant va riconosciuto prima della camminata: "Interno Camminata" e' entrambe
const RE_TAPIS = /(interno|indoor|coperto)[\s\S]*(camminat|esegui|cors|walk|run)|(camminat|esegui|cors|walk|run)[\s\S]*(interno|indoor|coperto)|tapis|treadmill/;
const sportIco = s => {
  const testo = String(s || '').toLowerCase();
  if (RE_TAPIS.test(testo)) return ICO_TAPIS;
  const secco = testo.replace(/[^a-z]/g, '');
  // La neve prima di tutto: «scialpinismo» contiene «alpinis», e con la sola
  // ricerca per sottostringa finirebbe con l'icona dell'arrampicata
  if (/scialpinis|scialpin|skitour|sciditondo|scidifondo|scialpino|^sci|ski/.test(secco)) return secco.includes('snowboard') ? '\ud83c\udfc2' : '\ud83c\udfbf';
  if (secco.includes('snowboard')) return '\ud83c\udfc2';
  for (const k in SPORT) if (secco.includes(k)) return SPORT[k];
  return '🏅';
};

let user = null, settings = {}, atleti = [];

// ---------- API ----------
async function api(path, opts = {}) {
  const o = { headers: {}, ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch('/api' + path, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && user) { user = null; render(); } throw new Error(data.error || `Errore ${r.status}`); }
  return data;
}
const toast = (msg, err = false) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 4500 : 2500); };
const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  onMount?.(bg, () => bg.remove());
  return bg;
}
// Il pannello di una tendina si apre verso destra; se cosi' uscirebbe dallo schermo
// lo si ancora al bordo destro del pulsante. Serve soprattutto sui telefoni.
function sistemaTendina(dettaglio) {
  const corpo = $('.tendina-corpo', dettaglio);
  if (!corpo) return;
  corpo.classList.remove('a-destra');
  if (corpo.getBoundingClientRect().right > document.documentElement.clientWidth - 8) corpo.classList.add('a-destra');
}

const confirmDlg = msg => new Promise(res => modal(`<h2>${esc(msg)}</h2><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-x>Annulla</button><button class="btn danger" data-ok>Conferma</button></div>`,
  (el, close) => { $('[data-x]', el).onclick = () => { close(); res(false); }; $('[data-ok]', el).onclick = () => { close(); res(true); }; }));

// ---------- Mappe ----------
function makeMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: !opts.simple, attributionControl: true, ...opts });
  const strada = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  // La veduta dall'alto, con sopra i nomi dei paesi e le strade con la loro
  // sigla: rivedendo un viaggio si vuole il mare e la montagna, ma anche sapere
  // che quello era il passo del Tonale e che si e' scesi per la A4.
  const ibrida = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '' }),
  ]);
  map.strati_sfondo = { strada, ibrida };
  if (!opts.simple) L.control.layers({ 'Mappa': strada, 'Dall\u2019alto': ibrida }, null, { position: 'topright' }).addTo(map);
  map.setView([45.9, 12.3], 7);
  return map;
}

// ---------- Rivedere un percorso ----------
// Il viaggio si rivede dall'alto: l'icona del mezzo avanza sulla strada fatta,
// la scia resta dietro, e quando passa accanto a una foto scattata li' la foto
// compare per un momento e poi si riparte. Non e' un filmato da scaricare: e'
// la mappa che si muove, e si puo' registrare lo schermo del telefono.
const MEZZO_ICONA = { camper: '\ud83d\ude90', traghetto: '\u26f4\ufe0f', aereo: '\u2708\ufe0f', treno: '\ud83d\ude86', bus: '\ud83d\ude8c' };
const iconaCorsa = faccia => L.divIcon({ className: '', html: `<div class="corsa-mezzo">${faccia}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] });

// Quanti metri fra due punti: serve a distribuire il passo e a capire quando
// l'icona e' arrivata accanto a una foto
const metriFra = (a, b) => {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dl = r(b[0] - a[0]), dn = r(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Quando un allenamento finisce, i suoi numeri: distanza, dislivello, calorie,
// media oraria e battito. Sono quelli che si cercano appena finita l'uscita, e
// in fondo alla riproduzione arrivano senza doverli andare a prendere.
const numeriAllenamento = w => [
  w.distance_m > 0 ? [num(w.distance_m / 1000), 'km'] : null,
  w.elevation_up_m > 0 ? [num(w.elevation_up_m, 0), 'm di salita'] : null,
  w.calories > 0 ? [num(w.calories, 0), 'kcal'] : null,
  mediaKmh(w) ? [num(mediaKmh(w)), 'km/h di media'] : null,
  w.hr_avg > 0 ? [num(w.hr_avg, 0), 'bpm medi'] : null,
].filter(Boolean);

// Un traghetto, un volo, un treno non hanno una strada da seguire: fra i due
// capi c'e' una linea sola, fatta di due punti. Bastano a disegnarla, non a
// percorrerla - l'icona ci salterebbe sopra da un capo all'altro, e una foto
// scattata a meta' traversata si aggancerebbe a una delle due punte, come se
// fosse stata fatta in banchina. Si semina la linea di punti, con la curva
// appena accennata delle rotte sulle carte dei voli: cosi' il tragitto si
// percorre, e le foto compaiono dove sono state scattate davvero.
const arcoFra = (a, b, n = 72) => {
  const k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180) || 1; // i gradi di longitudine si stringono salendo
  const xa = a[1] * k, ya = a[0], xb = b[1] * k, yb = b[0];
  const dx = xb - xa, dy = yb - ya;
  if (!Math.hypot(dx, dy)) return [a, b];
  // il punto di comando sta di fianco alla meta': la pancia della curva e' un
  // ottavo scarso della corda, quanto basta a vedere una rotta e non un righello
  const cx = (xa + xb) / 2 - dy * .12, cy = (ya + yb) / 2 + dx * .12;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, w0 = u * u, w1 = 2 * u * t, w2 = t * t;
    out.push([w0 * ya + w1 * cy + w2 * yb, (w0 * xa + w1 * cx + w2 * xb) / k]);
  }
  return out;
};
const tragittoDisegnato = l => {
  const g = (l.geometry || [[l.from_lat, l.from_lon], [l.to_lat, l.to_lon]]).map(q => [+q[0], +q[1]]);
  return inCamper(l) || g.length > 2 ? g : arcoFra(g[0], g[g.length - 1]);
};

// Quando una tratta in traghetto, in treno o in aereo finisce, quello che se ne
// cerca: quanto e' durata, quanti chilometri, a che ora, quanto e' costato il
// biglietto. E con chi: fra due anni il nome dei due porti, da solo, non dice
// con quale compagnia si e' passata la notte in mare.
const DURATA_MEZZO = { traghetto: 'di traversata', aereo: 'di volo', treno: 'di treno', bus: 'di bus', camper: 'di guida' };
const biglietto = l => !(+l.tariffa > 0) ? null
  : l.tariffa_currency && l.tariffa_currency !== 'EUR' ? `${num(l.tariffa, 2)} ${esc(l.tariffa_currency)}` : eur(l.tariffa);
const compagniaDi = l => [MEZZI[mezzoDi(l)][1], [l.compagnia, l.codice].filter(Boolean).join(' ')].filter(Boolean).join(' \u00b7 ');
const numeriTappa = l => inCamper(l) ? null : [
  l.duration_min > 0 ? [dur(l.duration_min * 60), DURATA_MEZZO[mezzoDi(l)]] : null,
  l.distance_km > 0 ? [num(l.distance_km, 0), 'km'] : null,
  l.start_time ? [`${esc(l.start_time)}${l.end_time ? '\u2013' + esc(l.end_time) : ''}`, 'orario'] : null,
  biglietto(l) ? [biglietto(l), l.sconto ? `di biglietto \u00b7 ${l.sconto}` : 'di biglietto'] : null,
].filter(Boolean);

// La musica che accompagna il filmato del tracciato.
//
// Non e' un file: e' suonata dal browser mentre la traccia avanza. Un brano
// vero di trent'anni fa non si puo' mettere - e' di qualcun altro, e peserebbe
// un paio di megabyte da scaricare ogni volta - ma quel giro li' sotto lo
// conoscono tutti: la cassa dritta, il charleston in levare, il battimani sul
// due e sul quattro, il basso che cammina e la stoccata di piano sopra. Giro
// di la minore, centoventidue battute al minuto, come mezza estate del 1994.
//
// Dura quanto deve durare: non e' un pezzo da far stare dentro al filmato, e'
// un motore che gira finche' il viaggio non e' finito - mezzo minuto o tre, lo
// decide la strada. E pesa zero byte.
function musichetta(differita) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC && !differita) return null;
  let ctx;
  try { ctx = differita || new AC(); } catch { return null; }
  if (!differita) ctx.resume?.().catch(() => {});

  const VOLUME = 0.15;                      // sta sotto: accompagna, non copre
  const master = ctx.createGain();
  const morbido = ctx.createDynamicsCompressor();
  master.connect(morbido);
  morbido.connect(ctx.destination);
  // Dal vivo entra sfumando; in differita - quando la si rende per misurarla -
  // non c'e' nessuno che entra in sala, e parte al suo volume
  master.gain.value = differita ? VOLUME : 0.0001;
  if (!differita) master.gain.exponentialRampToValueAtTime(VOLUME, ctx.currentTime + 1.4);

  // Un secondo di rumore bianco: da li' escono il charleston e il battimani
  const rumore = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
  const dati = rumore.getChannelData(0);
  for (let i = 0; i < dati.length; i++) dati[i] = Math.random() * 2 - 1;

  const inviluppo = (g, t, attacco, coda, picco) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(picco, t + attacco);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attacco + coda);
  };
  const daRumore = (t, tipo, freq, q, attacco, coda, picco) => {
    const src = ctx.createBufferSource(); src.buffer = rumore;
    const f = ctx.createBiquadFilter(); f.type = tipo; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain();
    inviluppo(g, t, attacco, coda, picco);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + attacco + coda + 0.05);
  };
  const cassa = t => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    inviluppo(g, t, 0.004, 0.24, 0.95);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.32);
  };
  const charleston = (t, aperto) => daRumore(t, 'highpass', 7600, 0, 0.002, aperto ? 0.17 : 0.035, aperto ? 0.2 : 0.13);
  const battimani = t => [0, 0.011, 0.023].forEach((d, i) => daRumore(t + d, 'bandpass', 1600, 1.2, 0.002, i === 2 ? 0.14 : 0.03, i === 2 ? 0.34 : 0.2));
  const basso = (t, freq, lungo) => {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1100, t);
    f.frequency.exponentialRampToValueAtTime(240, t + 0.16);
    inviluppo(g, t, 0.006, lungo, 0.42);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + lungo + 0.08);
  };
  // La stoccata di piano: tre note insieme, corte, un filo di coda
  const stoccata = (t, note, forza = 0.16) => note.forEach((freq, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = i === 0 ? 'triangle' : 'sine';
    o.frequency.value = freq;
    inviluppo(g, t, 0.006, 0.3, forza);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.4);
  });
  const arpa = (t, freq) => {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = 2600;
    inviluppo(g, t, 0.004, 0.12, 0.07);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.2);
  };

  // La minore, fa, do, sol: il giro su cui negli anni novanta ci hanno
  // costruito mezza classifica. Una battuta per accordo.
  const GIRO = [
    [110.00, [440.00, 523.25, 659.25]],
    [87.31, [349.23, 440.00, 523.25]],
    [130.81, [392.00, 523.25, 659.25]],
    [98.00, [392.00, 493.88, 587.33]],
  ];

  const BPM = 122, SEDICESIMO = 15 / BPM;
  let passo = 0, quando = ctx.currentTime + 0.12, fermo = false, chiuso = false, timer = null;

  const suonaPasso = (n, t) => {
    const s = n % 16, battuta = Math.floor(n / 16);
    const [radice, accordo] = GIRO[battuta % 4];
    // Si entra con poco e si cresce: prima la cassa, poi il battimani, poi
    // l'arpeggio. Dopo otto battute si leva tutto per mezza battuta e si
    // rientra - il respiro che negli anni novanta c'era sempre.
    const parte = Math.floor(battuta / 4);
    const respiro = battuta % 8 === 7 && s >= 12;
    if (respiro) { if (s === 12) stoccata(t, accordo, 0.2); return; }
    if (s % 4 === 0) cassa(t);
    if (s % 4 === 2) charleston(t, true); else if (s % 2 === 0) charleston(t, false);
    if (parte > 0 && (s === 4 || s === 12)) battimani(t);
    if (s % 2 === 0) basso(t, s === 6 || s === 14 ? radice * 2 : radice, 0.15);
    if (s === 6 || s === 14) stoccata(t, accordo);
    if (parte > 1 && s % 2 === 1) arpa(t, accordo[Math.floor(n / 2) % 3] * 2);
  };

  const batti = () => {
    if (chiuso || differita) return;
    if (!fermo) {
      while (quando < ctx.currentTime + 0.25) {
        suonaPasso(passo, quando);
        passo++;
        quando += SEDICESIMO;
      }
    }
    timer = setTimeout(batti, 25);
  };
  batti();

  const sfuma = (a, secondi) => {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, a), t + secondi);
  };
  return {
    // Serve a provarla senza doverla ascoltare: semina tutti i passi di un
    // tratto di tempo in una volta, per renderla in differita e misurarla
    semina: (da, quanto) => { for (let n = 0; n * SEDICESIMO < quanto; n++) suonaPasso(n, da + n * SEDICESIMO); },
    pausa: () => { fermo = true; sfuma(0.0001, 0.25); },
    riprendi: () => { fermo = false; quando = ctx.currentTime + 0.05; sfuma(VOLUME, 0.4); },
    ferma: () => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(timer);
      sfuma(0.0001, 0.7);
      setTimeout(() => ctx.close().catch(() => {}), 900);
    },
  };
}

function riproduci(map, segmenti, foto, opzioni = {}) {
  const grezzi = segmenti.filter(s => s.punti?.length > 1);
  if (!grezzi.length) return toast('Non c\u2019e\u2019 nessun percorso da rivedere', true);

  // I punti di una traccia non sono distribuiti alla stessa distanza: seguirli
  // uno per uno farebbe correre l'icona dove il GPS ha segnato fitto e
  // strisciare dove ha segnato rado. Si misura ogni pezzo e lo si percorre a
  // passo regolare, cosi' il movimento racconta la strada e non il campionamento.
  const pezzi = grezzi.map(p => {
    const acc = [0];
    for (let i = 1; i < p.punti.length; i++) acc.push(acc[i - 1] + metriFra(p.punti[i - 1], p.punti[i]));
    return { ...p, acc, lung: acc[acc.length - 1] || 1 };
  });
  // Il tempo si divide con la radice della lunghezza: i quattrocento chilometri
  // del trasferimento non devono mangiarsi tutto il filmato, e la camminata di
  // tre chilometri non deve essere un lampo
  const FOTOGRAMMI = Math.max(600, (opzioni.secondi || 26) * 60);
  const somma = pezzi.reduce((a, p) => a + Math.sqrt(p.lung), 0) || 1;
  pezzi.forEach(p => { p.frames = Math.max(45, Math.round(FOTOGRAMMI * Math.sqrt(p.lung) / somma)); });

  const doveA = (p, f) => {
    const d = p.lung * Math.min(1, Math.max(0, f));
    let i = 1;
    while (i < p.acc.length - 1 && p.acc[i] < d) i++;
    const a = p.punti[i - 1], b = p.punti[i];
    const t = (d - p.acc[i - 1]) / Math.max(1e-6, p.acc[i] - p.acc[i - 1]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };

  // Ogni foto si aggancia al punto del percorso che le sta piu' vicino: e' li'
  // che comparira', mentre l'icona le passa davanti. Quelle lontane dalla
  // strada - scattate in gita, in un altro giorno - restano fuori.
  const scatti = (foto || []).map(f => {
    let miglior = null;
    pezzi.forEach((p, iP) => p.punti.forEach((pt, i) => {
      const d = metriFra([f.lat, f.lon], pt);
      if (!miglior || d < miglior.d) miglior = { d, iP, f: p.acc[i] / p.lung };
    }));
    return { ...f, ...miglior };
  }).filter(f => f.iP != null).sort((a, b) => a.iP - b.iP || a.f - b.f);

  const strati = map.strati_sfondo;
  const eraStrada = strati && map.hasLayer(strati.strada);
  if (strati) { map.removeLayer(strati.strada); strati.ibrida.addTo(map); }
  const velo = L.rectangle([[-90, -180], [90, 180]], { color: 'transparent', fillColor: '#0b1220', fillOpacity: .4, interactive: false }).addTo(map);

  // La mappa si porta davanti agli occhi: la data sta scritta in alto, e se
  // meta' mappa e' sopra il bordo dello schermo quella riga non la legge nessuno
  map.getContainer().scrollIntoView({ block: 'center', behavior: 'smooth' });

  const barra = document.createElement('div');
  barra.className = 'corsa-barra';
  barra.innerHTML = `<button class="btn sm" data-ferma title="Pausa">\u23f8</button><div class="avanzamento"><i></i></div><span class="quando small"></span><button class="btn sm ghost" data-musica title="Musica">\ud83d\udd0a</button><button class="btn sm ghost" data-chiudi title="Chiudi">\u2715</button>`;
  map.getContainer().appendChild(barra);

  // La data in sovraimpressione, in alto, per tutto il tempo che la traccia
  // avanza: nella barra si perde fra il nome dei posti, e chi registra lo
  // schermo si ritrova un filmato senza il giorno in cui e' successo
  const dataSopra = document.createElement('div');
  dataSopra.className = 'corsa-data';
  map.getContainer().appendChild(dataSopra);

  const scia = L.polyline([], { color: '#fbbf24', weight: 5, opacity: .95 }).addTo(map);
  const segnale = L.marker(pezzi[0].punti[0], { icon: iconaCorsa(pezzi[0].faccia), zIndexOffset: 1000 }).addTo(map);
  const avanzamento = barra.querySelector('.avanzamento i'), quando = barra.querySelector('.quando');
  const tastoPausa = barra.querySelector('[data-ferma]');

  // La musica parte con la riproduzione, si ferma con la pausa e sfuma alla
  // fine. Chi non la vuole la spegne, e l'app se lo ricorda per la volta dopo.
  const vuoleMusica = () => { try { return localStorage.getItem('musica') !== 'no'; } catch { return true; } };
  let suono = vuoleMusica() ? musichetta() : null;

  // Mettere in pausa e riprendere: lo fanno il tasto e il tocco sulla foto, e
  // sono la stessa cosa. Il tempo che restava da guardare si congela: senza,
  // una foto aperta durante la pausa scadrebbe mentre la si sta guardando.
  const metti = inPausa => {
    if (fermo === inPausa || chiuso) return;
    fermo = inPausa;
    tastoPausa.textContent = fermo ? '\u25b6' : '\u23f8';
    if (fermo) { restante = finoA ? Math.max(0, finoA - performance.now()) : 0; finoA = 0; suono?.pausa(); }
    else { if (restante) { finoA = performance.now() + restante; restante = 0; } suono?.riprendi(); }
  };

  let iP = -1, frame = 0, fatti = 0, fermo = false, chiuso = false, prossimo = 0;
  // Quanto resta da guardare prima di ripartire. Si misura in secondi veri e
  // non in fotogrammi: su uno schermo che ne disegna centoventi al secondo,
  // tre secondi contati a fotogrammi durerebbero un secondo e mezzo.
  let finoA = 0, restante = 0;
  const aspetta = ms => { finoA = ms ? performance.now() + ms : 0; };
  const totaleFrames = pezzi.reduce((a, p) => a + p.frames, 0);
  let fotoAperta = null, puntoFoto = null;
  const chiudiFoto = () => {
    if (fotoAperta) { map.removeLayer(fotoAperta); fotoAperta = null; }
    if (puntoFoto) { map.removeLayer(puntoFoto); puntoFoto = null; }
  };
  // Quello che sta scritto sotto una foto: il posto, se si sa, e la didascalia.
  // «Circa» quando il posto non viene dalla foto ma dal giorno in cui e' stata
  // scattata: dirlo costa una parola, e non spaccia una deduzione per un dato.
  const sottoLaFoto = f => [
    f.dove ? `\ud83d\udccd ${esc(f.dove)}${f.circa ? ' <i>(circa)</i>' : ''}` : '',
    f.caption ? esc(f.caption) : '',
  ].filter(Boolean).join(' \u00b7 ');

  // Tre secondi sono pochi per una foto che vale: toccandola la corsa si ferma
  // e la foto si apre grande quanto la mappa. Un altro tocco la chiude e il
  // viaggio riprende da dove era rimasto.
  let grande = null;
  const chiudiGrande = () => { grande?.remove(); grande = null; };
  const ingrandisci = sc => {
    if (grande) return riprendiDallaFoto();
    metti(true);
    grande = document.createElement('div');
    grande.className = 'corsa-grande';
    grande.innerHTML = `<img src="/uploads/${sc.filename}" alt="">${sottoLaFoto(sc) ? `<span>${sottoLaFoto(sc)}</span>` : ''}<div class="riprendi">\u25b6 Tocca per riprendere</div>`;
    grande.onclick = riprendiDallaFoto;
    map.getContainer().appendChild(grande);
  };
  const riprendiDallaFoto = () => {
    chiudiGrande();
    metti(false);
    aspetta(1);                        // la cartolina piccola si chiude e si riparte
  };

  const fine = () => {
    if (chiuso) return;
    chiuso = true;
    chiudiFoto(); chiudiGrande();
    viaCartelli(); viaScheda();
    suono?.ferma(); suono = null;
    [velo, scia, segnale].forEach(l => map.removeLayer(l));
    barra.remove(); dataSopra.remove();
    if (strati && eraStrada) { map.removeLayer(strati.ibrida); strati.strada.addTo(map); }
  };

  // I cartelli dei due capi: il posto da cui si parte e quello dove si arriva,
  // scritti sulla mappa e non solo nella barra, perche' e' li' che si guarda -
  // e perche' chi registra lo schermo si ritrova il nome dentro al filmato
  let cartelli = [];
  const viaCartelli = () => { cartelli.forEach(c => map.removeLayer(c)); cartelli = []; };
  let scheda = null;
  const viaScheda = () => { scheda?.remove(); scheda = null; };
  // In fondo al viaggio il conto di tutto: i chilometri, il tempo, e le spese
  // divise per tipologia. Resta sullo schermo finche' non si chiude - e' roba
  // che si legge, non che si guarda passare.
  const mostraFinale = () => {
    const f = opzioni.finale;
    if (!f) return false;
    viaScheda();
    scheda = document.createElement('div');
    scheda.className = 'corsa-scheda larga';
    scheda.innerHTML = `<div class="titolo">${f.titolo}</div>
      <div class="numeri">${(f.numeri || []).filter(Boolean).map(([v, u]) => `<div><b>${v}</b><span>${esc(u)}</span></div>`).join('')}</div>
      ${f.categorie?.length ? `<div class="spese">${f.categorie.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
      ${f.totale ? `<div class="totale">Totale speso <b>${f.totale}</b></div>` : ''}
      <button class="btn primary chiudi-scheda" type="button">\u2715 Chiudi</button>`;
    map.getContainer().appendChild(scheda);
    scheda.querySelector('.chiudi-scheda').onclick = fine;
    return true;
  };
  const mostraScheda = p => {
    viaScheda();
    if (!p.numeri?.length) return 0;
    scheda = document.createElement('div');
    scheda.className = 'corsa-scheda';
    scheda.innerHTML = `<div class="titolo">${p.faccia} ${esc([p.nome, p.quando].filter(Boolean).join(' \u00b7 '))}</div>
      ${p.chi ? `<div class="sotto">${esc(p.chi)}</div>` : ''}
      <div class="numeri">${p.numeri.map(([v, u]) => `<div><b>${v}</b><span>${esc(u)}</span></div>`).join('')}</div>`;
    map.getContainer().appendChild(scheda);
    return 3000;
  };
  const cartello = (punto, testo, arrivo) => L.marker(punto, {
    icon: L.divIcon({ className: '', html: `<div class="corsa-cartello${arrivo ? ' arrivo' : ''}">${esc(testo)}</div>`, iconSize: [0, 0], iconAnchor: [0, arrivo ? -6 : 34] }),
    interactive: false, zIndexOffset: 900,
  }).addTo(map);

  const mostraTitolo = p => {
    if (!p.titolo) return 0;
    viaScheda();
    scheda = document.createElement('div');
    scheda.className = 'corsa-scheda annuncio';
    scheda.innerHTML = `<div class="titolo">${p.faccia} ${esc(p.titolo)}</div>${p.nome ? `<div class="sotto">${esc([p.nome, p.quando].filter(Boolean).join(' \u00b7 '))}</div>` : ''}`;
    map.getContainer().appendChild(scheda);
    return 1800;
  };

  // Quanto bisogna stare bassi perche' si legga: su una statale basta meno
  // altezza che su un'autostrada, e su una camminata ancora meno
  const zoomDaVicino = lung => lung > 120000 ? 11 : lung > 25000 ? 12 : lung > 6000 ? 13 : 14;

  // Da quando la mappa comincia a seguire: prima c'e' la veduta d'insieme e la
  // discesa, e mettersi a inseguire in mezzo a quelle due farebbe un pasticcio
  let seguiDa = 0;

  const apriPezzo = n => {
    iP = n; frame = 0;
    seguiDa = performance.now() + 2800;
    const p = pezzi[n];
    scia.setLatLngs([]);
    segnale.setIcon(iconaCorsa(p.faccia));
    quando.textContent = [p.nome, p.quando].filter(Boolean).join(' \u00b7 ');
    dataSopra.textContent = p.quando || '';
    dataSopra.hidden = !p.quando;
    viaCartelli(); viaScheda();
    if (p.da) cartelli.push(cartello(p.punti[0], p.da, false));
    if (p.a) cartelli.push(cartello(p.punti[p.punti.length - 1], p.a, true));
    // Chi sta camminando si dice prima di partire, non alla fine
    aspetta(mostraTitolo(p));
    // La mappa si porta sul pezzo che comincia: un trasferimento di quattrocento
    // chilometri e una camminata di tre non si guardano dalla stessa altezza
    map.flyToBounds(L.latLngBounds(p.punti), { padding: [50, 50], duration: .8, maxZoom: 15 });
    // Poi pero' scende a seguire da vicino. Da duecento chilometri d'altezza si
    // vede la forma del viaggio ma non si legge niente: i nomi dei paesi e le
    // sigle delle strade - A4, SP270 - compaiono solo stando bassi. Prima la
    // veduta d'insieme per capire dove si va, poi il passo dell'automobilista.
    setTimeout(() => {
      if (chiuso || iP !== n) return;
      map.flyTo(doveA(p, frame / p.frames), zoomDaVicino(p.lung), { duration: 1.1 });
    }, 1500);
  };

  const passo = () => {
    if (chiuso) return;
    requestAnimationFrame(passo);
    if (fermo) return;
    if (finoA) {
      if (performance.now() < finoA) return;
      finoA = 0;
      chiudiFoto();
      if (scheda?.classList.contains('annuncio')) viaScheda();
      return;
    }
    if (iP < 0 || frame >= pezzi[iP].frames) {
      // Finito un allenamento, i suoi numeri restano un momento sullo schermo
      if (iP >= 0 && pezzi[iP].numeri?.length && !scheda) { aspetta(mostraScheda(pezzi[iP])); if (finoA) return; }
      // Arrivati: se c'e' il conto del viaggio resta li' finche' non si chiude,
      // altrimenti l'ultima immagine dura un momento e la mappa torna com'era
      if (iP + 1 >= pezzi.length) {
        avanzamento.style.width = '100%'; metti(true);
        if (!mostraFinale()) setTimeout(fine, scheda ? 3200 : 2200);
        return;
      }
      return apriPezzo(iP + 1);
    }
    const p = pezzi[iP];
    frame++; fatti++;
    const f = frame / p.frames;
    const pt = doveA(p, f);
    scia.addLatLng(pt);
    segnale.setLatLng(pt);
    avanzamento.style.width = `${(fatti / totaleFrames * 100).toFixed(1)}%`;
    // Il tracciato sta al centro. Prima la mappa aspettava che l'icona
    // arrivasse al bordo e poi la rincorreva a strappi: ora le sta dietro, e
    // il punto in cui si e' arrivati e' sempre in mezzo allo schermo. Non a
    // ogni fotogramma - vorrebbe dire ridisegnare le tessere sessanta volte al
    // secondo - ma abbastanza spesso da non vedersi.
    if (!fotoAperta && performance.now() > seguiDa && frame % 6 === 0) {
      // Si punta dove l'icona sara' fra un quarto di secondo, non dove e'
      // adesso: la mappa ci mette quel tempo ad arrivarci, e inseguendo il
      // punto di adesso resterebbe sempre indietro di altrettanto - l'icona
      // scivolerebbe verso il bordo invece di stare in mezzo.
      map.panTo(doveA(p, Math.min(1, (frame + 15) / p.frames)), { animate: true, duration: .25, easeLinearity: 1 });
    }
    // La foto compare quando l'icona le arriva accanto, e si aspetta un momento
    const sc = scatti[prossimo];
    if (sc && (sc.iP < iP || (sc.iP === iP && sc.f <= f))) {
      prossimo++;
      chiudiFoto();
      // La cartolina si stringe addosso alla foto - niente ritagli, niente
      // bianco intorno - e si mette di fianco al posto, non sopra: quello che
      // si vuole vedere e' anche dove e' stata scattata. Sta dalla parte dove
      // c'e' piu' spazio, e il posto resta segnato da un punto.
      const schermo = map.getSize();
      const dove = map.latLngToContainerPoint([sc.lat, sc.lon]);
      const aDestra = dove.x <= schermo.x / 2;
      fotoAperta = L.marker([sc.lat, sc.lon], {
        icon: L.divIcon({
          className: 'foto-icona',
          html: `<div class="corsa-foto ${aDestra ? 'a-destra' : 'a-sinistra'}"><img src="/uploads/${sc.filename}" alt="">${sottoLaFoto(sc) ? `<span>${sottoLaFoto(sc)}</span>` : ''}</div>`,
          iconSize: [340, 260],
          iconAnchor: aDestra ? [-18, 130] : [358, 130],
        }),
        zIndexOffset: 1200,
      }).addTo(map);
      fotoAperta.on('click', () => ingrandisci(sc));
      puntoFoto = L.circleMarker([sc.lat, sc.lon], { radius: 6, weight: 3, color: '#fff', fillColor: '#fbbf24', fillOpacity: 1 }).addTo(map);
      // La mappa si sposta quel tanto che basta perche' ci stiano tutti e due:
      // il posto da una parte e la cartolina dall'altra
      const bersaglio = L.point(schermo.x * (aDestra ? .26 : .74), schermo.y * .52);
      map.panBy([dove.x - bersaglio.x, dove.y - bersaglio.y], { animate: true, duration: .6 });
      aspetta(3000);
    }
  };
  apriPezzo(0);
  requestAnimationFrame(passo);

  tastoPausa.onclick = () => metti(!fermo);
  const tastoMusica = barra.querySelector('[data-musica]');
  const segnaMusica = () => {
    tastoMusica.textContent = suono ? '\ud83d\udd0a' : '\ud83d\udd07';
    tastoMusica.title = suono ? 'Togli la musica' : 'Rimetti la musica';
  };
  segnaMusica();
  tastoMusica.onclick = () => {
    if (suono) { suono.ferma(); suono = null; }
    else { suono = musichetta(); if (fermo) suono?.pausa(); }
    try { localStorage.setItem('musica', suono ? 'si' : 'no'); } catch { }
    segnaMusica();
  };
  barra.querySelector('[data-chiudi]').onclick = fine;
}

const pin = (color, label) => L.divIcon({ className: '', html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center"><span style="transform:rotate(45deg);font-size:12px;color:#fff;font-weight:700">${label || ''}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24] });
const pinSport = (sport, circa) => L.divIcon({ className: '', html: `<div class="pin-sport${circa ? ' circa' : ''}" style="border-color:${coloreSport(sport)}">${sportIco(sport)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16] });
const fotoIcon = src => L.divIcon({ className: '', html: `<div class="pin-foto"><img src="${src}" alt="" loading="lazy"></div>`, iconSize: [46, 46], iconAnchor: [23, 23], popupAnchor: [0, -24] });
const dotIcon = (color, emoji) => L.divIcon({ className: '', html: `<div style="width:24px;height:24px;border-radius:50%;background:#fff;border:2px solid ${color};display:grid;place-items:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.3)">${emoji}</div>`, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });

// ---------- Geocoder autocomplete ----------
function geoInput(input, onPick) {
  let box, timer;
  const wrap = input.parentElement; wrap.classList.add('rel');
  const close = () => { box?.remove(); box = null; };
  input.addEventListener('input', () => {
    clearTimeout(timer); input.dataset.lat = ''; onPick(null);
    const v = input.value.trim(); if (v.length < 3) return close();
    timer = setTimeout(async () => {
      let res = []; try { res = await api('/geocode?q=' + encodeURIComponent(v)); } catch { }
      close(); if (!res.length) return;
      box = document.createElement('div'); box.className = 'suggest';
      box.innerHTML = res.map((r, i) => `<div data-i="${i}">📍 ${esc(r.name)}</div>`).join('');
      box.onclick = e => { const i = e.target.closest('[data-i]')?.dataset.i; if (i == null) return; const r = res[i]; input.value = r.name; onPick(r); close(); };
      wrap.appendChild(box);
    }, 350);
  });
  input.addEventListener('blur', () => setTimeout(close, 200));
}

// ---------- Layout ----------
// La scarpa del menu e' disegnata, non un'emoji: un'emoji il colore ce l'ha
// gia' dentro e non si cambia. Cosi' invece ogni atleta ha la sua, e i due
// elenchi si distinguono prima di leggere il nome.
const ICO_SCARPA = colore => `<svg viewBox="1.5 6.6 21.4 12.8" fill="none" stroke="${colore}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">`
  + '<path d="M3 16.8v-4.3h3.4l1.9-3 2.6 1.4-1 1.9 4.7 2 3.5 1c.9.3 1.4.9 1.4 1.7v.3H3z"/><path d="M2.4 17.8h19.1"/></svg>';
// I colori di casa sono scelti; chi arrivasse dopo pesca dalla tavolozza in ordine
const COLORI_ATLETA = { metz: 'var(--c6)', cate: 'var(--c5)' };
const coloreAtleta = (nome, i) => COLORI_ATLETA[String(nome || '').trim().toLowerCase()]
  || ['var(--c3)', 'var(--c4)', 'var(--c7)', 'var(--c10)'][i % 4];

// Il menu ha una voce di allenamenti per atleta: con due persone in casa servono
// due elenchi distinti, e le copie di uno stesso giro non devono mescolarsi
const nav = () => [
  ['#/', '🚐', 'Viaggi'],
  ...atleti.map((a, i) => [`#/allenamenti/${a.id}`, ICO_SCARPA(coloreAtleta(a.name, i)), `Allenamenti ${a.name}`]),
  ['#/cruscotto', '🎛️', 'Cruscotto'],
  ['#/riepiloghi', '📊', 'Riepiloghi'],
  ['#/impostazioni', '⚙️', 'Impostazioni'],
];
function layout(content) {
  const h = location.hash || '#/';
  const active = x => (x === '#/' ? (h === '#/' || h.startsWith('#/trip')) : h.startsWith(x)) ? 'active' : '';
  const links = nav().map(([href, ico, l]) => `<a href="${href}" class="${active(href)}"><span class="ico">${ico}</span>${l}</a>`).join('');
  return `<aside class="sidebar"><div class="brand"><img src="icon.svg" alt="">Camper</div><nav class="nav">${links}</nav><div class="user">${esc(user.name)}<br><a href="#" data-logout>Esci</a></div></aside>
  <main>${content}</main><nav class="tabbar">${links}</nav>`;
}

// ---------- Auth ----------
function viewAuth(setup) {
  const app = $('#app');
  let mode = setup ? 'register' : 'login';
  const draw = () => {
    app.innerHTML = `<div class="auth stack"><div class="brand" style="justify-content:center;font-size:22px"><img src="icon.svg" alt="" style="width:44px;height:44px">Camper · Viaggi</div>
    <div class="card stack">
      <h2>${mode === 'login' ? 'Accedi' : setup ? 'Crea l\'amministratore' : 'Registrati con invito'}</h2>
      ${setup ? '<p class="muted small">Primo avvio: questo account sarà l\'amministratore che autorizza gli altri.</p>' : ''}
      <form id="f" class="stack">
        ${mode === 'register' ? '<div><label class="f">Nome</label><input name="name" required autocomplete="name"></div>' : ''}
        <div><label class="f">Email</label><input name="email" type="email" required autocomplete="email"></div>
        <div><label class="f">Password</label><input name="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
        ${mode === 'register' && !setup ? '<div><label class="f">Codice invito</label><input name="invite" required style="text-transform:uppercase" autocomplete="off"></div>' : ''}
        <button class="btn primary" style="width:100%">${mode === 'login' ? 'Entra' : 'Crea account'}</button>
      </form>
      ${setup ? '' : `<a href="#" id="sw" class="small">${mode === 'login' ? 'Hai un codice invito? Registrati' : 'Hai già un account? Accedi'}</a>`}
    </div></div>`;
    $('#sw')?.addEventListener('click', e => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); });
    $('#f').onsubmit = safe(async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      const r = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      if (r.pending) { app.innerHTML = `<div class="auth"><div class="card stack"><h2>In attesa di autorizzazione</h2><p>L'amministratore deve approvare il tuo account. Riprova più tardi.</p><button class="btn" onclick="location.reload()">Ricarica</button></div></div>`; return; }
      user = r.user; settings = await api('/settings'); render();
    });
  };
  draw();
}

// ---------- Viaggi ----------
// I viaggi nati dalla divisione automatica si chiamano «3 ago\u201311 ago 2026 \u00b7
// Alpago \u00b7 Tambre»: le date stanno gia' nel titolo e vengono ripetute sotto.
// Qui si mostra il solo nome, senza toccare il titolo in archivio: chi l'ha
// scritto a mano lo rivede com'e'.
const MESI_TITOLO = 'gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic';
const nomeViaggio = t => {
  const titolo = String(t?.title || '').trim();
  const senzaDate = titolo.replace(new RegExp(`^\\d{1,2}\\s*(${MESI_TITOLO})?\\s*(\\u2013|-|\\u2192)?\\s*\\d{0,2}\\s*(${MESI_TITOLO})?\\s*\\d{4}\\s*\\u00b7\\s*`, 'i'), '').trim();
  return senzaDate || titolo;
};

// Le date di un viaggio: si toccano e si cambiano, come il titolo si tocca e si
// rinomina. Compaiono in piu' posti, e in tutti fanno la stessa cosa.
const dateViaggio = t => `${fdate(t.start_date)}${t.end_date ? ' \u2192 ' + fdate(t.end_date) : ''}`;
// Le date si portano dietro i propri valori: cosi' il gestore del clic, che sta
// sul documento e vale ovunque, non deve andare a cercarle da nessuna parte
const dateCliccabili = t => `<span class="data-viaggio" data-date="${t.id}" data-da="${t.start_date ? iso(t.start_date) : ''}" data-a="${t.end_date ? iso(t.end_date) : ''}" title="Tocca per cambiare le date">${dateViaggio(t)}</span>`;
function dateForm(trip, dopo) {
  modal(`<h2>Date del viaggio</h2><p class="small muted">Gli allenamenti che cadono in queste date si agganciano da soli al viaggio.</p>
    <form id="f" class="stack" style="margin-top:12px">
      <div class="form-grid"><div><label class="f">Inizio</label><input type="date" name="start_date" value="${trip.start_date ? iso(trip.start_date) : ''}"></div>
        <div><label class="f">Fine</label><input type="date" name="end_date" value="${trip.end_date ? iso(trip.end_date) : ''}"></div></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        if (d.end_date && d.start_date && d.end_date < d.start_date) return toast('La fine viene prima dell\u2019inizio', true);
        await api('/trips/' + trip.id, { method: 'PUT', body: { start_date: d.start_date || null, end_date: d.end_date || null } });
        close(); toast('Date aggiornate'); (dopo || render)();
      });
    });
}

// La durata in giorni: la prima e l'ultima giornata contano tutt'e due, perche'
// un viaggio che parte e torna lo stesso giorno e' comunque un giorno.
const giorniViaggio = t => {
  if (!t.start_date) return 0;
  const da = new Date(iso(t.start_date)), a = new Date(iso(t.end_date || t.start_date));
  const g = Math.round((a - da) / 86400000) + 1;
  return g > 0 && g < 4000 ? g : 0;
};

// La forma dell'itinerario disegnata dai punti delle tappe: fa da copertina
// finche' il viaggio non ha foto. Le longitudini si stringono verso i poli,
// altrimenti alle nostre latitudini ogni percorso sembrerebbe piu' largo di
// quanto e'.
function rottaSvg(punti) {
  const p = (punti || []).filter(x => Number.isFinite(x?.[0]) && Number.isFinite(x?.[1]));
  if (p.length < 2) return '';
  const k = Math.cos(p.reduce((a, x) => a + x[0], 0) / p.length * Math.PI / 180) || 1;
  const xs = p.map(x => x[1] * k), ys = p.map(x => -x[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const L = 100, A = 56, orlo = 12;
  const larg = x1 - x0, alt = y1 - y0;
  if (!(larg > 1e-9) && !(alt > 1e-9)) return '';
  const s = Math.min((L - orlo * 2) / (larg || 1e-9), (A - orlo * 2) / (alt || 1e-9));
  const dx = (L - larg * s) / 2, dy = (A - alt * s) / 2;
  const q = xs.map((x, i) => [+((x - x0) * s + dx).toFixed(1), +((ys[i] - y0) * s + dy).toFixed(1)]);
  return `<svg class="rotta" viewBox="0 0 ${L} ${A}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <polyline points="${q.map(a => a.join(',')).join(' ')}"/>
    <circle class="via" cx="${q[0][0]}" cy="${q[0][1]}" r="2.4"/>
    <circle class="meta" cx="${q[q.length - 1][0]}" cy="${q[q.length - 1][1]}" r="2.4"/></svg>`;
}

// L'itinerario in una riga sola. Il rientro a casa non si scrive: in un giro che
// parte e torna dallo stesso posto quel nome sta gia' in testa, e lo spazio serve
// ai posti dove si e' stati davvero. Se restano troppi nomi, si tengono i due
// capi e in mezzo si dice quanti se ne saltano.
const itinerario = mete => {
  if (!mete?.length) return '';
  const andata = mete.length > 2 && mete[0] === mete[mete.length - 1] ? mete.slice(0, -1) : mete;
  const m = andata.length > 4 ? [andata[0], `+${andata.length - 2} mete`, andata[andata.length - 1]] : andata;
  return `<div class="itinerario" title="${esc(mete.join(' \u2192 '))}">${m.map(esc).join(' <i>\u2192</i> ')}</div>`;
};

async function viewTrips() {
  const trips = await api('/trips');
  const open = trips.filter(t => t.status === 'open');
  const bozze = trips.filter(t => t.status === 'bozza');
  const closed = trips.filter(t => t.status !== 'open' && t.status !== 'bozza');
  const card = t => {
    const g = giorniViaggio(t);
    return `<a class="viaggio${t.status === 'open' ? ' in-corso' : ''}" href="#/trip/${t.id}">
      <div class="copertina">${t.cover ? `<img src="/uploads/${esc(t.cover)}" loading="lazy" alt="" style="${stileRitaglio(t.cover_crop)}" data-grande="/uploads/${esc(t.cover)}" data-didascalia="${esc(nomeViaggio(t))}" title="Tocca la foto per ingrandirla">` : rottaSvg(t.rotta) || '<span class="senza">🚐</span>'}
        <span class="badge ${t.status}">${nomeStato(t)}</span>${t.cover_id ? `<button class="ritaglia" data-ritaglia-cover="${t.cover_id}" data-file="${esc(t.cover)}" title="Scegli che parte della foto si vede">\u2702\ufe0f</button>` : ''}</div>
      <div class="corpo">
        <div class="title">${esc(nomeViaggio(t))}</div>
        <div class="meta">${dateCliccabili(t)}${g ? ` · ${g} giorn${g === 1 ? 'o' : 'i'}` : ''}</div>
        ${itinerario(t.mete)}
        <div class="numeri">
          <span title="Km in camper">🛣️ ${num(t.km, 0)}</span>
          <span title="${t.n_legs === 1 ? 'Una tappa' : t.n_legs + ' tappe'}">📍 ${t.n_legs}</span>
          ${t.n_photos ? `<span title="Foto">📷 ${t.n_photos}</span>` : ''}
          ${t.n_workouts ? `<span title="Allenamenti">🥾 ${t.n_workouts}</span>` : ''}
          <b>${eur(t.total)}</b></div></div></a>`;
  };
  // I viaggi conclusi si raggruppano per anno: quando saranno tanti, l'anno e'
  // il primo appiglio per ritrovare quello che si sta cercando
  const perAnno = new Map();
  closed.forEach(t => {
    const anno = (t.start_date || t.created_at || '').slice(0, 4) || '—';
    if (!perAnno.has(anno)) perAnno.set(anno, []);
    perAnno.get(anno).push(t);
  });
  const totKm = trips.reduce((a, t) => a + t.km, 0), totSp = trips.reduce((a, t) => a + t.total, 0);
  const totGg = trips.reduce((a, t) => a + giorniViaggio(t), 0);
  $('#app').innerHTML = layout(`
    <div class="row between" style="margin-bottom:16px"><h1>I tuoi viaggi</h1><div class="row"><button class="btn" id="carlock">📡 Importa CarLock</button><button class="btn primary" id="new">＋ Nuovo viaggio</button></div></div>
    <div class="tiles" style="margin-bottom:18px">
      <div class="tile accent"><div class="label">Viaggi</div><div class="value">${trips.length}</div><div class="sub">${open.length ? open.length + ' in corso' : 'nessuno in corso'}</div></div>
      <div class="tile"><div class="label">Giorni in viaggio</div><div class="value">${num(totGg, 0)}</div><div class="sub">${trips.length ? num(totGg / trips.length, 1) + ' a viaggio' : ''}</div></div>
      <div class="tile"><div class="label">Km in camper</div><div class="value">${num(totKm, 0)}</div><div class="sub">~${num(totKm / (settings.vehicle?.km_per_liter || 10), 0)} litri</div></div>
      <div class="tile"><div class="label">Spesa totale</div><div class="value">${eur(totSp)}</div><div class="sub">${totKm ? eur(totSp / totKm) + '/km' : ''}</div></div>
    </div>
    ${open.length ? `<div class="section"><div class="anno">In corso</div><div class="viaggi">${open.map(card).join('')}</div></div>` : ''}
    ${bozze.length ? `<div class="section"><div class="anno">\ud83e\uddf0 In costruzione \u00b7 <span>${bozze.length} viagg${bozze.length === 1 ? 'io' : 'i'} che stiamo preparando</span></div><div class="viaggi">${bozze.map(card).join('')}</div></div>` : ''}
    ${closed.length
      ? [...perAnno.entries()].map(([anno, lista]) => `<div class="section"><div class="anno">${esc(anno)} · <span>${lista.length} viagg${lista.length === 1 ? 'io' : 'i'}</span></div><div class="viaggi">${lista.map(card).join('')}</div></div>`).join('')
      : open.length ? '' : '<div class="card"><div class="empty">Nessun viaggio.<br>Crea il primo e aggiungi le tappe: distanze, gasolio e pedaggi si calcolano da soli.</div></div>'}`);
  $('#new').onclick = () => tripForm();
  $('#carlock').onclick = () => carlockImport(null, open);
  // Le forbici sulla copertina: l'inquadratura si sceglie dove la si vede
  $('main')?.addEventListener('click', safe(e => {
    const b = e.target.closest('[data-ritaglia-cover]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const t = trips.find(x => x.cover_id === +b.dataset.ritagliaCover);
    if (t) ritagliaFoto({ id: t.cover_id, filename: t.cover, crop: t.cover_crop }, render);
  }));
}

function tripForm(t = null) {
  const v = settings.vehicle || {};
  // Il percorso si disegna solo alla nascita del viaggio: dopo, le tappe si
  // modificano una per una, che e' piu' preciso che rifare tutto
  const punti = { partenza: null, arrivo: null, tappe: [] };
  let varianti = [], scelta = null, mappa = null;
  const sezionePercorso = t ? '' : `
    <div class="card" style="padding:12px;margin-top:4px">
      <div class="row between"><b class="small">\ud83d\uddfa\ufe0f Percorso</b><span class="small muted">facoltativo</span></div>
      <div class="row" style="gap:6px;align-items:flex-end;margin-top:8px">
        <div class="grow"><label class="f">Arrivi da Google Maps</label><input id="p-link" placeholder="Incolla qui il link delle indicazioni" autocomplete="off"></div>
        <button type="button" class="btn sm" id="p-incolla" title="Prendi quello che hai copiato">\ud83d\udccb Incolla</button></div>
      <div class="row between small" style="margin-top:4px"><a class="btn sm" href="https://www.google.com/maps" target="_blank" rel="noopener">\ud83d\uddfa\ufe0f Apri Google Maps</a><span class="muted" id="p-esito-link"></span></div>
      <div style="margin-top:8px"><label class="f">Si parte da</label><input id="p-da" placeholder="Cerca citt\u00e0 o luogo\u2026" autocomplete="off"></div>
      <div id="p-tappe" style="margin-top:8px"></div>
      <button type="button" class="btn sm" id="p-piu" style="margin-top:8px">\uff0b Tappa intermedia</button>
      <div style="margin-top:8px"><label class="f">Si arriva a</label><input id="p-a" placeholder="Cerca citt\u00e0 o luogo\u2026" autocomplete="off"></div>
      <button type="button" class="btn primary sm" id="p-calcola" style="margin-top:10px">Calcola il percorso</button>
      <div id="p-esiti" style="margin-top:10px"></div>
      <div id="p-mappa" class="map sm" style="display:none;margin-top:10px"></div>
    </div>`;
  modal(`<h2>${t ? 'Modifica viaggio' : 'Nuovo viaggio'}</h2><form id="f" class="stack" style="margin-top:14px">
    <div><label class="f">Titolo</label><input name="title" required value="${esc(t?.title || '')}" placeholder="Es. Giro della Puglia"></div>
    <div class="form-grid"><div><label class="f">Inizio</label><input type="date" name="start_date" value="${t?.start_date ? iso(t.start_date) : today()}"></div><div><label class="f">Fine</label><input type="date" name="end_date" value="${t?.end_date ? iso(t.end_date) : ''}"></div></div>
    ${t ? '' : `<label class="riga-scelta"><input type="checkbox" name="stato" value="bozza"> \ud83e\uddf0 Ancora da organizzare
      <span class="small muted">Finisce fra i viaggi in costruzione: ci si mette dentro il materiale, e quando si parte basta un tocco.</span></label>`}
    <div class="form-grid"><div><label class="f">Prezzo gasolio \u20ac/l</label><input type="number" step="0.001" name="fuel_price" value="${t?.fuel_price ?? v.fuel_price ?? 1.75}"></div><div><label class="f">Consumo km/l</label><input type="number" step="0.1" name="km_per_liter" value="${t?.km_per_liter ?? v.km_per_liter ?? 10}"></div></div>
    ${sezionePercorso}
    <div><label class="f">Note</label><textarea name="notes" rows="2">${esc(t?.notes || '')}</textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">${t ? 'Salva' : 'Crea'}</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      if (!t) {
        geoInput($('#p-da', el), r => punti.partenza = r);
        geoInput($('#p-a', el), r => punti.arrivo = r);
        const disegnaTappe = () => {
          $('#p-tappe', el).innerHTML = punti.tappe.map((p, i) => `<div class="row" style="gap:6px;margin-top:8px;align-items:flex-end">
            <div class="grow"><label class="f">Passando per</label><input class="p-tappa" data-i="${i}" value="${esc(p?.name || '')}" placeholder="Cerca citt\u00e0 o luogo\u2026" autocomplete="off"></div>
            <button type="button" class="btn ghost danger icon" data-rm="${i}" title="Togli">\ud83d\uddd1</button></div>`).join('');
          $$('.p-tappa', el).forEach(inp => geoInput(inp, r => { punti.tappe[+inp.dataset.i] = r; }));
          $$('[data-rm]', el).forEach(b => b.onclick = () => { punti.tappe.splice(+b.dataset.rm, 1); disegnaTappe(); });
        };
        $('#p-piu', el).onclick = () => { punti.tappe.push(null); disegnaTappe(); };

        // Un itinerario gia' pensato su Google Maps non si riscrive a mano: si
        // incolla, e i suoi punti si sistemano da soli nei campi qui sotto.
        // Non c'e' un tasto «leggi»: con un collegamento incollato non si puo'
        // fare altro che leggerlo.
        const campoLink = $('#p-link', el), esitoLink = $('#p-esito-link', el);
        let lettoOra = '';
        const leggiLink = safe(async testo => {
          const link = linkNelTesto(testo) || String(testo || '').trim();
          if (!link || link === lettoOra) return;
          lettoOra = link;
          esitoLink.textContent = 'leggo\u2026';
          let r;
          try { r = await api('/maps/percorso', { method: 'POST', body: { url: link } }); }
          catch (e) { esitoLink.textContent = e.message; return; }
          if (r.punti.length < 2) { esitoLink.textContent = 'In quel collegamento c\u2019\u00e8 un punto solo'; return; }
          punti.partenza = r.punti[0];
          punti.arrivo = r.punti[r.punti.length - 1];
          punti.tappe = r.punti.slice(1, -1);
          $('#p-da', el).value = punti.partenza.name;
          $('#p-a', el).value = punti.arrivo.name;
          disegnaTappe();
          esitoLink.innerHTML = `<b>${r.punti.length} punti</b>${r.non_trovati.length ? ` \u00b7 non riconosciuti: ${esc(r.non_trovati.join(', '))}` : ''}`;
          $('#p-calcola', el).click();
        });
        campoLink.addEventListener('paste', () => setTimeout(() => leggiLink(campoLink.value), 0));
        let attesaLink;
        campoLink.addEventListener('input', () => { clearTimeout(attesaLink); attesaLink = setTimeout(() => leggiLink(campoLink.value), 700); });
        $('#p-incolla', el).onclick = safe(async () => {
          let testo = '';
          try { testo = await navigator.clipboard.readText(); }
          catch { return toast('Il browser non mi lascia leggere gli appunti: incolla nel campo con \u2318V', true); }
          campoLink.value = linkNelTesto(testo) || testo.trim();
          leggiLink(campoLink.value);
        });

        const mostraScelta = () => {
          $$('[data-variante]', el).forEach(c => c.classList.toggle('scelto', c.dataset.variante === scelta?.chiave));
          const tracce = (scelta?.tratte || []).flatMap(x => x.geometry || []);
          const m = $('#p-mappa', el);
          if (!tracce.length) { m.style.display = 'none'; return; }
          m.style.display = 'block';
          if (!mappa) mappa = makeMap(m, { simple: true });
          else mappa.eachLayer(l => l instanceof L.Polyline && mappa.removeLayer(l));
          mappa.invalidateSize();
          mappa.fitBounds(L.polyline(tracce, { color: '#0f766e', weight: 4 }).addTo(mappa).getBounds(), { padding: [10, 10] });
        };

        $('#p-calcola', el).onclick = safe(async () => {
          const lista = [punti.partenza, ...punti.tappe, punti.arrivo].filter(p => p?.lat);
          if (lista.length < 2) return toast('Scegli partenza e arrivo dai suggerimenti', true);
          $('#p-esiti', el).innerHTML = '<span class="small muted">Calcolo\u2026</span>';
          const fd = new FormData($('#f', el));
          const r = await api('/route/opzioni', { method: 'POST', body: { punti: lista, km_per_liter: fd.get('km_per_liter'), fuel_price: fd.get('fuel_price') } });
          varianti = r.varianti; scelta = varianti[0] || null;
          $('#p-esiti', el).innerHTML = varianti.map(x => `<div class="variante" data-variante="${x.chiave}">
              <div class="row between"><b>${esc(x.nome)}</b><b>${num(x.distance_km)} km</b></div>
              <div class="small muted">${dur(x.duration_min * 60)} di guida \u00b7 ${num(x.litri)} l \u00b7 <b>${eur(x.gasolio)}</b> di gasolio${x.stimato ? ' \u00b7 \u26a0\ufe0f distanza stimata' : ''}</div>
              <div class="small" style="margin-top:4px"><a class="btn sm" href="${mapsPerVariante(lista[0], lista[lista.length - 1], x, lista.slice(1, -1))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">\ud83d\uddfa\ufe0f Vedi su Google Maps</a></div>
              ${x.pedaggio_km == null ? '' : x.pedaggio_km > 0
                ? `<div class="small muted">\ud83d\udee3\ufe0f ${num(x.pedaggio_km)} km a pedaggio \u00b7 <b>${eur(x.pedaggio)}</b> stimati \u00b7 totale <b>${eur(x.gasolio + x.pedaggio)}</b></div>`
                : '<div class="small muted">\ud83d\udee3\ufe0f nessun tratto a pedaggio</div>'}
            </div>`).join('')
            + (r.pedaggi_evitabili
              ? `<p class="small muted" style="margin-top:8px">I chilometri a pedaggio sono quelli veri del percorso; il costo \u00e8 una stima a ${eur(r.toll_per_km)} al km, che cambi nelle impostazioni del mezzo. Quando arriva il conto vero, correggi la spesa e non viene pi\u00f9 ricalcolata.</p>`
              : '<p class="small muted" style="margin-top:8px">La variante senza pedaggi richiede una chiave OpenRouteService: senza, resta il solo percorso pi\u00f9 rapido.</p>');
          $$('[data-variante]', el).forEach(c => c.onclick = () => { scelta = varianti.find(x => x.chiave === c.dataset.variante); mostraScelta(); });
          mostraScelta();
        });
      }
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        if (!t && scelta) body.percorso = scelta;
        if (body.stato !== 'bozza') delete body.stato;
        const r = t ? await api('/trips/' + t.id, { method: 'PUT', body }) : await api('/trips', { method: 'POST', body });
        close();
        if (r.tappe_create) toast(`Viaggio creato con ${r.tappe_create} tappe`);
        location.hash = '#/trip/' + r.id;
        if (t) render();
      });
    });
}

// La copertina si sceglie fra tutte le foto del viaggio, comprese quelle delle
// soste: la foto buona e' dove capita, non per forza nella raccolta.
// Il ritaglio non taglia niente: dice quale rettangolo della foto si vede nella
// copertina. Il file resta intero, e l'inquadratura si rifa' quando si vuole.
// Il rettangolo ha le stesse proporzioni del riquadro della scheda, percio'
// basta allargarlo o stringerlo: quello che c'e' dentro ci finisce preciso.
const stileRitaglio = c => {
  if (!c) return '';
  if (c.w > 0 && c.h > 0) return `position:absolute;left:${(-c.x * 100 / c.w).toFixed(2)}%;top:${(-c.y * 100 / c.h).toFixed(2)}%;`
    + `width:${(100 / c.w).toFixed(2)}%;height:${(100 / c.h).toFixed(2)}%;max-width:none;object-fit:fill`;
  // Le prime inquadrature erano un punto e un ingrandimento: restano buone
  return `object-position:${+c.px}% ${+c.py}%;transform-origin:${+c.px}% ${+c.py}%;--zoom:${+c.z || 1}`;
};

const PROPORZIONE_COPERTINA = 16 / 9;
const MIN_LATO = 48;   // pixel: sotto questa misura il riquadro non si afferra piu'

// Si sceglie l'inquadratura sulla foto intera: il riquadro si sposta
// trascinandolo e si cambia di misura dagli angoli o dai lati. Le proporzioni
// restano quelle della copertina - altrimenti la foto ci entrerebbe schiacciata.
function ritagliaFoto(foto, dopo) {
  const MANIGLIE = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  modal(`<h2>Che parte si vede</h2>
    <p class="small muted">Sposta il riquadro trascinandolo, e cambialo di misura dagli angoli o dai lati: quello che resta dentro e\u2019 la copertina. La foto non viene tagliata.</p>
    <div class="ritaglio-area" id="area"><img id="rf" src="/uploads/${esc(foto.filename)}" alt="" draggable="false">
      ${['su', 'giu', 'sx', 'dx'].map(v => `<div class="velo" id="v-${v}"></div>`).join('')}
      <div class="ritaglio-box" id="box">${MANIGLIE.map(m => `<i data-maniglia="${m}" class="m-${m}"></i>`).join('')}</div></div>
    <div class="row between"><button type="button" class="btn ghost" id="rvia">Rimetti intera</button>
      <div class="row"><button type="button" class="btn" data-x>Annulla</button><button type="button" class="btn primary" id="rok">Salva</button></div></div>`,
    (el, close) => {
      const area = $('#area', el), img = $('#rf', el), riquadro = $('#box', el);
      let A = { w: 0, h: 0 }, B = { x: 0, y: 0, w: 0, h: 0 };

      // Lo spento intorno al riquadro sono quattro bande, non un'ombra larga
      // quanto lo schermo: un'ombra obbliga a tagliare quello che esce dal
      // telaio, e a farne le spese erano le maniglie di sopra e di sotto, che
      // sul bordo della foto restavano mezze fuori e non si riuscivano a prendere
      const banda = (id, x, y, w, h) => {
        const e = $(`#v-${id}`, el);
        e.style.left = `${Math.max(0, x)}px`; e.style.top = `${Math.max(0, y)}px`;
        e.style.width = `${Math.max(0, w)}px`; e.style.height = `${Math.max(0, h)}px`;
      };
      const disegna = () => {
        riquadro.style.left = `${B.x}px`; riquadro.style.top = `${B.y}px`;
        riquadro.style.width = `${B.w}px`; riquadro.style.height = `${B.h}px`;
        banda('su', 0, 0, A.w, B.y);
        banda('giu', 0, B.y + B.h, A.w, A.h - B.y - B.h);
        banda('sx', 0, B.y, B.x, B.h);
        banda('dx', B.x + B.w, B.y, A.w - B.x - B.w, B.h);
      };
      // Il riquadro resta dentro la foto e non si schiaccia: prima la misura,
      // poi la posizione
      const sistema = r => {
        r.w = Math.max(MIN_LATO, Math.min(r.w, A.w, A.h * PROPORZIONE_COPERTINA));
        r.h = r.w / PROPORZIONE_COPERTINA;
        r.x = Math.max(0, Math.min(r.x, A.w - r.w));
        r.y = Math.max(0, Math.min(r.y, A.h - r.h));
        return r;
      };
      const parti = () => {
        const r = img.getBoundingClientRect();
        if (!r.width) return;
        A = { w: r.width, h: r.height };
        const c = foto.crop;
        B = c?.w > 0
          ? sistema({ x: c.x * A.w, y: c.y * A.h, w: c.w * A.w, h: c.h * A.h })
          : sistema({ x: 0, y: 0, w: A.w, h: 0 });
        if (!(c?.w > 0)) { B.x = (A.w - B.w) / 2; B.y = (A.h - B.h) / 2; }
        disegna();
      };
      if (img.complete && img.naturalWidth) parti(); else img.onload = parti;
      addEventListener('resize', parti);

      let presa = null;
      area.addEventListener('pointerdown', e => {
        const m = e.target.closest('[data-maniglia]');
        if (!m && !e.target.closest('#box')) return;
        e.preventDefault();
        presa = { m: m?.dataset.maniglia || null, x: e.clientX, y: e.clientY, da: { ...B } };
        area.setPointerCapture(e.pointerId);
      });
      area.addEventListener('pointermove', e => {
        if (!presa) return;
        const dx = e.clientX - presa.x, dy = e.clientY - presa.y, d = presa.da;
        if (!presa.m) { B = sistema({ ...d, x: d.x + dx, y: d.y + dy }); disegna(); return; }
        const m = presa.m;
        // Dai lati comanda quel lato, dagli angoli comanda la larghezza; il
        // resto segue, perche' le proporzioni non si toccano
        let w = m === 'n' || m === 's' ? (d.h + (m === 's' ? dy : -dy)) * PROPORZIONE_COPERTINA
          : d.w + (m.includes('e') ? dx : 0) + (m.includes('w') ? -dx : 0);
        const r = sistema({ x: d.x, y: d.y, w, h: 0 });
        // L'angolo o il lato opposto sta fermo: si tira da una parte sola
        if (m.includes('w')) r.x = d.x + d.w - r.w;
        if (m.includes('n')) r.y = d.y + d.h - r.h;
        if (m === 'n' || m === 's') r.x = d.x + (d.w - r.w) / 2;
        if (m === 'e' || m === 'w') r.y = d.y + (d.h - r.h) / 2;
        B = sistema(r);
        disegna();
      });
      ['pointerup', 'pointercancel'].forEach(ev => area.addEventListener(ev, () => { presa = null; }));

      $('[data-x]', el).onclick = close;
      $('#rvia', el).onclick = safe(async () => { await api(`/photos/${foto.id}/ritaglio`, { method: 'POST', body: {} }); close(); dopo(); });
      $('#rok', el).onclick = safe(async () => {
        if (!A.w) return close();
        await api(`/photos/${foto.id}/ritaglio`, { method: 'POST', body: { x: B.x / A.w, y: B.y / A.h, w: B.w / A.w, h: B.h / A.h } });
        close(); dopo();
      });
    });
}

// Un video sta nella raccolta insieme alle foto. Si riconosce dal tipo che ha
// dichiarato il telefono, o in mancanza di quello dall'estensione del file.
const eVideo = p => /^video\//.test(p?.mime || '') || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(p?.filename || '');
// La faccia di una miniatura: per una foto e' la foto, per un video il primo
// fotogramma, che il browser va a prendere da solo, col segno del play sopra
const facciaMedia = (p, dentro = '') => eVideo(p)
  ? `<video src="/uploads/${esc(p.filename)}#t=0.1" preload="metadata" muted playsinline${dentro}></video><span class="segno-video">\u25b6</span>`
  : `<img src="/uploads/${esc(p.filename)}" loading="lazy" alt=""${dentro}>`;
const datiLente = p => `data-grande="/uploads/${esc(p.filename)}" data-didascalia="${esc(p.caption || '')}"${eVideo(p) ? ' data-video="1"' : ''}`;

const stellaCopertina = (p, scelta) => eVideo(p) ? '' : `<button class="copertina-scelta${scelta === p.id ? ' scelta' : ''}" data-copertina="${p.id}"
  title="${scelta === p.id ? 'E\u2019 la copertina del viaggio \u00b7 tocca per togliere la scelta' : 'Usa come copertina del viaggio'}">${scelta === p.id ? '\u2605' : '\u2606'}</button>`;

// ---------- Foto ----------
// Una foto si guarda grande. Si apre sopra la pagina, si scorre con le frecce o
// col dito quando ce n'e' piu' d'una, e si chiude toccando fuori, con la \u2715 o
// con Esc. Sotto la miniatura non si legge niente: e' li' che si va a vedere se
// quella curva era davvero cosi' stretta.
let chiudiLente = null;
function apriLente(foto, i = 0) {
  chiudiLente?.();
  if (!foto.length) return;
  const el = document.createElement('div');
  el.className = 'lente';
  el.innerHTML = `<button class="chiudi" title="Chiudi (Esc)">\u2715</button>
    ${foto.length > 1 ? '<button class="passo prima" title="Precedente">\u2039</button><button class="passo dopo" title="Successiva">\u203a</button>' : ''}
    <figure><img alt=""><video controls playsinline hidden></video><figcaption></figcaption></figure>`;
  document.body.appendChild(el);
  const scorrimento = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const img = $('img', el), filmato = $('video', el), didascalia = $('figcaption', el);
  const mostra = n => {
    i = (n + foto.length) % foto.length;
    // Un video si apre nella stessa cornice, ma con i suoi comandi: fermarlo
    // passando alla foto dopo e' il minimo, altrimenti continua a parlare
    filmato.pause();
    const video = !!foto[i].video;
    img.hidden = video; filmato.hidden = !video;
    if (video) { filmato.src = foto[i].src; filmato.play().catch(() => {}); } else img.src = foto[i].src;
    didascalia.textContent = [foto[i].caption, foto.length > 1 ? `${i + 1} di ${foto.length}` : ''].filter(Boolean).join(' \u00b7 ');
  };
  const tasti = e => {
    if (e.key === 'Escape') chiudi();
    else if (e.key === 'ArrowLeft') mostra(i - 1);
    else if (e.key === 'ArrowRight') mostra(i + 1);
  };
  const chiudi = () => {
    document.removeEventListener('keydown', tasti);
    document.body.style.overflow = scorrimento;
    el.remove();
    chiudiLente = null;
  };
  chiudiLente = chiudi;
  document.addEventListener('keydown', tasti);
  // Un tocco fuori dalla foto chiude: e' il gesto che viene da se'
  el.addEventListener('click', e => {
    if (e.target.closest('.chiudi')) return chiudi();
    if (e.target.closest('.prima')) return mostra(i - 1);
    if (e.target.closest('.dopo')) return mostra(i + 1);
    if (!e.target.closest('img')) chiudi();
  });
  // Col dito si scorre, come in qualunque raccolta di foto
  let partenza = null;
  el.addEventListener('pointerdown', e => { partenza = e.clientX; });
  el.addEventListener('pointerup', e => {
    if (partenza == null) return;
    const dx = e.clientX - partenza; partenza = null;
    if (Math.abs(dx) > 45 && foto.length > 1) mostra(i + (dx < 0 ? 1 : -1));
  });
  mostra(i);
}

// Le foto da ingrandire si riconoscono dal loro attributo, e si guardano
// insieme a quelle che hanno intorno: la raccolta del viaggio, la striscia di
// una sosta. Una copertina o una foto sulla mappa stanno per conto loro.
document.addEventListener('click', e => {
  const scatto = e.target.closest('[data-grande]');
  if (!scatto) return;
  // Mentre si sceglie quali foto togliere, il tocco serve a spuntarle
  if (scatto.closest('.photos.in-selezione')) return;
  e.preventDefault(); e.stopPropagation();
  const gruppo = scatto.closest('.photos, .foto-sosta');
  const tutte = gruppo ? $$('[data-grande]', gruppo) : [scatto];
  apriLente(tutte.map(x => ({ src: x.dataset.grande, caption: x.dataset.didascalia || '', video: x.dataset.video === '1' })), Math.max(0, tutte.indexOf(scatto)));
});


// Dentro la libreria Foto il browser non puo' pescare: nessuna pagina web puo',
// per come e' fatto il Mac, e non e' una mancanza di questa. Quello che si puo'
// fare e' aprire l'app Foto e prendere gli scatti da li' — trascinandoli nel
// riquadro, oppure copiandoli e incollandoli. Chi preferisce il pannello di
// sistema lo trova sempre: la libreria sta nella sua colonna di sinistra, sotto
// «Media».
const SU_MAC = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '') && !navigator.maxTouchPoints;
const FOTO_PER_VOLTA = 20;  // quante ne accetta il servizio in una richiesta sola
const paionoFoto = f => /^image\//.test(f.type || '') || /\.(jpe?g|png|heic|heif|webp|gif|tiff?)$/i.test(f.name || '');

// Un guasto che resta sullo schermo di chi ci ha provato non lo vede nessun
// altro. Questo lo racconta anche ai log del servizio, dove si puo' leggere.
const VERSIONE = 'v74';
let segnalazioni = 0;
const segnala = (dove, esito, extra = {}) => {
  // Se anche questa chiamata fallisse, il suo fallimento non deve chiamare se
  // stesso: da un guasto solo nascerebbero mille righe di log
  if (segnalazioni++ > 20) return;
  try { api('/diagnostica', { method: 'POST', body: { dove, esito, agente: navigator.userAgent, ...extra } }).catch(() => {}); } catch { }
};
const dettagli = dt => ({
  tipi: [...(dt?.types || [])],
  elementi: [...(dt?.items || [])].map(i => ({ genere: i.kind, tipo: i.type })),
  file: [...(dt?.files || [])].map(f => ({ nome: f.name, tipo: f.type, byte: f.size })),
});

const DA_FOTO = 'Se le hai trascinate dall\u2019app Foto, prova con \u00ab\ud83d\udcf7 Carica\u00bb: nel pannello, la libreria sta nella colonna di sinistra sotto \u00abMedia\u00bb.';

async function caricaFoto(tripId, elenco, extra = {}) {
  const arrivati = [...(elenco || [])];
  const foto = arrivati.filter(paionoFoto);
  if (!foto.length) {
    segnala('niente-da-caricare', `${arrivati.length} file, nessuna immagine`, { file: arrivati.map(f => ({ nome: f.name, tipo: f.type, byte: f.size })) });
    return toast(arrivati.length ? 'Qui dentro non ci sono immagini' : `Il trascinamento non ha portato nessun file. ${DA_FOTO}`, true);
  }
  // Certi trascinamenti promettono il file e consegnano un guscio vuoto: meglio
  // dirlo qui, che lasciar partire una richiesta destinata a non arrivare
  if (foto.every(f => !f.size)) {
    segnala('foto-vuote', `${foto.length} file da zero byte`, { file: foto.map(f => ({ nome: f.name, tipo: f.type, byte: f.size })) });
    return toast(`Le foto sono arrivate vuote. ${DA_FOTO}`, true);
  }

  const didascalia = prompt(foto.length === 1 ? 'Didascalia (facoltativa)' : `Didascalia per queste ${foto.length} foto (facoltativa)`);
  // A gruppi di venti, che e' quanti ne accetta il servizio in una volta: se ne
  // arrivano quaranta dall'app Foto, non se ne perde nessuna per strada
  let caricate = 0;
  for (let i = 0; i < foto.length; i += FOTO_PER_VOLTA) {
    const gruppo = foto.slice(i, i + FOTO_PER_VOLTA);
    const fd = new FormData();
    gruppo.forEach(f => fd.append('photos', f));
    if (didascalia) fd.append('caption', didascalia);
    for (const [k, v] of Object.entries(extra)) if (v != null) fd.append(k, v);
    toast(foto.length > FOTO_PER_VOLTA ? `Carico ${i + gruppo.length} di ${foto.length}\u2026` : 'Caricamento foto\u2026');
    try {
      caricate += (await api(`/trips/${tripId}/photos`, { method: 'POST', body: fd })).length;
    } catch (e) {
      const elenco = gruppo.map(f => ({ nome: f.name, tipo: f.type, byte: f.size }));
      console.error('foto non caricate:', elenco, e);
      segnala('caricamento', e.message, { file: elenco });
      // Un avviso che scompare in quattro secondi non si fa leggere: un guasto
      // si guarda con calma, e si deve poter riferire a qualcuno
      modal(`<h2>Le foto non sono state caricate</h2>
        <p class="small">Il servizio ha risposto: <b>${esc(e.message)}</b></p>
        <p class="small muted">${DA_FOTO}</p>
        <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-x>Ok</button></div>`,
        (el, close) => { $('[data-x]', el).onclick = close; });
      return;
    }
  }
  if (!caricate) toast(`Il servizio non ha accettato ${foto.length === 1 ? 'la foto' : 'nessuna delle foto'}. ${DA_FOTO}`, true);
  else if (caricate < foto.length) toast(`Caricate ${caricate} foto su ${foto.length}: le altre non sono state accettate`, true);
  else toast(foto.length === 1 ? 'Foto caricata' : `${foto.length} foto caricate`);
  restaQui();
}

// Chi si allena in un viaggio, e con che tratto si disegna la sua traccia: in
// due si esce insieme, ma le uscite sono di ciascuno, e sulla mappa il colore
// dice la disciplina - a dire chi e' resta il tratto.
const TRATTI = [['4 6', 'dashed'], ['1 6', 'dotted'], ['12 4 2 4', 'dashed'], ['8 3', 'dashed']];
const atletiDi = ws => [...new Set((ws || []).map(w => w.athlete).filter(Boolean))].sort();
const trattoFra = (nome, atleti) => TRATTI[Math.max(0, atleti.indexOf(nome)) % TRATTI.length];

// La legenda sotto la mappa e i tasti per rivedere. Stanno qui, fuori dalla
// pagina del viaggio, perche' li usa anche chi il viaggio lo guarda da fuori.
function legendaViaggio(d, opz = {}) {
  const { legs, workouts, photos } = d;
  const atletiDelViaggio = atletiDi(workouts);
  const trattoDi = nome => trattoFra(nome, atletiDelViaggio);
  const conTracciati = opz.tracciati !== false;
        const discipline = [...new Set(workouts.filter(w => w.has_track || w.track).map(w => w.sport).filter(Boolean))].sort();
        const conPosto = photos.filter(p => p.lat != null).length;
        if (!legs.length && !discipline.length && !conPosto && !workouts.length) return '';
        return `<div class="legenda-mappa">
          ${!conTracciati ? '' : `<span class="rivedi-tasti">${legs.length ? `<button class="btn sm primary" data-rivedi="camper">\u25b6 \ud83d\ude90 Rivedi il camper</button>` : ''}
            ${atletiDelViaggio.filter(nome => workouts.some(w => w.athlete === nome && w.track?.length > 1))
              .map((nome, i) => `<button class="btn sm" data-rivedi="atleta:${esc(nome)}">\u25b6 ${ICO_SCARPA(coloreAtleta(nome, i))} ${esc(nome)}</button>`).join('')}</span>`}
          <span class="small muted" style="width:100%">Tocca una voce per vedere solo quella, ingrandita sul suo percorso. Toccala di nuovo per rivedere tutto.</span>
          ${legs.some(inCamper) ? `<span class="voce" data-strato="camper"><i style="background:${COLORE_CAMPER}"></i>In camper</span>` : ''}
          ${legs.some(l => !inCamper(l)) ? `<span class="voce" data-strato="altri"><i class="tratteggio" style="border-top-color:${COLORE_ALTRI_MEZZI}"></i>${[...new Set(legs.filter(l => !inCamper(l)).map(l => MEZZI[mezzoDi(l)][0] + ' ' + MEZZI[mezzoDi(l)][1]))].join(', ')}</span>` : ''}
          ${discipline.map(d => `<span class="voce" data-strato="sport:${esc(d)}"><i class="tratteggio" style="border-top-color:${coloreSport(d)}"></i>${sportIco(d)} ${esc(d)}</span>`).join('')}
          ${atletiDelViaggio.length > 1 ? '<span class="stacco"></span>' + atletiDelViaggio.map(nome => `<span class="voce" data-strato="atleta:${esc(nome)}"><i class="tratteggio" style="border-top-color:var(--muted);border-top-style:${trattoDi(nome)[1]}"></i>${esc(nome)}</span>`).join('') : ''}
          ${conPosto ? `<span class="voce" data-strato="foto">\ud83d\udcf7 ${conPosto} fot${conPosto === 1 ? 'o' : 'o'} nel punto dello scatto</span>` : ''}
        </div>`;
}

// La mappa del viaggio: le tappe, le tracce degli allenamenti, le foto nel
// punto dello scatto, la legenda che accende una cosa per volta e i tasti per
// rivedere. E' una sola per chi il viaggio lo fa e per chi lo guarda da fuori:
// quello che si aggiusta qui, si aggiusta per tutti e due.
function mappaDelViaggio(el, d, opz = {}) {
  const { trip, legs, workouts, photos, totals } = d;
  const soste = d.soste || [];
  const atletiDelViaggio = atletiDi(workouts);
  const trattoDi = nome => trattoFra(nome, atletiDelViaggio);
  const ospite = !!opz.ospite;
  const conSpese = opz.spese !== false;
  const map = makeMap(el);
  const bounds = [];
  // Sulla mappa di un viaggio lungo si accavallano la strada del camper, le
  // tracce degli allenamenti e le foto: separarle e' l'unico modo di guardarne
  // una. Ogni voce della legenda e' uno strato che si spegne e si riaccende.
  const strati = {}, estensioni = {};
  const strato = chiave => (strati[chiave] ||= L.layerGroup().addTo(map));
  // I punti di ogni strato si tengono da parte: sono quelli su cui la mappa si
  // stringe quando si chiede di vedere solo quello
  const segna = (chiave, punti) => { (estensioni[chiave] ||= []).push(...punti); };
  // Un allenamento sta nello strato della sua disciplina e del suo atleta
  // insieme: cosi' «Escursione» chiama quelle di tutti e due, e «Metz» chiama
  // tutto quello che ha fatto lui, senza doverli disegnare due volte
  const chiaveSport = w => `sport:${w.sport}|${w.athlete || ''}`;
  const gruppiDi = sel => {
    if (sel.startsWith('atleta:')) { const chi = sel.slice(7); return Object.keys(strati).filter(k => k.startsWith('sport:') && k.slice(k.indexOf('|') + 1) === chi); }
    if (sel.startsWith('sport:')) { const d = sel.slice(6); return Object.keys(strati).filter(k => k.startsWith(`sport:${d}|`)); }
    return strati[sel] ? [sel] : [];
  };
  legs.forEach((l, i) => {
    const g = tragittoDisegnato(l);
    // Il traghetto e l'aereo non seguono la strada: linea dritta e tratteggiata,
    // perche' quella non e' una strada che si puo' percorrere
    const suGomma = inCamper(l);
    const suoStrato = strato(suGomma ? 'camper' : 'altri');
    L.polyline(g, suGomma ? { color: COLORE_CAMPER, weight: 5, opacity: .85 }
      : { color: COLORE_ALTRI_MEZZI, weight: 4, opacity: .9, dashArray: '10 8' })
      .addTo(suoStrato).bindPopup(`<b>${suGomma ? '' : MEZZI[mezzoDi(l)][0] + ' '}Tappa ${i + 1}</b><br>${esc(l.from_name.split(',')[0])} → ${esc(l.to_name.split(',')[0])}<br>${num(l.distance_km)} km · ${dur(l.duration_min * 60)}${l.compagnia || l.codice ? `<br>${esc([l.compagnia, l.codice].filter(Boolean).join(' '))}` : ''}${l.start_time ? `<br>${esc(l.start_time)}–${esc(l.end_time || '')}` : ''}`);
    L.marker([l.from_lat, l.from_lon], { icon: pin('#0f766e', i + 1) }).addTo(suoStrato).bindPopup(esc(l.from_name));
    if (i === legs.length - 1) L.marker([l.to_lat, l.to_lon], { icon: pin('#dc2626', '🏁') }).addTo(suoStrato).bindPopup(esc(l.to_name));
    g.forEach(p => bounds.push(p));
    segna(suGomma ? 'camper' : 'altri', g);
    (l.pois?.stops || []).forEach(s => L.marker([s.lat, s.lon], { icon: dotIcon('#f59e0b', s.kind === 'area_sosta' ? '🅿️' : s.kind === 'campeggio' ? '⛺' : '🚰') }).addTo(suoStrato).bindPopup(`<b>${esc(s.name)}</b><br>${s.kind.replace('_', ' ')}${s.fee ? '<br>Tariffa: ' + esc(s.fee) : ''}${s.website ? `<br><a href="${esc(s.website)}" target="_blank">sito</a>` : ''}`));
  });
  // Un allenamento senza traccia \u2014 il nuoto in piscina, la camminata sul tapis
  // \u2014 non ha coordinate proprie. Il posto dove e' successo pero' si sa: e' dove
  // si era quel giorno, la sosta in cui si dormiva o l'ultima meta raggiunta.
  // E' una posizione dedotta, non misurata, e si vede che lo e'.
  const dovEravamo = w => {
    const g = iso(new Date(w.started_at));
    const s = soste.find(x => x.lat != null && x.from_date && g >= iso(x.from_date) && g <= iso(x.to_date || x.from_date));
    if (s) return { lat: s.lat, lon: s.lon, dove: s.name };
    const arrivo = legs.filter(l => l.date && l.to_lat != null && iso(l.date) <= g).pop();
    return arrivo ? { lat: arrivo.to_lat, lon: arrivo.to_lon, dove: arrivo.to_name.split(',')[0] } : null;
  };
  let dedotti = 0;
  workouts.forEach(w => {
    const traccia = w.track?.length ? w.track.map(x => [x[0], x[1]]) : null;
    const colore = coloreSport(w.sport);
    const km = num((w.distance_m || 0) / 1000);
    let punto = null, circa = false, dove = '';
    if (traccia) {
      L.polyline(traccia, { color: colore, weight: 3.5, opacity: .95, dashArray: trattoDi(w.athlete)[0] }).addTo(strato(chiaveSport(w)))
        .bindPopup(`<b>${sportIco(w.sport)} ${esc(w.name || w.sport || 'Allenamento')}</b><br>${esc(w.athlete || '')} \u00b7 ${fdt(w.started_at)} \u00b7 ${km} km \u00b7 ${dur(w.duration_s)}${ospite ? '' : `<br><a href="#/allenamento/${w.id}">Apri l\u2019allenamento</a>`}`);
      // L'icona sta a meta' del giro: sull'attivita', e lontana dai segnaposto
      // delle tappe, che stanno quasi sempre dove si e' partiti
      punto = traccia[Math.floor(traccia.length / 2)];
      // La traccia conta per l'inquadratura: una camminata fuori dal tragitto
      // del camper finirebbe fuori schermo
      const passo = Math.max(1, Math.floor(traccia.length / 20));
      for (let i = 0; i < traccia.length; i += passo) bounds.push(traccia[i]);
      segna(chiaveSport(w), traccia);
    } else {
      const l = dovEravamo(w);
      if (!l) return;
      punto = [l.lat, l.lon]; circa = true; dove = l.dove; dedotti++;
    }
    L.marker(punto, { icon: pinSport(w.sport, circa), zIndexOffset: 300, riseOnHover: true })
      .addTo(strato(chiaveSport(w)))
      .bindTooltip(`<b>${esc(w.name || w.sport || 'Allenamento')}</b><br>${fdt(w.started_at)} \u00b7 ${esc(w.athlete)}${w.distance_m ? ' \u00b7 ' + km + ' km' : ''} \u00b7 ${dur(w.duration_s)}${circa ? `<br><i>senza traccia \u00b7 ${esc(dove)}</i>` : ''}`, { direction: 'top', offset: [0, -14] })
      .on('click', () => { if (!ospite) location.hash = '#/allenamento/' + w.id; });
    if (circa) bounds.push(punto);
    segna(chiaveSport(w), [punto]);
  });
  // La legenda si scrive prima di sapere quanti allenamenti finiranno in un posto
  // dedotto: il conto vero si sa solo dopo averli messi, e si aggiunge qui
  if (dedotti) $('.legenda-mappa')?.insertAdjacentHTML('beforeend',
    `<span class="voce"><i class="cerchio-circa"></i>${dedotti} senza traccia, ${dedotti === 1 ? 'segnato' : 'segnati'} dove eravate</span>`);

  // Una foto che porta con se' le coordinate sta sulla mappa nel punto esatto in
  // cui e' stata scattata, e ci sta con la propria faccia: un puntino uguale a
  // tutti gli altri non direbbe quale foto e'.
  const nomeSostaDi = p => soste.find(x => x.id === p.stop_id)?.name;
  photos.filter(p => p.lat != null && p.lon != null).forEach(p => {
    const dove = nomeSostaDi(p);
    L.marker([p.lat, p.lon], { icon: fotoIcon(`/uploads/${p.filename}`), zIndexOffset: 500 })
      .addTo(strato('foto'))
      .bindPopup(`<a href="/uploads/${p.filename}" data-grande="/uploads/${p.filename}" data-didascalia="${esc(p.caption || '')}" title="Tocca per ingrandire"><img src="/uploads/${p.filename}" style="width:220px;border-radius:8px;display:block"></a>
        ${p.caption ? `<b>${esc(p.caption)}</b><br>` : ''}${p.taken_at ? fdt(p.taken_at) : ''}${dove ? `<br>\ud83c\udd7f\ufe0f ${esc(dove)}` : ''}`);
    bounds.push([p.lat, p.lon]);
    segna('foto', [[p.lat, p.lon]]);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });

  // Rivedere il viaggio: si mettono in fila le tappe e gli allenamenti nell'ordine
  // in cui sono successi, dal primo giorno all'ultimo. L'icona cambia con il
  // mezzo - il camper sulla strada, la bici o lo scarpone sull'allenamento - e
  // le foto scattate lungo il percorso compaiono quando ci si passa davanti.
  // Com'e' fatto il pezzo di un allenamento: serve ai tasti del viaggio e a
  // quello su ogni singola uscita
  const pezzoAllenamento = w => ({
    punti: w.track.map(p => [p[0], p[1]]),
    faccia: sportIco(w.sport),
    da: w.luogo || null,
    titolo: `Allenamento ${w.athlete || ''}`.trim(),
    nome: [w.luogo, w.name || w.sport].filter(Boolean).join(' \u00b7 '),
    quando: fdate(w.started_at),
    numeri: numeriAllenamento(w),
    ordine: new Date(w.started_at).getTime(),
  });
  // Nel filmato le foto ci sono tutte. Quelle con le coordinate stanno dove
  // sono state scattate; quelle senza - il telefono col GPS spento, uno scatto
  // mandato da un altro - si mettono dove si era quel giorno, come si fa con
  // gli allenamenti senza traccia: e' una posizione dedotta, e si dice che lo
  // e'. Il nome del posto, quando si sa, compare sotto la foto.
  const fotoSullaMappa = () => photos.filter(p => !eVideo(p)).map(p => {
    if (p.lat != null && p.lon != null) return { ...p, dove: p.luogo || nomeSostaDi(p) || null };
    const sua = p.stop_id ? soste.find(x => x.id === p.stop_id && x.lat != null) : null;
    if (sua) return { ...p, lat: sua.lat, lon: sua.lon, circa: true, dove: sua.name };
    const li = p.taken_at ? dovEravamo({ started_at: p.taken_at }) : null;
    if (li) return { ...p, lat: li.lat, lon: li.lon, circa: true, dove: li.dove };
    // Senza data e senza posto resta l'arrivo: meglio in fondo al viaggio che fuori
    const ultima = legs[legs.length - 1];
    return ultima?.to_lat != null
      ? { ...p, lat: ultima.to_lat, lon: ultima.to_lon, circa: true, dove: ultima.to_name.split(',')[0] }
      : null;
  }).filter(Boolean);

  // Un allenamento solo, dal suo rigo nell'elenco del viaggio
  $$('[data-rivedi-uno]').forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const w = workouts.find(x => x.id === +b.dataset.rivediUno);
    if (!w?.track?.length) return;
    $('#map')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => riproduci(map, [pezzoAllenamento(w)], fotoSullaMappa(), { secondi: 18 }), 400);
  });

  $$('[data-rivedi]').forEach(b => b.onclick = () => {
    const quale = b.dataset.rivedi;
    const soloCamper = quale === 'camper';
    const atleta = quale.startsWith('atleta:') ? quale.slice(7) : null;
    const pezzi = [
      ...(atleta ? [] : legs).map(l => ({
        punti: tragittoDisegnato(l),
        faccia: MEZZO_ICONA[mezzoDi(l)] || MEZZO_ICONA.camper,
        da: l.from_name.split(',')[0], a: l.to_name.split(',')[0],
        // Il camper e' sottinteso: si annunciano il traghetto, il volo, il treno
        titolo: inCamper(l) ? null : compagniaDi(l),
        chi: inCamper(l) ? null : compagniaDi(l),
        nome: `${l.from_name.split(',')[0]} \u2192 ${l.to_name.split(',')[0]}`,
        quando: l.date ? fdate(l.date) : '',
        numeri: numeriTappa(l),
        ordine: l.date ? new Date(l.date).getTime() : 0,
      })),
      ...(soloCamper ? [] : workouts.filter(w => w.track?.length > 1 && (!atleta || w.athlete === atleta))).map(pezzoAllenamento),
    ].sort((a, b) => a.ordine - b.ordine);
    // Alla fine del giro in camper il conto di tutto il viaggio: chilometri,
    // tempo, consumi, e le spese divise per tipologia
    const ore = totals.minutes / 60;
    const pernotti = soste.reduce((a, s) => a + (notti(s.from_date, s.to_date) || 0), 0);
    const finale = soloCamper ? {
      titolo: `\ud83d\ude90 ${esc(nomeViaggio(trip))}`,
      numeri: [
        [num(totals.km, 0), 'km in camper'],
        totals.altri_mezzi ? [num(totals.altri_mezzi.km, 0), 'km con altri mezzi'] : null,
        totals.minutes ? [dur(totals.minutes * 60), 'di guida'] : null,
        ore > 0.2 && totals.km ? [num(totals.km / ore, 0), 'km/h di media'] : null,
        totals.liters ? [num(totals.liters, 0), 'litri di gasolio'] : null,
        totals.pedaggio_km ? [num(totals.pedaggio_km, 0), 'km di autostrada'] : null,
        pernotti ? [pernotti, pernotti === 1 ? 'pernotto' : 'pernotti'] : null,
        conSpese && totals.cost_per_km ? [eur(totals.cost_per_km), 'al km'] : null,
      ],
      categorie: conSpese ? totals.by_category.map(c => [catLabel(c.category), eur(c.total)]) : [],
      totale: conSpese ? eur(totals.total) : null,
    } : null;
    riproduci(map, pezzi, fotoSullaMappa(), finale ? { finale } : {});
  });

  // Toccando una voce resta sulla mappa solo quella, e la mappa ci si stringe
  // sopra: e' il modo di guardare un percorso senza che gli altri gli passino
  // addosso. Toccandola di nuovo torna tutto, inquadratura compresa.
  const voci = $$('.legenda-mappa .voce[data-strato]');
  let solo = null;
  const tutto = () => {
    solo = null;
    Object.values(strati).forEach(g => g.addTo(map));
    voci.forEach(v => v.classList.remove('spento', 'acceso'));
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  };
  voci.forEach(v => v.onclick = () => {
    const sel = v.dataset.strato;
    const scelti = gruppiDi(sel);
    if (!scelti.length || solo === sel) return tutto();
    solo = sel;
    Object.entries(strati).forEach(([k, g]) => scelti.includes(k) ? g.addTo(map) : map.removeLayer(g));
    voci.forEach(x => {
      x.classList.toggle('acceso', x.dataset.strato === sel);
      x.classList.toggle('spento', x.dataset.strato !== sel);
    });
    // Un allenamento senza traccia e' un punto solo: senza un limite allo
    // zoom la mappa ci finirebbe sopra col naso, e non si capirebbe piu' dove
    const punti = scelti.flatMap(k => estensioni[k] || []);
    if (punti.length) map.fitBounds(punti, { padding: [40, 40], maxZoom: 15 });
  });
  return map;
}

async function viewTrip(id) {
  const d = await api('/trips/' + id);
  const { trip, legs, expenses, photos, workouts, totals } = d;
  const soste = d.soste || [], materiali = d.materiali || [];
  // Una foto sta in un posto solo: se e' di una sosta, sta sotto la sosta e non
  // anche nella raccolta del viaggio, che sarebbe la stessa foto due volte
  const fotoSosta = new Map();
  soste.forEach(x => fotoSosta.set(x.id, []));
  photos.forEach(p => { if (p.stop_id && fotoSosta.has(p.stop_id)) fotoSosta.get(p.stop_id).push(p); });
  const fotoViaggio = photos.filter(p => !p.stop_id || !fotoSosta.has(p.stop_id));

  // In due si esce insieme, ma gli allenamenti sono di ciascuno: separati si
  // leggono, mischiati bisogna spulciare riga per riga di chi e' ognuno. Sulla
  // mappa il colore dice la disciplina, quindi a dire chi e' resta il tratto.
  const atletiDelViaggio = atletiDi(workouts);
  const trattoDi = nome => trattoFra(nome, atletiDelViaggio);
  const closed = trip.status === 'closed';
  const catRows = totals.by_category.map(c => `<span><i class="dot" style="display:inline-block;background:${catColor(c.category)}"></i>${catLabel(c.category)} <b>${eur(c.total)}</b></span>`).join('');
  // Il tempo in strada di una tappa: dall'orario di partenza a quello di
  // arrivo. Dentro ci sono anche le soste, quindi non e' tempo di guida.
  // Una tappa che unisce piu' tragitti e dura quanto tutto l'intervallo non
  // distingue la guida dalle soste che ci sono in mezzo: non si spaccia per guida
  const conSoste = l => String(l.external_id || '').includes('+') && inStrada(l) <= (l.duration_min || 0);
  // Quanto e' lunga la riga disegnata. Se non somiglia ai chilometri veri, la
  // strada ricostruita non e' quella fatta: meglio dirlo prima che se ne accorga
  // chi guarda la mappa e si chieda perche' passa di li'.
  const lungaQuanto = g => {
    if (!Array.isArray(g) || g.length < 2) return 0;
    const rad = x => x * Math.PI / 180;
    let t = 0;
    for (let i = 1; i < g.length; i++) {
      const [a1, o1] = g[i - 1], [a2, o2] = g[i];
      const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
      t += 12742 * Math.asin(Math.sqrt(h));
    }
    return t;
  };
  const stradaSospetta = l => l.source === 'carlock' && l.distance_km > 0
    && Math.abs(lungaQuanto(l.geometry) - l.distance_km) > Math.max(15, l.distance_km * 0.08);
  const inStrada = l => {
    const m = t => { const x = String(t || '').match(/^(\d{1,2}):(\d{2})/); return x ? +x[1] * 60 + +x[2] : null; };
    const a = m(l.start_time), b = m(l.end_time);
    if (a == null || b == null) return 0;
    return b >= a ? b - a : b + 1440 - a;
  };
  // Quanto e' costata una tappa: il gasolio si conta sui litri, il pedaggio si
  // stima sui chilometri di autostrada. Sono due spese separate, e quello che
  // conta per la tappa e' la somma.
  const costiDi = l => {
    const sue = expenses.filter(e => e.leg_id === l.id && e.auto);
    const quanto = e => e ? +e.amount * (+e.rate || 1) : null;
    const g = sue.find(e => e.category === 'gasolio'), p = sue.find(e => e.category === 'pedaggi');
    // Con un mezzo altrui la spesa e' il biglietto, nella categoria del mezzo
    const b = sue.find(e => e.category !== 'gasolio' && e.category !== 'pedaggi');
    return { g: quanto(g), p: quanto(p), b: quanto(b), biglietto: b,
      gMano: !!g?.edited, pMano: !!p?.edited, bMano: !!b?.edited,
      tot: (quanto(g) || 0) + (quanto(p) || 0) + (quanto(b) || 0) };
  };
  const rigaCosti = l => {
    const c = costiDi(l);
    if (c.b != null) {
      const e = c.biglietto;
      return `<div class="small costi-tappa">${MEZZI[mezzoDi(l)][0]} <b>${importoConValuta(e.amount, e.currency, e.rate)}</b>${c.bMano ? ' <span class="badge warn" title="Importo scritto da te: non viene ricalcolato">a mano</span>' : ''}${l.sconto ? ` \u00b7 <span title="Sconto">\ud83c\udff7\ufe0f ${esc(l.sconto)}</span>` : ''}</div>`;
    }
    if (c.g == null && c.p == null) return '';
    const mano = ' <span class="badge warn" title="Importo scritto da te: non viene ricalcolato">a mano</span>';
    return `<div class="small costi-tappa">${c.g != null ? `⛽ <b>${eur(c.g)}</b>${c.gMano ? mano : ''}` : ''}${c.p != null ? `${c.g != null ? ' · ' : ''}<span title="${c.pMano ? 'Pedaggio scritto da te' : 'Stima sui chilometri di autostrada: il conto vero lo sai al casello'}">🛣️ <b>${eur(c.p)}</b>${l.pedaggio_km ? ` <span class="muted">(${num(l.pedaggio_km)} km)</span>` : ''}</span>${c.pMano ? mano : ''}` : ''}${c.g != null && c.p != null ? ` · <b>${eur(c.tot)}</b> in tutto` : ''}</div>`;
  };
  const legRow = (l, i) => `<div class="step"><div class="ordine">
      <button class="freccia" data-su="${l.id}" title="Sposta prima" ${i === 0 ? 'disabled' : ''}>\u25b2</button>
      <div class="n">${i + 1}</div>
      <button class="freccia" data-giu="${l.id}" title="Sposta dopo" ${i === legs.length - 1 ? 'disabled' : ''}>\u25bc</button>
    </div><div class="grow">
      <div class="row between"><div>${inCamper(l) ? '' : `<span title="${esc(MEZZI[mezzoDi(l)][1])}">${MEZZI[mezzoDi(l)][0]}</span> `}<b>${esc(l.from_name.split(',')[0])}</b> → <b>${esc(l.to_name.split(',')[0])}</b></div><div class="nowrap"><b>${num(l.distance_km)} km</b> <span class="muted small">\u00b7 ${dur(l.duration_min * 60)} ${!inCamper(l) ? 'in ' + MEZZI[mezzoDi(l)][1].toLowerCase().replace('in camper', 'camper') : conSoste(l) ? 'in strada' : 'di guida'}${!conSoste(l) && inStrada(l) > (l.duration_min || 0) + 5 ? ` \u00b7 ${dur(inStrada(l) * 60)} in strada` : ''}</span></div></div>
      <div class="small muted">${l.compagnia || l.codice ? `<b>${esc([l.compagnia, l.codice].filter(Boolean).join(' '))}</b> · ` : ''}${fdate(l.date)}${l.start_time ? ' ' + l.start_time + '–' + l.end_time : ''}${l.source === 'carlock' ? ' <span class="badge ok" title="Chilometri e orari veri dal tracker. La strada sulla mappa e\u2019 ricostruita: CarLock non registra il percorso.">CarLock</span>' : ''}${stradaSospetta(l) ? ` <span class="badge warn" title="La riga sulla mappa e\u2019 lunga ${num(lungaQuanto(l.geometry), 0)} km, i chilometri veri sono ${num(l.distance_km, 0)}: la strada ricostruita non e\u2019 quella percorsa. Prova \u00ab\ud83e\udded Ridisegna\u00bb.">strada da ridisegnare</span>` : ''}${l.fuel_price ? ' · gasolio ' + l.fuel_price + ' €/l' : ''}${l.senza_gasolio ? ' · <span class="badge" title="La spesa del gasolio l\u2019hai tolta: si riaccende da Modifica">gasolio non calcolato</span>' : ''}${l.notes ? ' · ' + esc(l.notes) : ''}${l.pois ? ` · 🅿️ ${l.pois.stops?.length || 0} soste` : ' · <i>cerco aree sosta…</i>'}</div>
      ${rigaCosti(l)}
      <div class="row" style="margin-top:6px"><a class="btn sm" href="${mapsIndicazioni({ lat: l.from_lat, lon: l.from_lon }, { lat: l.to_lat, lon: l.to_lon })}" target="_blank" rel="noopener" title="Indicazioni su Google Maps, calcolate adesso">\ud83d\uddfa\ufe0f Maps</a><a class="btn sm" href="${p4n(l.to_lat, l.to_lon)}" target="_blank" rel="noopener" title="Apri park4night su ${esc(l.to_name.split(',')[0])}">\ud83c\udd7f\ufe0f park4night</a>${eCasa(l.to_name) ? '' : `<button class="btn sm ghost" data-poi="${l.id}">Soste all\u2019arrivo</button>`}${inCamper(l) ? `<button class="btn sm ghost" data-carlock-leg="${l.id}" title="Porta in questa tappa il tragitto davvero percorso">\ud83d\udce1 CarLock</button>` : ''}${inCamper(l) && l.source === 'carlock' ? `<button class="btn sm ghost" data-ridisegna="${l.id}" title="CarLock registra i chilometri, non la strada: ridisegna scegliendo quella che misura ${num(l.distance_km)} km">\ud83e\udded Ridisegna</button>` : ''}<button class="btn sm ghost" data-edit-leg="${l.id}">Modifica</button><button class="btn sm ghost danger" data-del-leg="${l.id}">Elimina</button></div></div></div>`;
  // Ogni materiale si presenta per quello che e': l'appunto si legge, il link
  // si apre, l'immagine si guarda, il file si scarica
  const pesoFile = n => !n ? '' : n > 1048576 ? `${num(n / 1048576, 1)} MB` : `${num(n / 1024, 0)} kB`;
  const rigaMateriale = m => {
    const ico = m.tipo === 'nota' ? '\ud83d\udcdd' : m.tipo === 'link' ? '\ud83d\udd17' : m.tipo === 'immagine' ? '\ud83d\uddbc\ufe0f' : '\ud83d\udcc4';
    const quando = `${fdate(m.created_at)}${m.chi ? ' \u00b7 ' + esc(m.chi) : ''}`;
    const corpo = m.tipo === 'nota'
      ? `<div class="meta">${quando}</div>${m.testo ? `<div class="appunto">${esc(m.testo)}</div>` : ''}`
      : m.tipo === 'link'
        ? `<div class="meta">${esc((() => { try { return new URL(m.url).hostname.replace(/^www\./, ''); } catch { return m.url; } })())} \u00b7 ${quando}</div>`
        : `<div class="meta">${pesoFile(m.dimensione)}${m.mime ? ' \u00b7 ' + esc(String(m.mime).split('/').pop().toUpperCase()) : ''} \u00b7 ${quando}</div>`;
    const apri = m.tipo === 'link' ? `<a class="btn ghost icon" href="${esc(m.url)}" target="_blank" rel="noopener" title="Apri il sito">\u2197\ufe0f</a>`
      : m.filename ? `<a class="btn ghost icon" href="/uploads/${esc(m.filename)}" target="_blank" rel="noopener" download title="Scarica">\u2b07\ufe0f</a>` : '';
    const faccia = m.tipo === 'immagine'
      ? `<img class="miniatura" src="/uploads/${esc(m.filename)}" alt="" loading="lazy" data-grande="/uploads/${esc(m.filename)}" data-didascalia="${esc(m.titolo || '')}" title="Tocca per ingrandire">`
      : `<div class="sport-ico">${ico}</div>`;
    return `<div class="item materiale"><div class="item-main" style="cursor:default">${faccia}
      <div class="grow"><div class="title">${esc(m.titolo || (m.tipo === 'nota' ? 'Appunto' : m.filename || m.url || ''))}</div>${corpo}</div></div>
      <div class="item-actions">${apri}${m.tipo === 'nota' ? `<button class="btn ghost icon" data-mod-mat="${m.id}" title="Modifica">\u270f\ufe0f</button>` : ''}
        <button class="btn ghost danger icon" data-del-mat="${m.id}" title="Elimina">\ud83d\uddd1</button></div></div>`;
  };
  const exRow = e => `<tr data-ex="${e.id}"><td class="nowrap">${fdate(e.date)}</td><td>${catLabel(e.category)}</td><td>${esc(e.description || '')}${e.auto ? ` <span class="badge ${e.edited ? 'warn' : 'ok'}" title="${e.edited ? 'Calcolo automatico sostituito da te' : 'Calcolata automaticamente'}">${e.edited ? 'modificata' : 'auto'}</span>` : ''}${e.place ? `<div class="small muted">\ud83d\udccd ${esc(e.place)}</div>` : ''}</td><td class="num"><b>${importoConValuta(e.amount, e.currency, e.rate)}</b></td>
    <td class="num">${`<button class="btn sm ghost" data-edit-ex="${e.id}">✏️</button>${e.auto && e.edited ? `<button class="btn sm ghost" title="Ripristina calcolo automatico" data-reset-ex="${e.id}">↺</button>` : ''}<button class="btn sm ghost danger" data-del-ex="${e.id}" data-auto-ex="${e.auto ? 1 : 0}" title="Elimina">🗑</button>`}</td></tr>`;
  $('#app').innerHTML = layout(`
    <div class="row between" style="margin-bottom:14px"><div><a href="#/" class="small">← Viaggi</a><h1><span id="ttl" title="Tocca per rinominare" style="cursor:pointer">${esc(nomeViaggio(trip))}</span> <span class="badge ${trip.status}">${closed ? 'concluso' : 'in corso'}</span></h1>
      <div class="muted small">${dateCliccabili(trip)} · creato da ${esc(trip.owner)} · gasolio ${trip.fuel_price ?? settings.vehicle?.fuel_price} €/l · ${trip.km_per_liter} km/l</div></div>
      <div class="row"><button class="btn" id="edit">✏️ Modifica</button>${trip.status === 'bozza' ? '<button class="btn primary" id="parti" title="Il viaggio comincia: passa fra quelli in corso">\ud83d\ude80 Si parte</button>'
        : closed ? '<button class="btn" id="reopen">Riapri</button>'
        : '<button class="btn primary" id="close">Concludi viaggio</button>'}${trip.status === 'bozza' ? '' : '<button class="btn" id="incostruzione" title="Rimettilo fra i viaggi che stiamo preparando">\ud83e\uddf0 In costruzione</button>'}${legs.length > 1 ? '<button class="btn icon" id="split" title="Dividi in viaggi casa → casa">✂️</button>' : ''}<button class="btn ghost danger icon" id="del" title="Elimina viaggio">🗑</button></div></div>
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile accent"><div class="label">Totale speso</div><div class="value">${eur(totals.total)}</div><div class="sub">${totals.cost_per_km ? eur(totals.cost_per_km) + ' al km' : ''}</div></div>
      <div class="tile"><div class="label">Distanza in camper</div><div class="value">${num(totals.km)} km</div><div class="sub">${totals.legs} tappe \u00b7 ${totals.km && totals.minutes ? num(totals.km / (totals.minutes / 60), 0) + ' km/h di media' : ''}</div></div>
      <div class="tile"><div class="label">Ore di guida</div><div class="value">${dur(totals.minutes * 60)}</div><div class="sub">${totals.minuti_strada > totals.minutes + 5 ? `${dur(totals.minuti_strada * 60)} in strada, soste comprese` : ''}${totals.tappe_con_soste ? `${totals.minuti_strada > totals.minutes + 5 ? '<br>' : ''}su ${totals.tappe_con_soste} tapp${totals.tappe_con_soste === 1 ? 'a' : 'e'} comprende le soste` : ''}</div></div>
      <div class="tile"><div class="label">Gasolio</div><div class="value">${num(totals.liters)} l</div><div class="sub">${eur(totals.by_category.find(c => c.category === 'gasolio')?.total || 0)}</div></div>
      ${totals.altri_mezzi ? `<div class="tile"><div class="label">Altri mezzi</div><div class="value">${num(totals.altri_mezzi.km)} km</div><div class="sub">${Object.entries(totals.altri_mezzi.per_mezzo).map(([k, v]) => `${MEZZI[k] ? MEZZI[k][0] : ''} ${num(v.km)} km`).join(' · ')}</div></div>` : ''}
      ${totals.pedaggio_km > 0 || (totals.by_category.find(c => c.category === 'pedaggi')?.total || 0) > 0
        ? `<div class="tile"><div class="label">Autostrada</div><div class="value">${eur(totals.by_category.find(c => c.category === 'pedaggi')?.total || 0)}</div><div class="sub">${[totals.pedaggio_km > 0 ? `${num(totals.pedaggio_km)} km a pedaggio` : '', expenses.some(e => e.category === 'pedaggi' && e.edited) ? '' : 'stima'].filter(Boolean).join(' · ')}</div></div>`
        : ''}
      <div class="tile"><div class="label">Allenamenti</div><div class="value">${workouts.length}</div><div class="sub">${atletiDelViaggio.length > 1 ? atletiDelViaggio.map(n => `${esc(n)} ${workouts.filter(w => w.athlete === n).length}`).join(' \u00b7 ') + '<br>' : ''}${num(workouts.reduce((a, w) => a + (w.distance_m || 0), 0) / 1000)} km di attività · ${num(workouts.reduce((a, w) => a + (w.calories || 0), 0), 0)} kcal</div></div>
    </div>
    <div class="card pad-0"><div id="map" class="map tall"></div>
      ${legendaViaggio(d)}</div>
    <div class="grid due" style="margin-top:14px">
      <div class="card pad-0"><div class="row between" style="padding:14px 16px 6px"><h2>Tappe</h2>${`<div class="row">${legs.some(l => !l.external_id) ? '<button class="btn sm" id="sostituisci" title="Al posto del percorso previsto, quello davvero percorso">\ud83d\udce1 Sostituisci con CarLock</button>' : '<button class="btn sm" id="carlock">\ud83d\udce1 Importa CarLock</button>'}<button class="btn sm" id="damaps" title="Incolla un itinerario di Google Maps">\ud83d\uddfa\ufe0f Da Maps</button><button class="btn primary sm" id="addleg">\uff0b Tappa</button></div>`}</div>
        <div id="legs">${legs.length ? legs.map(legRow).join('') : '<div class="empty">Aggiungi la prima tappa: la distanza stradale e il costo del gasolio vengono calcolati automaticamente.</div>'}</div></div>
      <div class="card pad-0"><div class="row between" style="padding:14px 16px 6px"><h2>\ud83c\udd7f\ufe0f Dove dormiamo o dove ci fermiamo</h2>${'<div class="row"><button class="btn sm" id="cercasoste" title="Aree sosta e campeggi alle destinazioni delle tappe">\ud83d\udd0e Alle destinazioni</button><button class="btn primary sm" id="addsosta">\uff0b Sosta</button></div>'}</div>
        ${legs.length ? `<div class="small muted" style="padding:0 16px 10px">
          <a class="btn sm" href="${mapsIndicazioni({ lat: legs[0].from_lat, lon: legs[0].from_lon }, { lat: legs[legs.length - 1].to_lat, lon: legs[legs.length - 1].to_lon }, legs.slice(0, -1).map(l => ({ lat: l.to_lat, lon: l.to_lon })))}" target="_blank" rel="noopener">\ud83d\uddfa\ufe0f Tutto il percorso su Maps</a>
          ${legs.length > MAX_TAPPE_MAPS + 1 ? `<span class="small muted"> \u00b7 Google accetta ${MAX_TAPPE_MAPS} punti intermedi: le tappe oltre restano fuori</span>` : ''}
          <div style="margin-top:8px">Apri park4night sui punti del viaggio:
          ${[{ n: legs[0].from_name, lat: legs[0].from_lat, lon: legs[0].from_lon }, ...legs.map(l => ({ n: l.to_name, lat: l.to_lat, lon: l.to_lon }))]
            .filter(x => x.lat != null)
            .map(x => `<a class="p4n-punto" href="${p4n(x.lat, x.lon)}" target="_blank" rel="noopener">\ud83c\udd7f\ufe0f ${esc(String(x.n).split(',')[0])}</a>`).join(' ')}</div></div>` : ''}
        <div class="list" id="soste">${soste.length ? soste.map(s => sostaRiga(s, fotoSosta.get(s.id), trip.cover_photo_id)).join('') : '<div class="empty">Nessuna sosta segnata. Cercale alle destinazioni, oppure aggiungile a mano: sosta, infratto, area sosta, camping, appartamento o quello che \u00e8, con i giorni, il costo e un giudizio a stelle.</div>'}</div></div>

      <div class="card pad-0" style="grid-column:1/-1" id="materiali"><div class="row between" style="padding:14px 16px 6px"><h2>\ud83d\udcce Info e dati utili</h2>
        <div class="row"><button class="btn sm" id="m-nota">\uff0b Nota</button><button class="btn sm" id="m-link">\uff0b Link</button><button class="btn sm primary" id="m-file">\uff0b File</button>
          <input type="file" id="m-input" multiple hidden></div></div>
        <div class="list">${materiali.length ? materiali.map(rigaMateriale).join('')
          : `<div class="empty">Qui sta il materiale con cui si prepara il viaggio: appunti, indirizzi di siti, il pdf del traghetto, la pagina di una rivista fotografata. Quando si parte \u00e8 tutto in un posto solo.</div>`}</div></div>

      <div class="card pad-0" style="grid-column:1/-1"><div class="row between" style="padding:14px 16px 6px"><h2>Spese</h2><button class="btn primary sm" id="addex">＋ Spesa</button></div>
        ${catRows ? `<div class="legend" style="padding:0 16px 10px">${catRows}</div>` : ''}
        <div class="table-wrap"><table class="ex-table"><thead><tr><th>Data</th><th>Categoria</th><th>Descrizione</th><th class="num">Importo</th><th></th></tr></thead><tbody>${expenses.length ? expenses.map(exRow).join('') : '<tr><td colspan="5" class="empty">Nessuna spesa</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><div class="row between"><h2>Foto</h2><div class="row">${fotoViaggio.length ? '<button class="btn sm" id="selfoto">\u2611\ufe0f Seleziona</button>' : ''}${SU_MAC ? '<a class="btn sm" id="apri-foto" href="photos://" title="Apre l\u2019app Foto: da l\u00ec trascina gli scatti qui dentro">\ud83c\udf3a App Foto</a>' : ''}<label class="btn sm">\ud83d\udcf7 Carica<input type="file" id="ph" accept="image/*" multiple hidden></label></div></div>
        <div class="card barra-selezione" id="barra-foto" hidden style="margin-top:10px;padding:10px 12px">
          <div class="row between"><div><b id="quante-foto">0</b> selezionate</div>
          <div class="row"><button class="btn danger sm" id="elimina-foto">\ud83d\uddd1 Elimina</button><button class="btn sm" id="annulla-foto">Annulla</button></div></div></div>
        ${SU_MAC ? `<div class="small muted" style="margin-top:10px">Trascina gli scatti dall\u2019app Foto o dal Finder in un punto qualsiasi di questa pagina, oppure copiali e incollali con \u2318V.</div>` : ''}
        <div class="photos${fotoViaggio.length ? '' : ' empty-grid'}" style="margin-top:12px" id="photos">${fotoViaggio.map(p => `<figure data-foto="${p.id}" class="${eVideo(p) ? 'e-video' : ''}">${facciaMedia(p, ` ${datiLente(p)} title="Tocca per ${eVideo(p) ? 'guardarlo' : 'ingrandire'}"`)}${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}${stellaCopertina(p, trip.cover_photo_id)}<button class="del" data-del-ph="${p.id}">\u2715</button></figure>`).join('') || `<div class="muted small">Nessuna foto${photos.length ? ' oltre a quelle delle soste' : ''}. Le foto con GPS vengono posizionate sulla mappa.</div>`}</div></div>
      ${atletiDelViaggio.length ? atletiDelViaggio.map(nome => {
        const suoi = workouts.filter(w => w.athlete === nome);
        const km = suoi.reduce((a, w) => a + (w.distance_m || 0), 0) / 1000;
        return `<div class="card pad-0"><div class="row between" style="padding:14px 16px 6px"><h2>\ud83d\udc5f ${esc(nome)}</h2>
          <div class="small muted"><i class="segno-atleta" style="border-top-style:${trattoDi(nome)[1]}"></i> ${suoi.length} ${suoi.length === 1 ? 'uscita' : 'uscite'}${km >= 0.1 ? ` \u00b7 ${num(km)} km` : ''}</div></div>
          <div class="list">${suoi.map(w => `<a class="item" href="#/allenamento/${w.id}"><div class="sport-ico">${sportIco(w.sport)}</div><div class="grow"><div class="title">${esc(w.name || w.sport || 'Allenamento')}</div><div class="meta">${fdt(w.started_at)} \u00b7 ${num((w.distance_m || 0) / 1000)} km \u00b7 ${dur(w.duration_s)}${w.elevation_up_m ? ' \u00b7 \u26f0\ufe0f ' + w.elevation_up_m + ' m' : ''}${w.hr_avg ? ' \u00b7 \u2764\ufe0f ' + w.hr_avg : ''}${w.calories ? ' \u00b7 \ud83d\udd25 ' + w.calories : ''}</div></div>${w.track?.length > 1 ? `<button class="btn ghost icon rivedi-uno" data-rivedi-uno="${w.id}" title="Rivedi questo percorso sulla mappa">\u25b6</button>` : ''}</a>`).join('')}</div></div>`;
      }).join('') : '<div class="card pad-0"><div style="padding:14px 16px 6px"><h2>Allenamenti del viaggio</h2></div><div class="empty">Gli allenamenti nelle date del viaggio compaiono qui automaticamente.</div></div>'}
    </div>`);

  // La mappa, la legenda e i tasti per rivedere: gli stessi che vede l\u2019ospite
  mappaDelViaggio($('#map'), d);

  // Azioni
  $('#edit')?.addEventListener('click', () => tripForm(trip));
  $('#ttl').onclick = () => modal(`<h2>Rinomina viaggio</h2><form id="f" class="stack" style="margin-top:12px"><input name="title" value="${esc(trip.title)}" required maxlength="120"><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => { $('[data-x]', el).onclick = close; $('[name=title]', el).select(); $('#f', el).onsubmit = safe(async e => { e.preventDefault(); await api('/trips/' + id, { method: 'PUT', body: { title: $('[name=title]', el).value.trim(), start_date: trip.start_date, end_date: trip.end_date, fuel_price: trip.fuel_price, km_per_liter: trip.km_per_liter, notes: trip.notes } }); close(); render(); }); });
  $('#split')?.addEventListener('click', () => modal(`<h2>✂️ Dividi in viaggi</h2><p class="small muted">Ogni partenza da casa fino al rientro a casa diventa un viaggio separato, con le sue tappe, spese e foto. Il titolo prende date e mete.</p><form id="f" class="stack"><div><label class="f">Nome di casa (come compare nelle tappe)</label><input name="home" value="Susegana" required></div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Dividi</button></div></form>`,
    (el, close) => { $('[data-x]', el).onclick = close; $('#f', el).onsubmit = safe(async e => { e.preventDefault(); const r = await api(`/trips/${id}/split`, { method: 'POST', body: { home: $('[name=home]', el).value } }); close();
      if (!r.created.length) return toast('Nessuna divisione possibile: ' + (r.reason || 'serve almeno un rientro a casa'), true);
      toast(`Creati ${r.created.length} viaggi`); location.hash = '#/'; render(); }); }));
  $('#del').onclick = safe(async () => { if (await confirmDlg('Eliminare il viaggio con tappe, spese e foto?')) { await api('/trips/' + id, { method: 'DELETE' }); location.hash = '#/'; } });
  $('#close')?.addEventListener('click', safe(async () => {
    if (!await confirmDlg('Concludere il viaggio? Verranno mostrati i totali finali.')) return;
    const r = await api(`/trips/${id}/close`, { method: 'POST', body: {} });
    const t = r.totals;
    modal(`<h2>🏁 Viaggio concluso</h2><div class="tiles" style="margin:14px 0"><div class="tile accent"><div class="label">Totale</div><div class="value">${eur(t.total)}</div></div><div class="tile"><div class="label">Km</div><div class="value">${num(t.km)}</div></div><div class="tile"><div class="label">Gasolio</div><div class="value">${num(t.liters)} l</div></div><div class="tile"><div class="label">Costo/km</div><div class="value">${t.cost_per_km ? eur(t.cost_per_km) : '—'}</div></div></div>
      <table>${t.by_category.map(c => `<tr><td>${catLabel(c.category)}</td><td class="num">${eur(c.total)}</td></tr>`).join('')}</table><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-x>Ok</button></div>`, (el, close) => $('[data-x]', el).onclick = () => { close(); render(); });
  }));
  $('#reopen')?.addEventListener('click', safe(async () => { await api(`/trips/${id}/close`, { method: 'POST', body: { reopen: true } }); render(); }));
  $('#parti')?.addEventListener('click', safe(async () => { await api(`/trips/${id}/stato`, { method: 'POST', body: { stato: 'open' } }); toast('Buon viaggio'); render(); }));
  $('#incostruzione')?.addEventListener('click', safe(async () => { await api(`/trips/${id}/stato`, { method: 'POST', body: { stato: 'bozza' } }); toast('Torna fra i viaggi in costruzione'); render(); }));

  // ---- info e dati utili ----
  $('#m-file')?.addEventListener('click', () => $('#m-input').click());
  $('#m-input')?.addEventListener('change', safe(async e => {
    const scelti = [...(e.target.files || [])];
    if (!scelti.length) return;
    const fd = new FormData();
    scelti.forEach(f => fd.append('file', f));
    toast(scelti.length === 1 ? 'Carico il file\u2026' : `Carico ${scelti.length} file\u2026`);
    const r = await api(`/trips/${id}/materiali/file`, { method: 'POST', body: fd });
    toast(`${r.length} fra file e immagini nel materiale`);
    restaQui();
  }));
  $('#m-nota')?.addEventListener('click', () => materialeForm(id, 'nota'));
  $('#m-link')?.addEventListener('click', () => materialeForm(id, 'link'));
  $$('[data-mod-mat]').forEach(b => b.onclick = safe(() => materialeForm(id, 'nota', materiali.find(m => m.id === +b.dataset.modMat))));
  $$('[data-del-mat]').forEach(b => b.onclick = safe(async () => {
    if (!await confirmDlg('Togliere questo materiale dal viaggio?')) return;
    await api('/materiali/' + b.dataset.delMat, { method: 'DELETE' });
    toast('Tolto'); restaQui();
  }));
  $('#addleg')?.addEventListener('click', () => legForm(trip, legs));
  $('#damaps')?.addEventListener('click', () => tappeDaMaps(trip, legs));
  $('#carlock')?.addEventListener('click', () => carlockImport({ ...trip, legs }));
  $('#sostituisci')?.addEventListener('click', () => carlockImport({ ...trip, legs }, [], true));
  $('#addsosta')?.addEventListener('click', () => sostaForm(trip));
  $$('[data-sosta]').forEach(b => b.onclick = () => sostaForm(trip, soste.find(x => x.id === +b.dataset.sosta)));
  $$('[data-sostaspesa]').forEach(b => b.onclick = safe(async () => {
    const r = await api(`/soste/${b.dataset.sostaspesa}/spesa`, { method: 'POST' });
    toast(`Rimessa fra le spese: ${importoConValuta(r.amount, r.currency, r.rate).replace(/<[^>]+>/g, '')}`);
    restaQui();
  }));
  // Le foto di una sosta: si caricano dal suo pulsante, e si tolgono dal loro \u2715
  $$('[data-fotososta]').forEach(inp => inp.onchange = safe(async e => {
    await caricaFoto(id, e.target.files, { stop_id: inp.dataset.fotososta });
    e.target.value = '';
  }));
  $('#soste')?.addEventListener('click', safe(async e => {
    const b = e.target.closest('[data-del-ph]');
    if (b && await confirmDlg('Eliminare la foto?')) { await api('/photos/' + b.dataset.delPh, { method: 'DELETE' }); restaQui(); }
  }));
  // La stella sceglie la copertina del viaggio, ovunque stia la foto: nella
  // raccolta o sotto una sosta
  $('main')?.addEventListener('click', safe(async e => {
    const b = e.target.closest('[data-copertina]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const r = await api(`/trips/${id}/copertina`, { method: 'POST', body: { photo_id: +b.dataset.copertina } });
    toast(r.cover_photo_id ? 'Copertina del viaggio scelta' : 'Copertina di nuovo automatica: la prima foto');
    restaQui();
  }));
  $$('[data-delsosta]').forEach(b => b.onclick = safe(async () => {
    if (!await confirmDlg('Togliere questa sosta e il suo costo dalle spese?')) return;
    const r = await api('/soste/' + b.dataset.delsosta, { method: 'DELETE' });
    toast(r.spese_tenute
      ? `Sosta tolta \u00b7 ${r.spese_tenute === 1 ? 'una spesa resta' : r.spese_tenute + ' spese restano'} fra quelle del viaggio`
      : r.spese_tolte ? 'Sosta e sua spesa tolte' : 'Sosta tolta');
    restaQui();
  }));
  // Lungo il percorso: i posti arrivano da OpenStreetMap, i giudizi da park4night
  $('#cercasoste')?.addEventListener('click', safe(async () => {
    const finestra = modal(`<h2>\ud83d\udd0e Soste alle destinazioni</h2>
      <div class="row" style="gap:10px;align-items:center;margin-top:8px"><label class="small muted">Raggio</label>
        <select id="raggio" style="width:auto">${[5, 10, 20, 30].map(k => `<option value="${k * 1000}" ${k === 5 ? 'selected' : ''}>${k} km</option>`).join('')}</select></div>
      <div id="vic" style="margin-top:12px"><div class="empty">Cerco\u2026</div></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Chiudi</button></div>`,
      (el, close) => {
        $('[data-x]', el).onclick = close;
        const cerca = safe(async () => {
          $('#vic', el).innerHTML = '<div class="empty">Cerco\u2026</div>';
          const r = await api(`/trips/${trip.id}/vicinanze?raggio=${$('#raggio', el).value}`);
          $('#vic', el).innerHTML = r.avviso ? `<div class="empty">${esc(r.avviso)}</div>`
            : !r.luoghi.length ? '<div class="empty">Nessuna area sosta o campeggio in questo raggio. Prova ad allargarlo, oppure aprilo su park4night: loro ne conoscono di piu\u2019.</div>'
            : `<p class="small muted">${r.luoghi.length} posti da OpenStreetMap entro ${r.raggio / 1000} km dalle destinazioni delle tappe. Il pulsante \ud83c\udd7f\ufe0f apre park4night centrato l\u00ec, dove trovi foto, prezzi e commenti.</p>
              <div class="list" style="max-height:46vh;overflow:auto;margin-top:8px">${r.luoghi.map((p, i) => `<div class="item"><div class="item-main" style="cursor:default">
                <div class="sport-ico">${p.kind === 'campeggio' ? '\u26fa' : p.kind === 'camper_service' ? '\ud83d\udeb0' : '\ud83c\udd7f\ufe0f'}</div>
                <div class="grow"><div class="title">${esc(p.name)}</div><div class="meta">${p.kind === 'campeggio' ? 'campeggio' : p.kind === 'camper_service' ? 'camper service' : 'area sosta'}</div></div></div>
                <div class="item-actions"><a class="btn ghost icon" href="${esc(p.park4night)}" target="_blank" rel="noopener" title="Apri su park4night">\ud83c\udd7f\ufe0f</a>
                  <button class="btn sm" data-aggiungi="${i}">Aggiungi</button></div></div>`).join('')}</div>`;
          $$('[data-aggiungi]', el).forEach(b => b.onclick = () => { const p = r.luoghi[+b.dataset.aggiungi]; close(); sostaForm(trip, null, p); });
        });
        $('#raggio', el).onchange = cerca;
        cerca();
      });
  }));
  $('#addex')?.addEventListener('click', () => expenseForm(trip, legs, null, soste));
  $('#legs').onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    // Una ricerca finita a vuoto non vale come risposta: si rifa'. Per mesi il
    // servizio ci ha rifiutati e quelle tappe sarebbero rimaste vuote per sempre
    if (b.dataset.poi) {
      const l = legs.find(x => x.id == b.dataset.poi);
      // Si cerca se non si e' mai cercato davvero. Un elenco vuoto dopo una
      // ricerca riuscita e' una risposta: qui intorno non c'e' niente.
      if (!l.pois?.cercato_il) { toast('Cerco aree sosta\u2026'); l.pois = await api(`/legs/${l.id}/pois`, { method: 'POST' }); }
      poiModal(l);
    }
    if (b.dataset.su || b.dataset.giu) {
      const r = await api(`/legs/${b.dataset.su || b.dataset.giu}/sposta`, { method: 'POST', body: { verso: b.dataset.su ? 'su' : 'giu' } });
      if (r.spostata) restaQui();
    }
    if (b.dataset.ridisegna) {
      toast('Cerco la strada che misura quei chilometri\u2026');
      const r = await api(`/legs/${b.dataset.ridisegna}/ridisegna`, { method: 'POST' });
      // Con una strada sola non c'e' stato niente da confrontare: dirlo, perche'
      // il disegno potrebbe non somigliare a dove si e' passati davvero
      toast(r.confrontate
        ? `Ridisegnata su \u00ab${r.nome.toLowerCase()}\u00bb: ${num(r.km_disegnati)} km contro ${num(r.km_veri)} veri`
        : `Ridisegnata, ma avevo una strada sola da proporre: ${num(r.km_disegnati)} km contro ${num(r.km_veri)} veri`, !r.confrontate);
      restaQui();
    }
    if (b.dataset.carlockLeg) carlockPerTappa(trip, legs.find(x => x.id == b.dataset.carlockLeg));
    if (b.dataset.editLeg) { const q = legs.find(x => x.id == b.dataset.editLeg); legForm(trip, legs, q, costiDi(q)); }
    if (b.dataset.delLeg && await confirmDlg('Eliminare la tappa e la sua spesa gasolio?')) {
      const r = await api('/legs/' + b.dataset.delLeg, { method: 'DELETE' });
      toast(r.spese_tenute
        ? `Tappa eliminata \u00b7 ${r.spese_tenute === 1 ? 'una spesa resta' : r.spese_tenute + ' spese restano'} fra quelle del viaggio`
        : r.spese_tolte ? 'Tappa e spesa gasolio eliminate' : 'Tappa eliminata');
      restaQui();
    }
  });
  $('tbody').onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.editEx) expenseForm(trip, legs, expenses.find(x => x.id == b.dataset.editEx), soste);
    if (b.dataset.resetEx) { await api(`/expenses/${b.dataset.resetEx}/reset`, { method: 'POST' }); toast('Calcolo automatico ripristinato'); restaQui(); }
    if (b.dataset.delEx) {
      const auto = b.dataset.autoEx === '1';
      if (!await confirmDlg(auto
        ? 'Eliminare la spesa? \u00c8 calcolata da sola: la tappa smettera\u2019 di calcolarla, e non torna finche\u2019 non la riaccendi dalla tappa.'
        : 'Eliminare la spesa?')) return;
      const r = await api('/expenses/' + b.dataset.delEx, { method: 'DELETE' });
      toast(!r.calcolo_spento ? 'Spesa eliminata'
        : r.da === 'sosta' ? 'Spesa eliminata \u00b7 il costo della sosta resta fuori dalle spese'
        : 'Spesa eliminata \u00b7 la tappa non calcola piu\u2019 il gasolio');
      restaQui();
    }
  });
  $('#ph').onchange = safe(async e => { await caricaFoto(id, e.target.files); e.target.value = ''; });
  // Il collegamento apre l'app Foto da se': qui si dice solo cosa farne, perche'
  // aprirla e basta lascerebbe l'utente davanti alla libreria senza sapere come
  // portarne fuori uno scatto
  $('#apri-foto')?.addEventListener('click', () => toast('Trascina gli scatti dall\u2019app Foto su questa pagina'));
  // Le foto si tolgono una per volta col suo \u2715, oppure a gruppi: si entra in
  // selezione, si toccano quelle da togliere e si conferma una volta sola
  const scelteFoto = new Set();
  const aggiornaBarraFoto = () => {
    const barra = $('#barra-foto');
    if (!barra) return;
    barra.hidden = !scelteFoto.size;
    $('#quante-foto').textContent = scelteFoto.size;
    $$('#photos figure').forEach(f => f.classList.toggle('scelta', scelteFoto.has(+f.dataset.foto)));
  };
  let inSelezione = false;
  $('#selfoto')?.addEventListener('click', () => {
    inSelezione = !inSelezione;
    $('#selfoto').textContent = inSelezione ? '\u2716\ufe0f Esci dalla selezione' : '\u2611\ufe0f Seleziona';
    $('#photos').classList.toggle('in-selezione', inSelezione);
    if (!inSelezione) { scelteFoto.clear(); }
    aggiornaBarraFoto();
  });
  $('#annulla-foto')?.addEventListener('click', () => { scelteFoto.clear(); aggiornaBarraFoto(); });
  $('#elimina-foto')?.addEventListener('click', safe(async () => {
    const ids = [...scelteFoto];
    if (!ids.length) return;
    if (!await confirmDlg(ids.length === 1 ? 'Eliminare la foto selezionata?' : `Eliminare le ${ids.length} foto selezionate?`)) return;
    const r = await api('/photos/elimina', { method: 'POST', body: { ids } });
    toast(r.eliminate === 1 ? 'Foto eliminata' : `${r.eliminate} foto eliminate`);
    restaQui();
  }));
  $('#photos').onclick = safe(async e => {
    const fig = e.target.closest('figure[data-foto]');
    if (inSelezione && fig && !e.target.closest('[data-del-ph]')) {
      const id = +fig.dataset.foto;
      scelteFoto.has(id) ? scelteFoto.delete(id) : scelteFoto.add(id);
      return aggiornaBarraFoto();
    }
    const b = e.target.closest('[data-del-ph]');
    if (b && await confirmDlg('Eliminare la foto?')) { await api('/photos/' + b.dataset.delPh, { method: 'DELETE' }); restaQui(); }
  });
  // aggiorna quando i POI arrivano in background
  if (legs.some(l => !l.pois)) setTimeout(() => { if (location.hash === '#/trip/' + id) render(); }, 12000);
}

// Una sosta segnata: che tipo e', quando ci si sta, e la porta verso park4night
// Dove ci si ferma, secondo chi gira in camper: la sosta breve di passaggio,
// l'infratto — il posto tranquillo trovato per strada — l'area attrezzata, il
// camping, l'appartamento, e «altro» col nome che si vuole.
const TIPI_SOSTA = {
  sosta: ['\u23f8\ufe0f', 'Sosta'],
  infratto: ['\ud83c\udf32', 'Infratto'],
  area_sosta: ['\ud83c\udd7f\ufe0f', 'Area sosta'],
  camping: ['\u26fa', 'Camping'],
  appartamento: ['\ud83c\udfe0', 'Appartamento'],
  altro: ['\ud83d\udccd', 'Altro'],
};
const tipoIco = k => (TIPI_SOSTA[k] || TIPI_SOSTA.altro)[0];
const tipoNome = s => s.kind === 'altro' && s.kind_label ? s.kind_label : (TIPI_SOSTA[s.kind] || TIPI_SOSTA.altro)[1];

// Quante notti separano due date: e' il numero che si guarda davvero
const notti = (da, a) => (da && a) ? Math.max(0, Math.round((new Date(a) - new Date(da)) / 86400000)) : 0;
const stelline = n => n ? '\u2605'.repeat(n) + '\u2606'.repeat(5 - n) : '';

// Una sosta segnata: quando si arriva e si riparte, quanto e' piaciuta, quanto
// e' costata, e la porta verso park4night o qualunque altro indirizzo
const sostaRiga = (s, foto = [], copertina = null) => {
  const n = notti(s.from_date, s.to_date);
  const quando = !s.from_date ? '<i>giorni da decidere</i>'
    : fdate(s.from_date) + (s.arrival_time ? ` alle ${s.arrival_time}` : '')
      + (s.to_date && s.to_date !== s.from_date ? ` \u2192 ${fdate(s.to_date)}${s.departure_time ? ` alle ${s.departure_time}` : ''}` : (s.departure_time ? ` \u2192 ${s.departure_time}` : ''))
      + (n ? ` \u00b7 ${n} ${n === 1 ? 'notte' : 'notti'}` : '');
  return `<div class="item sosta" data-sosta-riga="${s.id}"><div class="item-main" style="cursor:default">
    <div class="sport-ico">${tipoIco(s.kind)}</div>
    <div class="grow"><div class="title">${esc(s.name)}${s.stars ? ` <span class="stelle" title="${s.stars} su 5">${stelline(s.stars)}</span>` : ''}</div>
      <div class="meta"><span class="badge ${s.kind === 'sosta' ? '' : 'ok'}">${esc(tipoNome(s))}</span> \u00b7 ${quando}${s.cost != null ? ` \u00b7 <b>${importoConValuta(s.cost, s.currency, s.rate)}</b>` : ''}${s.cost > 0 ? (s.in_spese ? ' \u00b7 <span class="badge ok" title="Il costo \u00e8 fra le spese del viaggio">nelle spese</span>' : ' \u00b7 <span class="badge warn" title="La spesa l\u2019hai tolta: il tasto \ud83d\udcb6 la rimette">fuori dalle spese</span>') : ''}</div>
      ${s.notes ? `<div class="meta">${esc(s.notes)}</div>` : ''}</div></div>
  <div class="item-actions">${s.cost > 0 && !s.in_spese ? `<button class="btn ghost icon" data-sostaspesa="${s.id}" title="Rimetti il costo fra le spese del viaggio">\ud83d\udcb6</button>` : ''}${s.link ? `<a class="btn ghost icon" href="${esc(s.link)}" target="_blank" rel="noopener" title="${s.p4n_id ? `Posto ${esc(s.p4n_id)} su park4night` : 'Apri il collegamento'}">${s.p4n_id ? '\ud83c\udd7f\ufe0f' : '\ud83d\udd17'}</a>` : ''}
    <button class="btn ghost icon" data-sosta="${s.id}" title="Modifica">\u270f\ufe0f</button>
    <button class="btn ghost danger icon" data-delsosta="${s.id}" title="Elimina">\ud83d\uddd1</button></div>
  <div class="foto-sosta">${foto.map(p => `<figure data-foto="${p.id}" class="${eVideo(p) ? 'e-video' : ''}"><a href="/uploads/${p.filename}" ${datiLente(p)} title="${esc(p.caption || (eVideo(p) ? 'Tocca per guardarlo' : 'Tocca per ingrandire'))}">${facciaMedia(p)}</a>${stellaCopertina(p, copertina)}<button class="del" data-del-ph="${p.id}" title="Elimina">\u2715</button></figure>`).join('')}
    <label class="aggiungi" title="${foto.length ? 'Aggiungi foto a questa sosta' : 'Metti le foto di questa sosta'}">
      <span class="ico">\ud83d\udcf7</span><span>${foto.length ? 'Aggiungi' : 'Foto'}</span>
      <input type="file" data-fotososta="${s.id}" accept="image/*" multiple hidden></label></div></div>`;
};

// Scheda di una sosta: il posto si cerca come ogni altro luogo, il tipo dice se
// e' un passaggio o una notte, e le date sono i giorni in cui ci si ferma
function sostaForm(trip, s = null, preimpostato = null) {
  let luogo = s?.lat != null ? { name: s.name, lat: s.lat, lon: s.lon } : preimpostato;
  let stelle = s?.stars || 0;
  const stella = n => `<button type="button" class="stella ${n <= stelle ? 'accesa' : ''}" data-stella="${n}" title="${n} su 5">\u2605</button>`;
  modal(`<h2>${s ? 'Modifica sosta' : 'Nuova sosta'}</h2><form id="f" class="stack" style="margin-top:14px">
    <div><label class="f">Posto</label><input id="luogo" required value="${esc(s?.name || preimpostato?.name || '')}" placeholder="Cerca area sosta, campeggio, paese\u2026" autocomplete="off"></div>
    <div><label class="f">Tipo</label><select name="kind" id="tipo">${Object.entries(TIPI_SOSTA).map(([k, [ico, nome]]) => `<option value="${k}" ${k === (s?.kind || 'area_sosta') ? 'selected' : ''}>${ico} ${nome}</option>`).join('')}</select></div>
    <div id="riga-altro" ${s?.kind === 'altro' ? '' : 'hidden'}><label class="f">Che cos\u2019\u00e8</label><input name="kind_label" value="${esc(s?.kind_label || '')}" placeholder="Es. agriturismo, parcheggio del rifugio, casa di amici"></div>
    <div class="form-grid">
      <div><label class="f">Arrivo</label><input type="date" name="from_date" value="${s?.from_date ? iso(s.from_date) : (trip.start_date ? iso(trip.start_date) : '')}"></div>
      <div><label class="f">Ora</label><input type="time" name="arrival_time" value="${esc(s?.arrival_time || '')}"></div>
      <div><label class="f">Partenza</label><input type="date" name="to_date" value="${s?.to_date ? iso(s.to_date) : ''}"></div>
      <div><label class="f">Ora</label><input type="time" name="departure_time" value="${esc(s?.departure_time || '')}"></div>
    </div>
    <div class="row" style="gap:10px;align-items:flex-end">
      <div class="field w-sm"><label class="f">Notti</label><input type="number" min="0" max="120" id="notti" value="${notti(s?.from_date, s?.to_date) || ''}" placeholder="0"></div>
      <div class="grow small muted" id="quanti-giorni"></div>
    </div>
    <div><label class="f">Gradimento</label>
      <div class="stelle-scelta" id="stelle">${[1, 2, 3, 4, 5].map(stella).join('')}
        <button type="button" class="btn ghost sm" data-stella="0" title="Togli il giudizio" style="margin-left:8px">\u2715</button></div></div>
    <div class="form-grid">
      <div><label class="f">Costo</label><input type="text" inputmode="decimal" name="cost" value="${s?.cost ?? ''}" placeholder="Es. 18,50"></div>
      <div><label class="f">Valuta</label>${scegliValuta('currency', s?.currency)}</div>
    </div>
    <div class="small muted" style="margin-top:-4px">Il costo entra da solo fra le spese del viaggio, e si aggiorna se lo cambi. Dalle spese lo puoi togliere quando vuoi.</div>
    <div><label class="f">Numero park4night</label><input name="p4n_id" inputmode="numeric" value="${esc(s?.p4n_id || '')}" placeholder="Es. 277443"></div>
    <div class="small muted" style="margin-top:-4px">È il numero della scheda del posto; va bene anche incollare l’indirizzo intero. Da quello il collegamento qui sotto si rifa’ da sé e apre il posto, non la ricerca intorno.</div>
    <div><label class="f">Collegamento</label><input name="link" value="${esc(s?.link || preimpostato?.park4night || '')}" placeholder="park4night, sito del campeggio, qualunque indirizzo"></div>
    <div><label class="f">Commenti</label><textarea name="notes" rows="2" placeholder="Es. carico acqua, silenzioso, ombra la mattina">${esc(s?.notes || '')}</textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">${s ? 'Salva' : 'Aggiungi'}</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      geoInput($('#luogo', el), r => luogo = r);
      // Il nome scritto a mano serve solo ad «altro»: altrimenti sta nascosto
      const tipo = $('#tipo', el);
      const mostraAltro = () => { $('#riga-altro', el).hidden = tipo.value !== 'altro'; };
      tipo.onchange = mostraAltro;
      mostraAltro();

      // Date e notti dicono la stessa cosa: chi tocca l'una aggiorna l'altra
      const dal = $('[name=from_date]', el), al = $('[name=to_date]', el), quante = $('#notti', el);
      const mostraGiorni = () => {
        const n = notti(dal.value, al.value);
        $('#quanti-giorni', el).textContent = !dal.value ? 'Scegli la data di arrivo'
          : n ? `${n} ${n === 1 ? 'notte' : 'notti'} \u00b7 ${n + 1} giorni` : 'Stesso giorno, nessun pernotto';
      };
      const daDate = () => { quante.value = notti(dal.value, al.value) || ''; mostraGiorni(); };
      dal.onchange = al.onchange = daDate;
      quante.oninput = () => {
        const n = Math.max(0, Math.round(+quante.value || 0));
        if (!dal.value) return;
        const d = new Date(dal.value + 'T12:00:00'); d.setDate(d.getDate() + n);
        al.value = iso(d); mostraGiorni();
      };
      mostraGiorni();

      const disegnaStelle = () => $$('[data-stella]', el).forEach(b => b.classList.toggle('accesa', +b.dataset.stella && +b.dataset.stella <= stelle));
      $$('[data-stella]', el).forEach(b => b.onclick = () => { stelle = +b.dataset.stella; disegnaStelle(); });

      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        const corpo = { ...fd, stars: stelle || '', name: $('#luogo', el).value.trim() || luogo?.name,
          lat: luogo?.lat ?? s?.lat ?? null, lon: luogo?.lon ?? s?.lon ?? null,
          source: preimpostato ? 'osm' : (s?.source || 'manuale') };
        if (s) await api('/soste/' + s.id, { method: 'PUT', body: corpo });
        else await api(`/trips/${trip.id}/soste`, { method: 'POST', body: corpo });
        close(); restaQui();
      });
    });
}

// Un itinerario pensato su Google Maps diventa tappe: ogni tratto fra due punti
// e' una tappa, con la distanza vera su strada e il gasolio che ne consegue.
// Da un testo incollato si pesca il primo indirizzo: la condivisione di Maps
// sul telefono manda il nome del percorso e sotto il link, e chiedere all'utente
// di ritagliarlo a mano sarebbe fargli fare il lavoro del programma.
const linkNelTesto = t => (String(t || '').match(/https?:\/\/[^\s<>"']+/) || [])[0] || '';

// Il posto da cui si riparte: l'arrivo dell'ultima tappa, o casa. Serve per
// aprire Maps gia' al punto giusto invece che su una mappa qualunque.
const mapsDaCui = legs => {
  const u = legs?.[legs.length - 1];
  const dove = u?.to_lat != null ? `${u.to_lat},${u.to_lon}` : '';
  return dove ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(dove)}` : 'https://www.google.com/maps';
};

// Un itinerario pensato su Google Maps diventa tappe: ogni tratto fra due punti
// e' una tappa, con la distanza vera su strada e il gasolio che ne consegue.
// Si incolla e basta: leggere il collegamento non e' un'altra decisione da
// prendere, e' l'unica cosa che si puo' fare con un collegamento incollato.
function tappeDaMaps(trip, legs) {
  const ultima = legs[legs.length - 1];
  let punti = [], lettoOra = '';
  modal(`<h2>\ud83d\uddfa\ufe0f Tappe da Google Maps</h2>
    <p class="small muted">Su Maps: <b>Indicazioni</b> \u2192 <b>Condividi</b> \u2192 <b>Copia link</b>. Poi incolla qui \u2014 va bene anche tutto il testo che Maps condivide, e il link corto.</p>
    <form id="f" class="stack">
      <div class="row" style="gap:6px;align-items:flex-end">
        <div class="grow"><label class="f">Collegamento</label><input name="url" placeholder="Incolla qui" autocomplete="off"></div>
        <button type="button" class="btn" id="incolla" title="Prendi quello che hai copiato">\ud83d\udccb Incolla</button>
      </div>
      <div class="row between small">
        <a class="btn sm" href="${mapsDaCui(legs)}" target="_blank" rel="noopener">\ud83d\uddfa\ufe0f Apri Google Maps${ultima ? ' da ' + esc(String(ultima.to_name).split(',')[0]) : ''}</a>
        <span class="muted" id="stato-link"></span>
      </div>
      <div class="form-grid">
        <div><label class="f">Data della prima tappa</label><input type="date" name="date" value="${ultima?.date ? iso(ultima.date) : (trip.start_date ? iso(trip.start_date) : today())}"></div>
        <div style="align-self:end"><label class="riga-scelta"><input type="checkbox" name="un_giorno"> Un giorno per tappa</label></div>
      </div>
      <div id="letti"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary" id="crea" disabled>Crea le tappe</button></div>
    </form>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    const campo = $('[name=url]', el), stato = $('#stato-link', el);
    const leggi = safe(async testo => {
      const url = linkNelTesto(testo) || String(testo || '').trim();
      if (!url || url === lettoOra) return;
      lettoOra = url;
      stato.textContent = 'leggo\u2026';
      $('#letti', el).innerHTML = '';
      let r;
      try { r = await api('/maps/percorso', { method: 'POST', body: { url } }); }
      catch (e) { stato.textContent = ''; $('#letti', el).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      punti = r.punti;
      stato.textContent = '';
      if (punti.length < 2) return $('#letti', el).innerHTML = '<div class="empty">Serve almeno una partenza e un arrivo.</div>';
      const tratti = punti.slice(1).map((p, i) => `${esc(String(punti[i].name).split(',')[0])} \u2192 ${esc(String(p.name).split(',')[0])}`);
      $('#letti', el).innerHTML = `<div class="small"><b>${tratti.length} ${tratti.length === 1 ? 'tappa' : 'tappe'}</b> da ${punti.length} punti</div>
        <div class="quali-tappe" style="margin-top:6px">${tratti.map((t, i) => `<div class="small">${i + 1}. ${t}</div>`).join('')}</div>
        ${r.non_trovati.length ? `<div class="small muted" style="margin-top:6px">Non riconosciuti e saltati: ${esc(r.non_trovati.join(', '))}</div>` : ''}`;
      $('#crea', el).disabled = false;
    });
    // Incollato il collegamento, si legge da se': era l'unica cosa da farci
    campo.addEventListener('paste', e => setTimeout(() => leggi(campo.value), 0));
    let attesa;
    campo.addEventListener('input', () => { clearTimeout(attesa); attesa = setTimeout(() => leggi(campo.value), 700); });
    $('#incolla', el).onclick = safe(async () => {
      let testo = '';
      try { testo = await navigator.clipboard.readText(); }
      catch { return toast('Il browser non mi lascia leggere gli appunti: incolla nel campo con \u2318V', true); }
      campo.value = linkNelTesto(testo) || testo.trim();
      leggi(campo.value);
    });
    setTimeout(() => campo.focus(), 50);
    $('#f', el).onsubmit = safe(async e => {
      e.preventDefault();
      if (punti.length < 2) return toast('Incolla prima un percorso di Google Maps', true);
      const fd = Object.fromEntries(new FormData(e.target));
      $('#crea', el).disabled = true; $('#crea', el).textContent = 'Creo le tappe\u2026';
      let quante = 0;
      for (let i = 1; i < punti.length; i++) {
        const giorno = fd.date && fd.un_giorno
          ? iso(new Date(new Date(fd.date + 'T12:00:00').getTime() + (i - 1) * 86400000))
          : (fd.date || null);
        await api(`/trips/${trip.id}/legs`, { method: 'POST', body: { from: punti[i - 1], to: punti[i], date: giorno } });
        quante++;
      }
      close();
      toast(quante === 1 ? 'Tappa creata' : `${quante} tappe create`);
      restaQui();
    });
  });
}

// Un appunto o un indirizzo. Del link basta l'indirizzo: il titolo, se non lo
// si scrive, lo va a leggere il servizio sulla pagina stessa.
function materialeForm(tripId, tipo, m = null) {
  const link = tipo === 'link';
  modal(`<h2>${m ? 'Modifica appunto' : link ? 'Nuovo link' : 'Nuovo appunto'}</h2><form id="f" class="stack" style="margin-top:14px">
    ${link ? `<div><label class="f">Indirizzo</label><input name="url" required placeholder="www.esempio.it/pagina" autocomplete="off"></div>` : ''}
    <div><label class="f">Titolo${link ? ' (vuoto = quello della pagina)' : ''}</label><input name="titolo" value="${esc(m?.titolo || '')}" placeholder="${link ? 'Lo leggo dal sito' : 'Es. traghetti per la Sardegna'}"></div>
    ${link ? '' : `<div><label class="f">Appunto</label><textarea name="testo" rows="7" placeholder="Quello che non deve andare perso: orari, numeri, prezzi, chi ha detto cosa">${esc(m?.testo || '')}</textarea></div>`}
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        if (m) await api('/materiali/' + m.id, { method: 'PUT', body: { titolo: fd.titolo, testo: fd.testo } });
        else await api(`/trips/${tripId}/materiali`, { method: 'POST', body: { ...fd, tipo } });
        close(); restaQui();
      });
    });
}

function legForm(trip, legs, leg = null, costi = null) {
  const last = legs[legs.length - 1];
  let from = leg ? { name: leg.from_name, lat: leg.from_lat, lon: leg.from_lon } : last ? { name: last.to_name, lat: last.to_lat, lon: last.to_lon } : null;
  let to = leg ? { name: leg.to_name, lat: leg.to_lat, lon: leg.to_lon } : null;
  // Le strade possibili fra i due punti, con quanto costano. Si cercano da sole
  // appena ci sono partenza e arrivo: chiederle con un tasto sarebbe far premere
  // un tasto per avere l'unica cosa che serve.
  let varianti = [], scelta = null, sceltaEsplicita = false, cercandoPer = '';
  modal(`<h2>${leg ? 'Modifica tappa' : 'Nuova tappa'}</h2><form id="f" class="stack" style="margin-top:14px">
    <div><label class="f">Come</label><select name="mezzo" id="mezzo">${Object.entries(MEZZI).map(([k, [ico, nome]]) => `<option value="${k}" ${k === mezzoDi(leg) ? 'selected' : ''}>${ico} ${nome}</option>`).join('')}</select></div>
    <div><label class="f">Partenza</label><input id="from" required value="${esc(from?.name || '')}" placeholder="Cerca citt\u00e0 o luogo\u2026" autocomplete="off"></div>
    <div><label class="f">Arrivo</label><input id="to" required value="${esc(to?.name || '')}" placeholder="Cerca citt\u00e0 o luogo\u2026" autocomplete="off"></div>
    <div class="form-grid"><div><label class="f">Data</label><input type="date" name="date" value="${leg?.date ? iso(leg.date) : (last?.date ? iso(last.date) : (trip.start_date ? iso(trip.start_date) : today()))}"></div>
      <div id="riga-gasolio"><label class="f">Gasolio \u20ac/l (vuoto = ${trip.fuel_price ?? settings.vehicle?.fuel_price})</label><input type="number" step="0.001" name="fuel_price" value="${leg?.fuel_price ?? ''}" placeholder="${trip.fuel_price ?? settings.vehicle?.fuel_price}"></div></div>
    <div id="biglietto" hidden class="stack">
      <div class="form-grid">
        <div><label class="f">Compagnia</label><input name="compagnia" value="${esc(leg?.compagnia || '')}" placeholder="Es. Moby, ITA Airways, Trenitalia"></div>
        <div><label class="f">Numero</label><input name="codice" value="${esc(leg?.codice || '')}" placeholder="Es. MY 512, AZ 1234, IC 589"></div>
      </div>
      <div class="form-grid">
        <div><label class="f">Partenza (ora)</label><input type="time" name="start_time" value="${esc(leg?.start_time || '')}"></div>
        <div><label class="f">Arrivo (ora)</label><input type="time" name="end_time" value="${esc(leg?.end_time || '')}"></div>
        <div><label class="f">Tariffa</label><input type="text" inputmode="decimal" name="tariffa" value="${leg?.tariffa ?? ''}" placeholder="Es. 180,50"></div>
        <div><label class="f">Valuta</label>${scegliValuta('tariffa_currency', leg?.tariffa_currency)}</div>
      </div>
      <div><label class="f">Sconto</label><input name="sconto" value="${esc(leg?.sconto || '')}" placeholder="Es. socio Touring -10%, bimbi gratis"></div>
      <div><label class="f">Condizioni</label><textarea name="condizioni" rows="2" placeholder="Es. cabina interna, camper fino a 7 m, modificabile entro 48 h, bagaglio 20 kg">${esc(leg?.condizioni || '')}</textarea></div>
      <p class="small muted" style="margin:-4px 0 0">La tariffa entra da sola fra le spese del viaggio, nella categoria del mezzo. I chilometri di questa tappa non contano come chilometri di camper, e le ore non sono ore di guida.</p>
    </div>
    <div><label class="f">Note</label><input name="notes" value="${esc(leg?.notes || '')}"></div>
    <div id="costi-camper">${leg ? `<div class="form-grid">
      <div><label class="f">Costo gasolio €</label><input type="number" step="0.01" min="0" name="costo_gasolio" value="${costi?.gMano && costi.g != null ? (+costi.g).toFixed(2) : ''}" placeholder="${costi?.g != null ? (+costi.g).toFixed(2) : 'calcolato'}"></div>
      <div><label class="f">Km in autostrada</label><input type="number" step="0.1" min="0" name="pedaggio_km" value="${leg.pedaggio_km ?? ''}" placeholder="0"></div>
      <div><label class="f">Costo pedaggi €</label><input type="number" step="0.01" min="0" name="costo_pedaggio" value="${costi?.pMano && costi.p != null ? (+costi.p).toFixed(2) : ''}" placeholder="${costi?.p != null ? (+costi.p).toFixed(2) : 'calcolato'}"></div></div>
    <p class="small muted" style="margin:-4px 0 0">Lascia vuoti gli importi e li calcola: il gasolio dai chilometri e dal prezzo al litro, il pedaggio dai chilometri di autostrada a ${eur(settings.vehicle?.toll_per_km ?? 0.09)} al km. Scrivi una cifra e resta quella, anche nel totale del viaggio; svuota il campo per tornare al calcolo.</p>
    <label class="riga-scelta"><input type="checkbox" name="gasolio" ${leg.senza_gasolio ? '' : 'checked'}> Calcola da solo il gasolio di questa tappa
      <span class="small muted">${leg.senza_gasolio ? 'Ora e\u2019 spento: la spesa l\u2019hai tolta a mano.' : 'La spesa si aggiorna con i chilometri e il prezzo.'}</span></label>
    <label class="riga-scelta"><input type="checkbox" name="pedaggio" ${leg.senza_pedaggio ? '' : 'checked'}> Calcola da solo il pedaggio di questa tappa
      <span class="small muted">${leg.senza_pedaggio ? 'Ora e\u2019 spento: la spesa l\u2019hai tolta a mano.' : 'Senza chilometri di autostrada non viene nessuna spesa.'}</span></label>` : ''}</div>
    <div id="strade"></div><div id="pmap" class="map sm" style="display:none"></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">${leg ? 'Salva' : 'Aggiungi'}</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      const kml = num(trip.km_per_liter, 10) || 10;
      const prezzo = () => +String($('[name=fuel_price]', el).value || trip.fuel_price || settings.vehicle?.fuel_price || 0).replace(',', '.');
      let pmap;

      const disegna = () => {
        const tracce = (scelta?.tratte || []).flatMap(x => x.geometry || []);
        const m = $('#pmap', el);
        if (!tracce.length) { m.style.display = 'none'; return; }
        m.style.display = 'block';
        if (!pmap) pmap = makeMap(m, { simple: true });
        else pmap.eachLayer(l => l instanceof L.Polyline && pmap.removeLayer(l));
        pmap.invalidateSize();
        pmap.fitBounds(L.polyline(tracce, { color: '#0f766e', weight: 4 }).addTo(pmap).getBounds(), { padding: [10, 10] });
      };

      const mostra = () => {
        $('#strade', el).innerHTML = varianti.map(x => {
          const litri = x.distance_km / kml;
          return `<div class="variante ${x.chiave === scelta?.chiave ? 'scelto' : ''}" data-variante="${x.chiave}">
            <div class="row between"><b>${esc(x.nome)}</b><b>${num(x.distance_km)} km</b></div>
            <div class="small muted">${dur(x.duration_min * 60)} di guida \u00b7 ${num(litri)} l \u00b7 <b>${eur(litri * prezzo())}</b> di gasolio${x.stimato ? ' \u00b7 \u26a0\ufe0f distanza stimata' : ''}</div>
            ${x.pedaggio_km == null ? '' : x.pedaggio_km > 0
              ? `<div class="small muted">\ud83d\udee3\ufe0f ${num(x.pedaggio_km)} km a pedaggio \u00b7 <b>${eur(x.pedaggio)}</b> stimati</div>`
              : '<div class="small muted">\ud83d\udee3\ufe0f nessun tratto a pedaggio</div>'}</div>`;
        }).join('') + (scelta ? `<div class="small" style="margin-top:6px"><a class="btn sm" href="${mapsPerVariante(from, to, scelta)}" target="_blank" rel="noopener">\ud83d\uddfa\ufe0f Vedi su Google Maps${varianti.length > 1 ? ` \u00b7 ${esc(scelta.nome.toLowerCase())}` : ''}</a></div>` : '');
        $$('[data-variante]', el).forEach(c => c.onclick = () => {
          scelta = varianti.find(x => x.chiave === c.dataset.variante);
          sceltaEsplicita = true;
          mostra(); disegna();
        });
      };

      // Un traghetto o un volo non hanno strade fra cui scegliere e non
      // consumano gasolio: i pezzi che parlano di strada se ne vanno, e al loro
      // posto compare il biglietto
      const mezzo = () => $('#mezzo', el).value;
      const mostraMezzo = () => {
        const camper = mezzo() === 'camper';
        $('#biglietto', el).hidden = camper;
        $('#riga-gasolio', el).hidden = !camper;
        $('#costi-camper', el).hidden = !camper;
        $('#strade', el).hidden = !camper;
        if (!camper) $('#pmap', el).style.display = 'none';
        if (camper) cerca();
      };

      const cerca = safe(async () => {
        if (mezzo() !== 'camper') return;
        if (!from?.lat || !to?.lat) { $('#strade', el).innerHTML = '<div class="small muted">Scegli partenza e arrivo dai suggerimenti: le strade possibili le trovo da sola.</div>'; return; }
        const chiave = `${from.lat},${from.lon}>${to.lat},${to.lon}`;
        if (chiave === cercandoPer) return;
        cercandoPer = chiave;
        $('#strade', el).innerHTML = '<div class="small muted">Cerco le strade possibili\u2026</div>';
        let r;
        try { r = await api('/route/opzioni', { method: 'POST', body: { punti: [from, to], km_per_liter: kml, fuel_price: prezzo() } }); }
        catch (e) {
          cercandoPer = '';
          $('#strade', el).innerHTML = `<div class="small muted">${esc(e.message)} \u00b7 <button type="button" class="btn sm ghost" id="riprova">Riprova</button></div>`;
          $('#riprova', el).onclick = cerca;
          return;
        }
        varianti = r.varianti || [];
        scelta = varianti[0] || null;
        sceltaEsplicita = false;
        mostra(); disegna();
      });

      geoInput($('#from', el), r => { from = r; cerca(); });
      geoInput($('#to', el), r => { to = r; cerca(); });
      $('[name=fuel_price]', el).addEventListener('input', () => { if (varianti.length) mostra(); });
      $('#mezzo', el).onchange = mostraMezzo;
      mostraMezzo();

      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        if (!from?.lat || !to?.lat) return toast('Scegli partenza e arrivo dai suggerimenti', true);
        const fd = Object.fromEntries(new FormData(e.target));
        const body = { from, to, date: fd.date || null, fuel_price: fd.fuel_price || null, notes: fd.notes,
          mezzo: fd.mezzo, compagnia: fd.compagnia, codice: fd.codice, tariffa: fd.tariffa,
          tariffa_currency: fd.tariffa_currency, condizioni: fd.condizioni, sconto: fd.sconto,
          start_time: fd.start_time, end_time: fd.end_time };
        if (leg) {
          body.senza_gasolio = !fd.gasolio;
          body.senza_pedaggio = !fd.pedaggio;
          body.pedaggio_km = fd.pedaggio_km ?? '';
          // Stringa vuota vuol dire «torna a calcolarlo»: va distinta dal campo
          // che nessuno ha toccato, e per questo si manda sempre
          body.costo_gasolio = fd.costo_gasolio ?? '';
          body.costo_pedaggio = fd.costo_pedaggio ?? '';
        }
        // La strada scelta si porta dietro il suo disegno. Su una tappa che
        // esiste gia' si manda solo se e' stata scelta davvero: una tappa di
        // CarLock ha il tracciato vero, e non va sostituito da uno previsto.
        if (fd.mezzo === 'camper' && scelta?.tratte?.[0]?.geometry && (!leg || sceltaEsplicita)) {
          body.percorso = { distance_km: scelta.distance_km, duration_min: scelta.duration_min, geometry: scelta.tratte[0].geometry, stimato: scelta.stimato,
            pedaggio_km: scelta.tratte[0].pedaggio_km ?? scelta.pedaggio_km ?? null };
        }
        const r = leg ? await api('/legs/' + leg.id, { method: 'PUT', body }) : await api(`/trips/${trip.id}/legs`, { method: 'POST', body });
        if (r.routing_warning) toast(r.routing_warning, true);
        close(); restaQui();
      });
    });
}

// Il percorso vero di una tappa sola. Il file di CarLock copre mesi: qui si
// guardano solo i tragitti intorno al giorno di questa tappa, e se ne sceglie
// uno — o piu' d'uno, se quel giorno si e' viaggiato a pezzi.
function carlockPerTappa(trip, leg) {
  let tratte = [];
  modal(`<h2>\ud83d\udce1 Percorso reale di questa tappa</h2>
    <p class="small muted"><b>${esc(String(leg.from_name).split(',')[0])} \u2192 ${esc(String(leg.to_name).split(',')[0])}</b>${leg.date ? ` \u00b7 ${fdate(leg.date)}` : ''} \u00b7 ora ${num(leg.distance_km)} km.
      Da <b>my.carlock.co</b> \u2192 Trips \u2192 icona <b>CSV</b>. La tappa prende i chilometri e gli orari veri; le altre non si toccano.</p>
    <form id="f" class="stack">
      <input type="file" name="file" accept=".csv,.xls,.xlsx,text/csv" required>
      <div class="form-grid">
        <div><label class="f">Giorni intorno alla tappa</label><select name="giorni">${[0, 1, 3, 7, 30].map(g => `<option value="${g}" ${g === 1 ? 'selected' : ''}>${g === 0 ? 'solo quel giorno' : '\u00b1 ' + g + (g === 1 ? ' giorno' : ' giorni')}</option>`).join('')}</select></div>
        <div><label class="f">Unisci soste pi\u00f9 brevi di (min)</label><input type="number" name="merge_gap_min" value="30"></div>
      </div>
      <div id="tratte"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary" id="applica" disabled>Porta nella tappa</button></div>
    </form>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    const leggi = safe(async () => {
      if (!$('[name=file]', el).files[0]) return;
      $('#tratte', el).innerHTML = '<div class="muted small">Leggo il file\u2026</div>';
      const fd = new FormData($('#f', el));
      const r = await api(`/legs/${leg.id}/carlock?preview=1`, { method: 'POST', body: fd });
      tratte = r.tratte;
      if (!tratte.length) { $('#tratte', el).innerHTML = `<div class="empty">Nessun tragitto in questo periodo (${r.nel_file} nel file). Allarga i giorni intorno alla tappa.</div>`; $('#applica', el).disabled = true; return; }
      $('#tratte', el).innerHTML = `<div class="small muted">Scegli il tragitto \u2014 pi\u00f9 d\u2019uno diventa una tappa sola</div>
        <div class="quali-tappe" style="margin-top:6px">${tratte.map((t, i) => `<label><input type="checkbox" class="una-tratta" value="${i}">
          <span>${fdate(t.date)} ${t.start}\u2013${t.end} \u00b7 ${esc(t.from)} \u2192 ${esc(t.to)}
          <span class="muted">\u00b7 ${num(t.km)} km${t.merged > 1 ? ` \u00b7 ${t.merged} tratte` : ''}</span></span></label>`).join('')}</div>`;
      const spunte = $$('.una-tratta', el);
      spunte.forEach(c => c.onchange = () => { $('#applica', el).disabled = !$$('.una-tratta:checked', el).length; });
      // Con un solo candidato la scelta e' gia' fatta
      if (spunte.length === 1) { spunte[0].checked = true; $('#applica', el).disabled = false; }
    });
    $('[name=file]', el).onchange = leggi;
    $('[name=giorni]', el).onchange = leggi;
    $('[name=merge_gap_min]', el).onchange = leggi;
    $('#f', el).onsubmit = safe(async e => {
      e.preventDefault();
      const scelte = $$('.una-tratta:checked', el).map(c => tratte[+c.value].external_id);
      if (!scelte.length) return toast('Scegli almeno un tragitto', true);
      $('#applica', el).disabled = true; $('#applica', el).textContent = 'Porto nella tappa\u2026';
      const fd = new FormData($('#f', el));
      fd.set('scelte', scelte.join('\n'));
      const r = await api(`/legs/${leg.id}/carlock`, { method: 'POST', body: fd });
      close();
      toast(`Tappa aggiornata: ${num(r.km)} km reali${r.tratte > 1 ? ` da ${r.tratte} tratte` : ''}`);
      restaQui();
    });
  });
}

function carlockImport(trip, openTrips = [], sostituisciDefault = false) {
  // Le tappe previste sono quelle senza identificativo CarLock: se ce ne sono,
  // si puo' scegliere di lasciargli il posto invece di affiancarle
  const previste = (trip?.legs || []).filter(l => !l.external_id);
  modal(`<h2>\ud83d\udce1 ${sostituisciDefault ? 'Sostituisci con il percorso reale' : 'Importa da CarLock'}</h2>
    <p class="small muted">Su <b>my.carlock.co</b> → Trips → scegli le date → icona <b>CSV</b> (va bene anche l'XLS). Ogni tragitto diventa una tappa con i km reali percorsi; il gasolio viene calcolato su quelli.</p>
    <form id="f" class="stack">
      <input type="file" name="file" accept=".csv,.xls,.xlsx,text/csv" required>
      ${trip ? '' : `<div><label class="f">In quale viaggio</label><select id="dest"><option value="new">➕ Nuovo viaggio (date prese dal file)</option>${openTrips.map(t => `<option value="${t.id}">${esc(nomeViaggio(t))} (${dateViaggio(t)})</option>`).join('')}</select></div>`}
      <div class="form-grid"><div><label class="f">Ignora tratte sotto (km)</label><input type="number" step="0.5" name="min_km" value="3"></div><div><label class="f">Unisci soste più brevi di (min)</label><input type="number" name="merge_gap_min" value="30"></div></div>
      ${previste.length ? `<label class="row small" style="align-items:flex-start;gap:8px;flex-wrap:nowrap"><input type="checkbox" id="sost" ${sostituisciDefault ? 'checked' : ''} style="flex:0 0 auto;margin-top:2px">
        <span class="grow">Sostituisci le <b>tappe previste</b> con quelle davvero percorse<br><span class="muted">Le tappe scelte e il loro gasolio stimato spariscono; restano le spese che hai scritto tu.</span></span></label>
      <div class="quali-tappe" id="quali" ${sostituisciDefault ? '' : 'hidden'}>
        <div class="small muted">Quali sostituire \u2014 togli la spunta a quelle che vuoi tenere</div>
        ${previste.map((l, i) => `<label><input type="checkbox" class="una-tappa" value="${l.id}" checked>
          <span>${i + 1}. ${esc(String(l.from_name).split(',')[0])} \u2192 ${esc(String(l.to_name).split(',')[0])}
          <span class="muted">\u00b7 ${l.date ? fdate(l.date) : 'senza data'} \u00b7 ${num(l.distance_km)} km</span></span></label>`).join('')}
        <div class="row" style="gap:6px"><button type="button" class="btn sm ghost" id="tutte">Tutte</button><button type="button" class="btn sm ghost" id="nessuna">Nessuna</button></div>
      </div>` : ''}
      <label class="row small" id="datesRow" ${trip ? '' : 'style="display:none"'}><input type="checkbox" name="only_trip_dates" checked style="width:auto"> Solo le date del viaggio${trip ? ` (${trip.start_date ? fdate(trip.start_date) : '…'} → ${trip.end_date ? fdate(trip.end_date) : 'oggi'})` : ''}</label>
      <div class="row"><label class="row small" style="flex:0 0 auto"><input type="checkbox" id="splitChk" ${trip ? '' : 'checked'} style="width:auto"> Dividi in viaggi separati (casa → casa)</label><div class="grow"><input name="split_home" value="Susegana" placeholder="Nome di casa (es. Susegana)"></div></div>
      <div id="prev"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button type="button" class="btn" id="pv">Anteprima</button><button class="btn primary" id="go" disabled>Importa</button></div>
    </form>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    const dest = () => trip ? String(trip.id) : $('#dest', el).value;
    $('#dest', el)?.addEventListener('change', () => { $('#datesRow', el).style.display = dest() === 'new' ? 'none' : ''; $('#go', el).disabled = true; });
    // L'elenco delle tappe da sostituire si mostra solo quando serve
    $('#sost', el)?.addEventListener('change', e => { $('#quali', el).hidden = !e.target.checked; });
    $('#tutte', el)?.addEventListener('click', () => $$('.una-tappa', el).forEach(c => c.checked = true));
    $('#nessuna', el)?.addEventListener('click', () => $$('.una-tappa', el).forEach(c => c.checked = false));
    const fd = () => { const f = new FormData($('#f', el)); f.set('only_trip_dates', dest() !== 'new' && $('[name=only_trip_dates]', el).checked ? 'true' : 'false'); if (!$('#splitChk', el).checked) f.delete('split_home'); if ($('#sost', el)?.checked) f.set('sostituisci_ids', $$('.una-tappa:checked', el).map(c => c.value).join(',')); return f; };
    let last = null;
    // per "nuovo viaggio" l'anteprima usa un viaggio aperto qualsiasi solo per leggere il file (nessun filtro date)
    const previewTrip = () => dest() === 'new' ? 'new' : dest();
    $('#pv', el).onclick = safe(async () => {
      if (!$('[name=file]', el).files[0]) return toast('Scegli il file esportato da CarLock', true);
      $('#prev', el).innerHTML = '<div class="muted small">Analizzo il file…</div>';
      const r = last = await api(`/trips/${previewTrip()}/import/carlock?preview=1`, { method: 'POST', body: fd() });
      $('#prev', el).innerHTML = `<div class="small" style="margin-bottom:6px"><b>${r.to_import} tappe</b> per <b>${num(r.km)} km</b> · ${r.total} tragitti nel file${r.out_of_range ? `, ${r.out_of_range} fuori dalle date` : ''}${r.short ? `, ${r.short} troppo brevi` : ''}${r.duplicates ? `, ${r.duplicates} già importati` : ''}</div>
        <div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:10px"><table><tbody>${r.legs.map(l => `<tr><td class="small nowrap">${fdate(l.date)} ${l.start}</td><td class="small">${esc(l.from)} → ${esc(l.to)}${l.merged > 1 ? ` <span class="muted">(${l.merged} tratte)</span>` : ''}</td><td class="num small">${num(l.km)} km</td></tr>`).join('') || '<tr><td class="empty">Niente da importare</td></tr>'}</tbody></table></div>`;
      $('#go', el).disabled = !r.to_import;
    });
    $('#f', el).onsubmit = safe(async e => {
      e.preventDefault(); $('#go', el).disabled = true; $('#go', el).textContent = 'Importo… (geocodifica in corso)';
      let target = dest();
      if (target === 'new') {
        const t = await api('/trips', { method: 'POST', body: { title: `Viaggio CarLock ${last?.first_date ? fdate(last.first_date) : ''}`.trim(), start_date: last?.first_date || null, end_date: last?.last_date || null } });
        target = t.id;
      }
      const r = await api(`/trips/${target}/import/carlock`, { method: 'POST', body: fd() });
      close();
      if (r.split?.created?.length) { toast(`Importate ${r.imported} tappe, divise in ${r.split.created.length} viaggi`); location.hash = '#/'; render(); return; }
      if (!trip) location.hash = '#/trip/' + target;
      if (!r.imported && r.geocode_failed.length) modal(`<h2>Import non riuscito</h2>
        <p>${r.geocode_failed.length === 1 ? 'Non ho trovato sulla mappa questo indirizzo' : `Non ho trovato sulla mappa questi ${r.geocode_failed.length} indirizzi`}, scritti così da CarLock:</p>
        <ul class="small" style="margin:0 0 10px 18px">${r.geocode_failed.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        ${r.geocode_errors?.length
          ? `<p class="small muted">Il servizio di ricerca ha risposto: ${esc(r.geocode_errors.join(' · '))}</p><p class="small">Qui conviene riprovare fra qualche minuto: i geocoder gratuiti limitano le richieste.</p>`
          : `<p class="small">Il servizio ha risposto senza errori: quel nome, per la mappa, non esiste. Scrivi la tappa a mano, oppure correggi l'indirizzo nel file di CarLock e riprova.</p>`}
        <div class="row" style="justify-content:flex-end"><button class="btn primary" data-x>Ok</button></div>`, (el2, close2) => $('[data-x]', el2).onclick = close2);
      else toast(`Importate ${r.imported} tappe (${num(r.km)} km)`
        + (r.sostituite ? ` \u00b7 ${r.sostituite === 1 ? 'una prevista sostituita' : r.sostituite + ' previste sostituite'}` : '')
        + (r.geocode_failed.length ? ` \u00b7 ${r.geocode_failed.length} indirizzi non trovati` : ''), !!r.geocode_failed.length);
      render();
    });
  });
}

function expenseForm(trip, legs, ex = null, soste = []) {
  const cats = settings.categories || Object.keys(CAT);
  // I posti del viaggio che si conoscono gia': dove si e' dormito e dove si e'
  // arrivati. Sono suggerimenti, non una gabbia: il luogo si scrive comunque a mano
  const luoghiNoti = [...new Set([
    ...soste.map(x => x.name),
    ...legs.flatMap(l => [l.to_name, l.from_name]).map(n => String(n || '').split(',')[0].trim()),
  ].filter(Boolean))].slice(0, 40);
  modal(`<h2>${ex ? 'Modifica spesa' : 'Nuova spesa'}</h2>${ex?.auto ? '<p class="small muted">Spesa calcolata automaticamente: se la modifichi non verrà più ricalcolata (potrai ripristinarla con ↺).</p>' : ''}<form id="f" class="stack" style="margin-top:14px">
    <div class="form-grid"><div><label class="f">Categoria</label><select name="category">${cats.map(c => `<option value="${c}" ${ex?.category === c ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}</select></div>
      <div><label class="f">Importo</label><input type="text" name="amount" required inputmode="decimal" value="${ex?.amount ?? ''}" placeholder="Es. 18,50"></div>
      <div><label class="f">Valuta</label>${scegliValuta('currency', ex?.currency)}</div>
      <div style="align-self:end"><div class="small muted" id="in-euro"></div></div></div>
    <div id="riga-cambio" hidden><label class="f" id="et-cambio">Cambio</label>
      <input name="rate" inputmode="decimal" placeholder="Es. 0,0085">
      <div class="small muted">Il servizio dei cambi non risponde o non conosce questa valuta: scrivi quanti euro vale un\u2019unit\u00e0 e resta scritto nella spesa.</div></div>
    <div class="form-grid"><div><label class="f">Data</label><input type="date" name="date" value="${ex?.date ? iso(ex.date) : today()}"></div>
      <div><label class="f">Tappa (opz.)</label><select name="leg_id"><option value="">—</option>${legs.map((l, i) => `<option value="${l.id}" ${ex?.leg_id === l.id ? 'selected' : ''}>${i + 1}. ${esc(l.to_name.split(',')[0])}</option>`).join('')}</select></div></div>
    <div><label class="f">Descrizione</label><input name="description" value="${esc(ex?.description || '')}" placeholder="Es. Traghetto Piombino–Portoferraio"></div>
    <div><label class="f">Luogo</label><input name="place" list="luoghi-viaggio" value="${esc(ex?.place || '')}" placeholder="Dove l\u2019hai fatta: distributore, paese, campeggio\u2026" autocomplete="off">
      <datalist id="luoghi-viaggio">${luoghiNoti.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      // Quanto fa in euro, col cambio del giorno della spesa: si vede prima di salvare.
      // Se il servizio non risponde la spesa non si blocca: compare il campo per
      // scrivere il cambio a mano, ed e' quello a comandare.
      const rigaCambio = $('#riga-cambio', el), campoCambio = $('[name=rate]', el);
      const mostraEuro = safe(async () => {
        const valuta = $('[name=currency]', el).value;
        const importo = +String($('[name=amount]', el).value).replace(',', '.');
        const riquadro = $('#in-euro', el);
        if (valuta === 'EUR') { rigaCambio.hidden = true; return riquadro.textContent = ''; }
        $('#et-cambio', el).textContent = `Quanti euro vale 1 ${valuta}`;
        let cambio = +String(campoCambio.value).replace(',', '.');
        if (!(cambio > 0)) {
          riquadro.textContent = 'cambio\u2026';
          try {
            cambio = (await api(`/cambio?valuta=${valuta}&data=${$('[name=date]', el).value || today()}`)).cambio;
            rigaCambio.hidden = true;
          } catch {
            rigaCambio.hidden = false;
            return riquadro.textContent = 'cambio non disponibile: scrivilo qui sotto';
          }
        }
        riquadro.innerHTML = importo > 0
          ? `\u2248 <b>${eur(importo * cambio)}</b><br><span class="muted">1 ${valuta} = ${num(cambio, 4)} \u20ac</span>`
          : `<span class="muted">1 ${valuta} = ${num(cambio, 4)} \u20ac</span>`;
      });
      campoCambio.addEventListener('input', mostraEuro);
      // Cambiata la valuta, il cambio scritto a mano non vale piu': era di un'altra
      $('[name=currency]', el).addEventListener('change', () => { campoCambio.value = ''; });
      ['[name=currency]', '[name=amount]', '[name=date]'].forEach(sel => {
        $(sel, el).addEventListener('change', mostraEuro);
        $(sel, el).addEventListener('input', mostraEuro);
      });
      mostraEuro();
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        if (ex) await api('/expenses/' + ex.id, { method: 'PUT', body });
        else await api(`/trips/${trip.id}/expenses`, { method: 'POST', body });
        close(); restaQui();
      });
    });
}

// Indicazioni stradali su Google Maps. L'indirizzo porta solo le coordinate:
// il percorso lo calcola Google nel momento in cui ci si clicca sopra, quindi
// traffico, cantieri e chiusure sono quelli di allora e non di quando abbiamo
// creato la tappa. Sul telefono si apre l'app, se c'e'.
// Il formato e' quello documentato da Google (Maps URLs, api=1) e non vuole chiavi.
const MAX_TAPPE_MAPS = 9;                       // il limite di Google per i punti intermedi
function mapsIndicazioni(da, a, intermedie = [], evita = '') {
  const punto = p => `${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}`;
  // Partenza e arrivo coincidono quando si vuole solo «portami qui»: allora
  // l'origine si lascia decidere al telefono, che sa dov'e'
  const soloMeta = da && a && +da.lat === +a.lat && +da.lon === +a.lon;
  const q = new URLSearchParams(soloMeta
    ? { api: '1', destination: punto(a), travelmode: 'driving' }
    : { api: '1', origin: punto(da), destination: punto(a), travelmode: 'driving' });
  const tappe = intermedie.filter(p => p?.lat != null).slice(0, MAX_TAPPE_MAPS);
  if (tappe.length) q.set('waypoints', tappe.map(punto).join('|'));
  // Quello che la strada scelta evita, lo deve evitare anche Google: altrimenti
  // si apre la sua strada, che e' un'altra, e la scelta fatta qui non conta
  if (evita) q.set('avoid', evita);
  return `https://www.google.com/maps/dir/?${q}`;
}

// Qualche punto preso lungo la strada scelta. Google un tracciato non lo
// accetta, ma per dei punti ci passa: bastano due, presi a un terzo e a due
// terzi, per farlo andare di li' invece che per la sua strada preferita.
function puntiGuida(geometry, quanti = 2) {
  const g = Array.isArray(geometry) ? geometry.filter(p => Array.isArray(p) && p.length > 1) : [];
  if (g.length < 3) return [];
  return Array.from({ length: quanti }, (_, i) => g[Math.round(g.length * (i + 1) / (quanti + 1))])
    .filter(Boolean).map(([lat, lon]) => ({ lat, lon }));
}

// L'indirizzo di Google per la strada scelta qui: ci passa per dove passa lei,
// e le evita quello che lei evita
const mapsPerVariante = (da, a, v, intermedie = []) => mapsIndicazioni(
  da, a,
  [...intermedie, ...puntiGuida(v?.tratte?.length === 1 ? v.tratte[0].geometry : [])].slice(0, MAX_TAPPE_MAPS),
  v?.evita_pedaggi ? 'tolls' : '');

// L'indirizzo che apre park4night centrato su un punto. Sul telefono, se l'app
// e' installata, iOS e Android la aprono al posto del sito. Non serve chiedere
// niente a nessun servizio: e' un indirizzo, ed e' immediato.
// Casa: intorno non si cercano soste, e il nome si cambia nelle impostazioni
const casaNome = () => String(settings.casa || 'Susegana').trim();
const eCasa = nome => !!nome && String(nome).toLowerCase().includes(casaNome().toLowerCase());

const p4n = (lat, lon, zoom = 14) => `https://park4night.com/it/search?lat=${(+lat).toFixed(5)}&lng=${(+lon).toFixed(5)}&z=${zoom}`;

// OpenStreetMap scrive «yes» e «no»: qui dentro si legge in italiano
const tariffaPoi = f => !f ? null : f === 'yes' ? 'a pagamento' : f === 'no' ? 'gratis' : f;

function poiModal(l) {
  const p = l.pois || {};
  modal(`<h2>All\u2019arrivo a ${esc(l.to_name.split(',')[0])}</h2><div class="muted small">Cercati intorno alla destinazione${p.warning ? ' · ⚠️ ' + p.warning : ''}</div>
    <h3 style="margin:14px 0 4px">🅿️ Aree sosta e campeggi (${(p.stops || []).length})</h3>
    ${(p.stops || []).map(s => `<div class="poi"><div class="k">${s.kind === 'area_sosta' ? '\ud83c\udd7f\ufe0f' : s.kind === 'campeggio' ? '\u26fa' : '\ud83d\udeb0'}</div>
      <div class="grow"><b>${esc(s.name)}</b> <span class="muted small">${esc(s.kind.replace('_', ' '))}</span>
      <div class="small muted">${[tariffaPoi(s.fee), (s.power && s.power !== 'no') && 'corrente', (s.drinking_water && s.drinking_water !== 'no') && 'acqua', s.capacity && s.capacity + ' posti', s.opening_hours].filter(Boolean).map(esc).join(' \u00b7 ')}</div>
      <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
        <a class="btn sm" href="${p4n(s.lat, s.lon)}" target="_blank" rel="noopener" title="Foto, prezzi e commenti su park4night">\ud83c\udd7f\ufe0f park4night</a>
        <a class="btn sm" href="${mapsIndicazioni({ lat: s.lat, lon: s.lon }, { lat: s.lat, lon: s.lon })}" target="_blank" rel="noopener" title="Portami qui">\ud83d\uddfa\ufe0f Naviga</a>
        ${s.website ? `<a class="btn sm ghost" href="${esc(s.website)}" target="_blank" rel="noopener">\ud83c\udf10 Sito</a>` : ''}
      </div></div></div>`).join('') || `<div class="muted small">Nessuna area censita su OpenStreetMap entro ${(p.raggio || 5000) / 1000} km. Prova ad allargare il raggio, oppure guarda su park4night: loro ne conoscono di piu\u2019.</div>`}
    <div class="row between" style="margin-top:14px"><div class="row" style="gap:8px;align-items:center">
        <label class="small muted">Raggio</label>
        <select id="poi-raggio" style="width:auto">${[5, 10, 15, 25].map(k => `<option value="${k * 1000}" ${k * 1000 === (p.raggio || 5000) ? 'selected' : ''}>${k} km</option>`).join('')}</select></div>
      <div class="row"><button class="btn" data-x>Chiudi</button><button class="btn ghost" data-r>Cerca di nuovo</button></div></div>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      const rifai = safe(async () => {
        toast('Cerco\u2026');
        l.pois = await api(`/legs/${l.id}/pois?raggio=${$('#poi-raggio', el).value}`, { method: 'POST' });
        close(); poiModal(l);
      });
      $('[data-r]', el).onclick = rifai;
      $('#poi-raggio', el).onchange = rifai;
    });
}

// ---------- Allenamenti ----------
// Filtri dell'elenco allenamenti: periodo e viaggio, ricordati fra una schermata e l'altra
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DISCIPLINE = [['tapis', '🏃 Tapis roulant'], ['camminata', '🚶 Camminata'], ['corsa', '🏃 Corsa'], ['trekking', '🥾 Trekking'],
  ['nuoto', '🏊 Nuoto'], ['ciclismo', '🚴 Ciclismo'], ['neve', '🎿 Sci e neve'], ['altro', '🏅 Altro']];
const elenco = {
  discipline: [],               // elenco vuoto = tutte
  tendinaDiscipline: false,
  tapis: '',                    // '' tutti, '1' solo tapis roulant, '0' escludilo
  periodo: 'mese',              // scorciatoia attiva, oppure 'scelta'
  trips: [],                    // elenco vuoto = tutti i viaggi
  scelta: { tipo: 'giorno', giorno: today(), mese: new Date().getMonth(), anno: new Date().getFullYear(), from: null, to: null },
  tendinaAperta: false,
};
const ultimoGiorno = (anno, mese) => iso(new Date(anno, mese + 1, 0));

function intervallo(periodo) {
  const oggi = new Date();
  if (periodo === 'giorno') return [today(), today()];
  if (periodo === 'settimana') return [iso(oggi - 6 * 864e5), today()];
  if (periodo === 'mese') return [iso(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), today()];
  if (periodo === 'anno') return [`${oggi.getFullYear()}-01-01`, today()];
  if (periodo === 'scelta') {
    const c = elenco.scelta;
    if (c.tipo === 'giorno') return [c.giorno, c.giorno];
    if (c.tipo === 'mese') return [iso(new Date(c.anno, c.mese, 1)), ultimoGiorno(c.anno, c.mese)];
    if (c.tipo === 'anno') return [`${c.anno}-01-01`, `${c.anno}-12-31`];
    return [c.from, c.to];
  }
  return [null, null];
}

// Dal dettaglio si torna all'elenco dell'atleta a cui l'allenamento appartiene
const tornaAllenamenti = w => `#/allenamenti/${w.user_id || (user && user.id) || ''}`;

// Media oraria: se la sorgente non l'ha fornita la ricaviamo da distanza e durata,
// cosi' compare anche sugli allenamenti di Salute, che non la mandano mai
const mediaKmh = w => w.speed_avg_kmh ? +w.speed_avg_kmh
  : (w.distance_m && w.duration_s ? (w.distance_m / 1000) / (w.duration_s / 3600) : null);
// Metri di salita all'ora: ha senso solo dove c'e' dislivello, cioe' in bici e a piedi
// in montagna. Sul piano vale zero e il riquadro non compare.
const dislivelloOrario = w => (w.elevation_up_m > 0 && w.duration_s > 0)
  ? w.elevation_up_m / (w.duration_s / 3600) : null;

// Colonna destra della riga d'elenco: distanza, durata e le due medie, visibili
// senza dover aprire la scheda
const numeriRiga = w => `<b>${num((w.distance_m || 0) / 1000)} km</b> · ${dur(w.duration_s)}${mediaKmh(w) ? ' · ' + num(mediaKmh(w)) + ' km/h' : ''}<br>
  <span class="muted">${w.hr_avg ? '❤️ ' + w.hr_avg + ' bpm ' : ''}${w.calories ? '🔥 ' + w.calories + ' ' : ''}${w.elevation_up_m ? '⛰️ ' + w.elevation_up_m + ' m' + (dislivelloOrario(w) ? ' · ' + num(dislivelloOrario(w), 0) + ' m/h' : '') : ''}${pesoRiga(w)}</span>`;

// Un colore per disciplina, sulla mappa del viaggio. Quelle che si fanno in
// camper — le tappe — restano nel verde della dashboard; le attivita' prendono
// ciascuna il suo, e chi non e' in elenco ne riceve uno stabile ricavato dal
// nome, cosi' lo scialpinismo non cambia tinta a ogni apertura.
const COLORE_CAMPER = '#0f766e';
// Le tappe fatte con un mezzo altrui: un colore solo per tutte, tanto a dire
// quale mezzo e' ci pensa l'icona nel riquadro che si apre
const COLORE_ALTRI_MEZZI = '#6366f1';
const COLORI_SPORT = {
  'Bicicletta': '#2563eb',
  'Escursione': '#16a34a',
  'Camminata': '#65a30d',
  'Corsa': '#f97316',
  'Nuoto': '#06b6d4',
  'Nuoto in piscina': '#06b6d4',
  'Nuoto in acque libere': '#0e7490',
  'Scialpinismo': '#a855f7',
  'Sci': '#8b5cf6',
  'Camminata su tapis': '#94a3b8',
  'Corsa su tapis': '#64748b',
};
const TAVOLOZZA = ['#db2777', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#4d7c0f', '#c026d3', '#0369a1'];
const coloreSport = nome => {
  if (COLORI_SPORT[nome]) return COLORI_SPORT[nome];
  let somma = 0;
  for (const c of String(nome || '')) somma = (somma + c.codePointAt(0)) % 9973;
  return TAVOLOZZA[somma % TAVOLOZZA.length];
};

// Peso di quella giornata. Se quel giorno non ci si e' pesati non compare nulla:
// un peso preso in prestito da un altro giorno racconterebbe una cosa non vera
const pesoRiga = w => w.peso_kg == null ? ''
  : ` <span title="Pesata di quel giorno">\u2696\ufe0f ${num(w.peso_kg, 1)} kg</span>`;

// Andamento del peso: una spezzata disegnata a mano in SVG, senza librerie.
// Le coordinate stanno in un viewBox fisso e il foglio di stile la fa scalare,
// cosi' il disegno resta nitido anche sul telefono.
// Una pesata che segna mezzanotte non l'ha fatta nessuno a quell'ora: e' il
// segno che il telefono le manda gia' mediate per giorno, e allora la regola
// della pesata del mattino non ha su cosa lavorare.
const aMezzanotte = pesi => {
  const conOra = pesi.filter(p => p.ora);
  return conOra.length >= 3 && conOra.filter(p => p.ora === '00:00').length / conOra.length > 0.8;
};

function graficoPeso(pesi) {
  if (!pesi.length) return '<div class="empty">Nessuna pesata in questo periodo.</div>';
  const ultimo = pesi[pesi.length - 1], primo = pesi[0];
  const valori = pesi.map(p => p.kg);
  const minimo = Math.min(...valori), massimo = Math.max(...valori);
  const variazione = ultimo.kg - primo.kg;
  // Quanti giorni copre il periodo: dirlo accanto al numero di pesate rende
  // evidenti i giorni in cui non si e' saliti sulla bilancia, che altrimenti
  // nel grafico sono solo un tratto di linea piu' lungo
  const giorniCoperti = notti(primo.day, ultimo.day) + 1;
  const riassunto = `<div class="peso-testa">
    <div><span class="peso-ora">${num(ultimo.kg, 1)} kg</span> <span class="small muted">il ${fdate(ultimo.day)}</span></div>
    ${pesi.length > 1 ? `<div class="small ${variazione >= 0.05 ? 'in-salita' : variazione <= -0.05 ? 'in-discesa' : 'muted'}">
      ${variazione >= 0.05 ? '\u25b2 +' + num(variazione, 1) + ' kg' : variazione <= -0.05 ? '\u25bc \u2212' + num(-variazione, 1) + ' kg' : 'stabile'} <span class="muted">dal ${fdate(primo.day)}</span></div>
    <div class="small muted">min ${num(minimo, 1)} \u00b7 max ${num(massimo, 1)} kg \u00b7 ${pesi.length} pesate${giorniCoperti > pesi.length ? ` su ${giorniCoperti} giorni` : ''}</div>` : ''}
    ${aMezzanotte(pesi) ? `<div class="small muted" style="margin-top:4px">\u26a0\ufe0f Queste pesate arrivano gi\u00e0 aggregate per giorno: segnano mezzanotte, che non e\u2019 l\u2019ora in cui sali sulla bilancia. Cos\u00ec non si puo\u2019 tenere quella della mattina. In Health Auto Export, sull\u2019automazione, metti <b>Aggregazione: Nessuna</b> sul peso.</div>` : ''}
  </div>`;
  if (pesi.length < 2) return riassunto;

  const L = 640, A = 210, sx = 46, dx = 10, su = 12, giu = 26;
  const istante = g => new Date(g + 'T12:00:00').getTime();
  const t0 = istante(primo.day), t1 = istante(ultimo.day);
  // Un fondo scala tutto schiacciato renderebbe drammatico un etto: sotto il
  // chilo di escursione si allarga la scala, cosi' la linea resta leggibile
  let basso = minimo, alto = massimo;
  const respiro = Math.max(0.5, (alto - basso) * 0.18);
  basso -= respiro; alto += respiro;
  const X = g => sx + (t1 === t0 ? 0 : (istante(g) - t0) / (t1 - t0)) * (L - sx - dx);
  const Y = v => su + (1 - (v - basso) / (alto - basso)) * (A - su - giu);
  const punti = pesi.map(p => `${X(p.day).toFixed(1)},${Y(p.kg).toFixed(1)}`);
  const base = (A - giu).toFixed(1);
  const area = `M${punti[0]} L${punti.join(' L')} L${X(ultimo.day).toFixed(1)},${base} L${X(primo.day).toFixed(1)},${base} Z`;
  const tacche = [alto - respiro, (basso + alto) / 2, basso + respiro];
  const griglia = tacche.map(v => `<line x1="${sx}" y1="${Y(v).toFixed(1)}" x2="${L - dx}" y2="${Y(v).toFixed(1)}" class="griglia"/>
    <text x="${sx - 6}" y="${(Y(v) + 3.5).toFixed(1)}" class="tacca" text-anchor="end">${num(v, 1)}</text>`).join('');
  // Con tante pesate i pallini diventano una collana illeggibile: restano gli estremi
  const pallini = pesi.length <= 120
    ? pesi.map(p => `<circle cx="${X(p.day).toFixed(1)}" cy="${Y(p.kg).toFixed(1)}" r="${pesi.length > 60 ? 2 : 3}" class="punto"><title>${fdate(p.day)}: ${num(p.kg, 1)} kg</title></circle>`).join('')
    : [primo, ultimo].map(p => `<circle cx="${X(p.day).toFixed(1)}" cy="${Y(p.kg).toFixed(1)}" r="3.5" class="punto"><title>${fdate(p.day)}: ${num(p.kg, 1)} kg</title></circle>`).join('');
  // Su pochi mesi il solo mese si ripeterebbe tre volte: li' serve il giorno
  const giorni = (t1 - t0) / 86400000;
  const formato = giorni > 80 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  const mezzo = pesi[Math.floor(pesi.length / 2)];
  const date = [[primo, 'start'], [mezzo, 'middle'], [ultimo, 'end']]
    .filter(([p], i, a) => i === 0 || p.day !== a[i - 1][0].day)
    .map(([p, ancora]) => `<text x="${X(p.day).toFixed(1)}" y="${A - 8}" class="tacca" text-anchor="${ancora}">${new Date(p.day + 'T12:00:00').toLocaleDateString('it-IT', formato)}</text>`).join('');
  // Le coordinate di ogni pesata viaggiano dentro il disegno: servono al dito
  // per trovare il punto piu' vicino a dove ha toccato
  const coordinate = pesi.map(p => ({ x: +X(p.day).toFixed(1), y: +Y(p.kg).toFixed(1), day: p.day, kg: p.kg }));
  return `${riassunto}<svg class="grafico-peso" viewBox="0 0 ${L} ${A}" role="img" aria-label="Andamento del peso"
      data-larghezza="${L}" data-punti="${esc(JSON.stringify(coordinate))}">
    ${griglia}<path d="${area}" class="area"/><polyline points="${punti.join(' ')}" class="linea"/>${pallini}
    <line class="guida-scelta" y1="${su}" y2="${base}" x1="0" x2="0" hidden/>
    <circle class="punto-scelto" r="6" cx="0" cy="0" hidden/>
    ${date}<rect class="tocco" x="0" y="0" width="${L}" height="${A}" fill="transparent"/></svg>
    <div class="peso-scelto" id="peso-scelto">Tocca il grafico per vedere giorno e peso</div>`;
}

// Modifica dei dati di un allenamento, con la media che si aggiorna mentre scrivi
function modificaWorkout(w, dopo) {
  // Il peso non appartiene all'allenamento ma alla giornata: si modifica da qui
  // per comodita', e finisce nell'archivio delle pesate come una scritta a mano
  const pesoDelGiorno = w.peso_kg != null ? +w.peso_kg : '';
  const campo = (id, etichetta, valore, passo, suffisso) =>
    `<div class="field"><label class="f">${etichetta}</label><input type="number" step="${passo}" min="0" id="${id}" value="${valore ?? ''}" placeholder="${suffisso}"></div>`;
  // La disciplina la sa chi si e' allenato, non il telefono: un'uscita in casa
  // sul tapis arriva spesso come «Escursione», e da qui si rimette a posto.
  // Cambiandola cambia anche l'icona, i filtri e i conti per disciplina.
  // Nell'elenco stanno le discipline che qui si fanno davvero. Il nuoto generico
  // non serve, con la piscina e le acque libere gia' separate; lo snowboard nessuno
  // lo fa. Se un allenamento ne porta una fuori elenco, quella compare lo stesso,
  // e «Altro» resta per tutto il resto.
  const DISCIPLINE_SCELTA = ['Camminata', 'Camminata su tapis', 'Corsa', 'Corsa su tapis', 'Escursione',
    'Bicicletta', 'Nuoto in piscina', 'Nuoto in acque libere', 'Scialpinismo', 'Sci', 'Sci di fondo'];
  const sportOra = (w.sport || '').trim();
  const elenco = DISCIPLINE_SCELTA.includes(sportOra) || !sportOra ? DISCIPLINE_SCELTA : [sportOra, ...DISCIPLINE_SCELTA];
  // Non un <select>: dentro un <option> ci sta solo testo, e l'icona del tapis
  // roulant e' un disegno. Una tendina nostra le mostra tutte come sono.
  const voceSport = k => `<button type="button" class="voce-sport" data-sport="${esc(k)}">${sportIco(k)} <span>${esc(k)}</span></button>`;
  modal(`<h2>Dati dell\u2019allenamento</h2>
    <div class="row" style="margin-top:12px">
      <div class="field grow"><label class="f">Tipo di allenamento</label>
        <details class="tendina" id="m-tipo"><summary id="m-tipo-ora">${sportIco(sportOra)} ${esc(sportOra || 'Scegli')}</summary>
          <div class="tendina-corpo">${elenco.map(voceSport).join('')}
            <button type="button" class="voce-sport" data-sport="__altro">\u270f\ufe0f <span>Altro\u2026</span></button></div></details></div>
      <div class="field grow" id="m-altro-campo" hidden><label class="f">Come si chiama</label><input id="m-altro" placeholder="Es. Canoa" value=""></div>
    </div>
    <div class="row">
      ${campo('m-km', 'Distanza (km)', w.distance_m != null ? +(w.distance_m / 1000).toFixed(2) : '', '0.01', 'km')}
      ${campo('m-min', 'Durata (minuti)', w.duration_s != null ? Math.round(w.duration_s / 60) : '', '1', 'min')}
      ${campo('m-disl', 'Dislivello (m)', w.elevation_up_m, '1', 'm')}
    </div>
    <div class="row">
      ${campo('m-kcal', 'Calorie', w.calories, '1', 'kcal')}
      ${campo('m-hr', 'Battito medio', w.hr_avg, '1', 'bpm')}
      ${campo('m-hrmax', 'Battito massimo', w.hr_max, '1', 'bpm')}
    </div>
    <div class="row">
      ${campo('m-peso', 'Peso del giorno (kg)', pesoDelGiorno, '0.1', 'kg')}
      <div class="field grow"><label class="f">&nbsp;</label><div class="small muted">Vale per l\u2019intera giornata, quindi anche per gli altri allenamenti dello stesso giorno. Svuota il campo per togliere la pesata.</div></div>
    </div>
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="label">Media oraria</div><div class="value" id="m-media" style="font-size:22px">\u2014</div><div class="sub">da distanza e durata</div></div>
      <div class="tile"><div class="label">Dislivello orario</div><div class="value" id="m-vam" style="font-size:22px">\u2014</div><div class="sub">da dislivello e durata</div></div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Annulla</button><button class="btn primary" id="m-salva">Salva</button></div>`,
    (el, close) => {
      const aggiornaMedia = () => {
        const km = parseFloat($('#m-km', el).value), min = parseFloat($('#m-min', el).value), disl = parseFloat($('#m-disl', el).value);
        $('#m-media', el).textContent = (km > 0 && min > 0) ? num(km / (min / 60)) + ' km/h' : '\u2014';
        $('#m-vam', el).textContent = (disl > 0 && min > 0) ? num(disl / (min / 60), 0) + ' m/h' : '\u2014';
      };
      ['#m-km', '#m-min', '#m-disl'].forEach(sel => $(sel, el).addEventListener('input', aggiornaMedia));
      let tipoScelto = sportOra;
      // Qui il pannello e' largo quanto il campo e non va spostato: ancorarlo al
      // bordo destro, dentro una finestra stretta, lo porterebbe fuori
      const tendina = $('#m-tipo', el);
      $$('.voce-sport', el).forEach(b => b.onclick = () => {
        const altro = b.dataset.sport === '__altro';
        tipoScelto = altro ? '__altro' : b.dataset.sport;
        $('#m-tipo-ora', el).innerHTML = altro ? '\u270f\ufe0f Altro\u2026' : `${sportIco(tipoScelto)} ${esc(tipoScelto)}`;
        $('#m-altro-campo', el).hidden = !altro;
        tendina.open = false;
        if (altro) $('#m-altro', el).focus();
      });
      aggiornaMedia();
      $('[data-x]', el).onclick = close;
      const sportScelto = () => tipoScelto === '__altro' ? $('#m-altro', el).value.trim() : tipoScelto;
      $('#m-salva', el).onclick = safe(async () => {
        const v = sel => { const t = $(sel, el).value.trim(); return t === '' ? null : Number(t); };
        const km = v('#m-km'), min = v('#m-min');
        await api('/workouts/' + w.id, { method: 'PUT', body: {
          distance_m: km === null ? null : Math.round(km * 1000),
          duration_s: min === null ? null : Math.round(min * 60),
          elevation_up_m: v('#m-disl'), calories: v('#m-kcal'), hr_avg: v('#m-hr'), hr_max: v('#m-hrmax'),
          ...(sportScelto() && sportScelto() !== sportOra ? { sport: sportScelto() } : {}),
        } });
        // La pesata viaggia su una strada sua: e' della giornata, non dell'allenamento
        const peso = v('#m-peso');
        if (peso !== pesoDelGiorno && !(peso === null && pesoDelGiorno === '')) {
          const giorno = iso(w.started_at);
          if (peso === null) await api(`/weights/${giorno}?user_id=${w.user_id}`, { method: 'DELETE' }).catch(() => {});
          else await api('/weights', { method: 'POST', body: { day: giorno, kg: peso, user_id: w.user_id } });
        }
        close(); toast('Dati aggiornati'); dopo?.();
      });
    });
}

// Rinomina un allenamento; usata sia dall'elenco sia dalla scheda di dettaglio
function renameWorkout(id, nome, dopo) {
  modal(`<h2>Rinomina allenamento</h2><form id="f" class="stack" style="margin-top:12px"><input name="name" value="${esc(nome || '')}" maxlength="120" required autofocus><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const nuovo = String(new FormData(e.target).get('name') || '').trim();
        if (!nuovo) return;
        await api('/workouts/' + id, { method: 'PUT', body: { name: nuovo } });
        close(); toast('Rinominato'); dopo?.();
      });
    });
}

async function viewWorkouts(idAtleta) {
  const atleta = atleti.find(a => a.id === idAtleta) || { id: idAtleta, name: '' };
  const altri = atleti.filter(a => a.id !== idAtleta);
  const [da, a] = intervallo(elenco.periodo);
  const qs = new URLSearchParams();
  if (da) qs.set('from', da);
  if (a) qs.set('to', a);
  qs.set('user_id', String(idAtleta));
  if (elenco.trips.length) qs.set('trip_id', elenco.trips.join(','));
  if (elenco.tapis) qs.set('tapis', elenco.tapis);
  if (elenco.discipline.length) qs.set('disciplina', elenco.discipline.join(','));
  const qsPeso = new URLSearchParams({ user_id: String(idAtleta) });
  if (da) qsPeso.set('from', da);
  if (a) qsPeso.set('to', a);
  const [ws, trips, anni, quante, pesi, esclusi] = await Promise.all([api('/workouts?' + qs), api('/trips'), api('/workouts/anni?user_id=' + idAtleta), api('/workouts/discipline?user_id=' + idAtleta), api('/weights?' + qsPeso), api('/workouts/esclusi?user_id=' + idAtleta)]);
  const k = await api('/komoot');
  const tot = { km: ws.reduce((a, w) => a + (w.distance_m || 0), 0) / 1000, kcal: ws.reduce((a, w) => a + (w.calories || 0), 0), s: ws.reduce((a, w) => a + (w.duration_s || 0), 0) };
  $('#app').innerHTML = layout(`
    <div class="row between" style="margin-bottom:16px"><h1>Allenamenti ${esc(atleta.name)}</h1><div class="row"><button class="btn" id="sync" ${k.connected ? '' : 'disabled title="Collega Komoot nelle impostazioni"'}>🔄 Sincronizza Komoot</button><button class="btn" id="dup">🔎 Doppioni</button>${esclusi.length ? `<button class="btn" id="esclusi">\ud83d\udeab Esclusi (${esclusi.length})</button>` : ''}<button class="btn" id="gruppi">\ud83e\udde9 Raggruppa</button><label class="btn">＋ JSON Salute<input type="file" id="hjson" accept=".json,application/json" hidden></label><label class="btn primary">＋ GPX<input type="file" id="gpx" accept=".gpx" hidden></label></div></div>
    <div class="card" style="margin-bottom:16px">
      <div class="chips">${[['giorno', 'Oggi'], ['settimana', '7 giorni'], ['mese', 'Questo mese'], ['anno', 'Quest\u2019anno'], ['tutto', 'Tutto'], ['scelta', 'Scegli\u2026']].map(([k2, l]) => `<span class="chip ${elenco.periodo === k2 ? 'active' : ''}" data-per="${k2}">${l}</span>`).join('')}</div>
      ${elenco.periodo === 'scelta' ? (() => { const c = elenco.scelta; return `<div class="row" style="margin-top:12px">
        <div class="field w-sm"><label class="f">Scegli per</label><select id="s-tipo">${[['giorno', 'Giorno'], ['mese', 'Mese'], ['anno', 'Anno'], ['intervallo', 'Intervallo']].map(([v, l]) => `<option value="${v}" ${c.tipo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${c.tipo === 'giorno' ? `<div class="field w-md"><label class="f">Giorno</label><input type="date" id="s-giorno" value="${c.giorno || today()}"></div>` : ''}
        ${c.tipo === 'mese' ? `<div class="field w-md"><label class="f">Mese</label><select id="s-mese">${MESI.map((m, i) => `<option value="${i}" ${c.mese === i ? 'selected' : ''}>${m}</option>`).join('')}</select></div>` : ''}
        ${c.tipo === 'mese' || c.tipo === 'anno' ? `<div class="field w-sm"><label class="f">Anno</label><select id="s-anno">${(anni.length ? anni : [new Date().getFullYear()]).map(y => `<option value="${y}" ${c.anno === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>` : ''}
        ${c.tipo === 'intervallo' ? `<div class="field w-md"><label class="f">Dal</label><input type="date" id="s-dal" value="${c.from || ''}"></div>
        <div class="field w-md"><label class="f">Al</label><input type="date" id="s-al" value="${c.to || ''}"></div>` : ''}
        <div class="field" style="align-self:flex-end"><button class="btn primary" id="s-applica">Applica</button></div>
      </div>`; })() : ''}
      <div style="margin-top:12px"><label class="f">Viaggi</label>
        <details class="tendina" id="f-viaggi" ${elenco.tendinaAperta ? 'open' : ''}>
          <summary>${(() => {
            if (!elenco.trips.length) return 'Tutti i viaggi';
            if (elenco.trips.length > 1) return `${elenco.trips.length} viaggi selezionati`;
            const v = elenco.trips[0];
            return v === 'none' ? 'Senza viaggio' : esc(trips.find(t => String(t.id) === v)?.title || 'Un viaggio');
          })()}</summary>
          <div class="tendina-corpo">
            <label><input type="checkbox" data-trip="none" ${elenco.trips.includes('none') ? 'checked' : ''}> Senza viaggio</label>
            ${trips.map(t => `<label><input type="checkbox" data-trip="${t.id}" ${elenco.trips.includes(String(t.id)) ? 'checked' : ''}> ${esc(nomeViaggio(t))}</label>`).join('')}
            <button class="btn" id="v-azzera" style="margin-top:6px" ${elenco.trips.length ? '' : 'disabled'}>Mostra tutti i viaggi</button>
          </div>
        </details>
        <div class="small muted" style="margin-top:6px">Puoi spuntarne pi\u00f9 di uno: l\u2019elenco somma i viaggi scelti.</div>
      </div>
      <div style="margin-top:12px"><label class="f">Disciplina</label>
        <details class="tendina" id="f-discipline" ${elenco.tendinaDiscipline ? 'open' : ''}>
          <summary>${!elenco.discipline.length ? 'Tutte le discipline'
            : elenco.discipline.length > 1 ? `${elenco.discipline.length} discipline`
            : (DISCIPLINE.find(([k]) => k === elenco.discipline[0]) || [null, 'Una disciplina'])[1]}</summary>
          <div class="tendina-corpo">
            ${DISCIPLINE.filter(([k]) => quante[k] > 0).map(([k, l]) =>
              `<label><input type="checkbox" data-disc="${k}" ${elenco.discipline.includes(k) ? 'checked' : ''}> ${l} <span class="muted">(${quante[k]})</span></label>`).join('')}
            <button class="btn" id="d-senza-tapis" style="margin-top:6px">Tutte tranne il tapis roulant</button>
            <button class="btn" id="d-azzera" ${elenco.discipline.length ? '' : 'disabled'}>Mostra tutte</button>
          </div>
        </details>
        <div class="small muted" style="margin-top:6px">Puoi spuntarne pi\u00f9 di una. Il numero fra parentesi \u00e8 quante ne hai in archivio.</div>
      </div>
    </div>
    <div class="tiles" style="margin-bottom:16px"><div class="tile accent"><div class="label">Attività</div><div class="value">${ws.length}</div><div class="sub">${!da && !a ? 'tutto l\u2019archivio' : da && a && da === a ? fdate(da) : (da ? 'dal ' + fdate(da) : 'fino al') + (a && da ? ' al ' + fdate(a) : a ? ' ' + fdate(a) : '')}</div></div><div class="tile"><div class="label">Distanza</div><div class="value">${num(tot.km)} km</div></div><div class="tile"><div class="label">Tempo</div><div class="value">${dur(tot.s)}</div></div><div class="tile"><div class="label">Calorie</div><div class="value">${num(tot.kcal, 0)}</div></div></div>
    <div class="card" style="margin-bottom:16px"><div class="row between"><h2>⚖️ Peso nel tempo</h2><button class="btn sm" id="peso-nuovo">＋ Pesata</button></div>
      ${graficoPeso(pesi)}
      ${pesi.length ? `<details class="pesate"><summary>Tutte le pesate (${pesi.length})</summary><div class="pesate-corpo">${[...pesi].reverse().map(p => `<div class="riga-pesata">
        <span class="giorno">${fdate(p.day)}</span><b>${num(p.kg, 1)} kg</b>
        <span class="badge ${p.source === 'manual' ? '' : 'ok'}">${p.source === 'manual' ? 'a mano' : 'Salute'}</span>
        <button class="btn ghost icon" data-peso-mod="${p.day}" data-kg="${p.kg}" title="Correggi">✏️</button>
        <button class="btn ghost danger icon" data-peso-del="${p.day}" title="Elimina">🗑</button></div>`).join('')}</div></details>`
        : '<p class="small muted" style="margin-top:8px">Il peso arriva dalle metriche di Salute — nell’esportazione includi anche <span class="code">weight_body_mass</span> — oppure lo aggiungi a mano con «＋ Pesata».</p>'}</div>
    ${!k.connected ? '<div class="card small" style="margin-bottom:14px">💡 Collega Komoot in <a href="#/impostazioni">Impostazioni</a> per scaricare i percorsi automaticamente, e aggiungi i tuoi iPhone per battito e calorie.</div>' : ''}
    ${altri.length ? `<div class="card barra-selezione" id="barra-scelta" hidden style="margin-bottom:12px">
      <div class="row between"><div><b id="quanti-scelti">0</b> selezionati</div>
      <div class="row">${altri.map(a => `<button class="btn primary" data-copia="${a.id}">Copia in Allenamenti ${esc(a.name)}</button>`).join('')}
      <button class="btn" id="scelta-annulla">Annulla</button></div></div></div>` : ''}
    <div class="card pad-0 list">${ws.map(w => `<div class="item">${altri.length ? `<input type="checkbox" class="scelta" value="${w.id}" title="Seleziona">` : ''}<a class="item-main" href="#/allenamento/${w.id}"><div class="sport-ico">${sportIco(w.sport)}</div><div class="grow"><div class="title">${esc(w.name || w.sport || 'Allenamento')}</div>
      <div class="meta">${fdt(w.started_at)} · ${esc(w.athlete)} · <span class="badge">${w.source}</span>${w.trip_title ? ` · <span class="badge link" title="Collegato al viaggio">🔗 ${esc(w.trip_title)}</span>` : ''}</div></div>
      <div class="right small nowrap">${numeriRiga(w)}</div></a>
      <div class="item-actions"><button class="btn ghost icon" data-ren="${w.id}" data-name="${esc(w.name || w.sport || 'Allenamento')}" title="Rinomina">✏️</button><button class="btn ghost danger icon" data-del="${w.id}" title="Elimina">🗑</button></div></div>`).join('') || (elenco.periodo === 'tutto' && !elenco.trips.length ? '<div class="empty">Nessun allenamento ancora. Collega Komoot o carica un file GPX.</div>' : '<div class="empty">Nessun allenamento con questi filtri.</div>')}</div>`);
  // Pesata scritta a mano: vale per la giornata e prende il posto di quella di
  // Salute, che non tornera' a sovrascriverla
  const finestraPesata = (giorno, kg) => modal(`<h2>${giorno ? 'Correggi la pesata' : 'Nuova pesata'}</h2>
    <form id="fp" class="stack" style="margin-top:12px">
      <div class="field"><label class="f">Giorno</label><input type="date" name="day" value="${giorno || today()}" max="${today()}" required></div>
      <div class="field"><label class="f">Peso in chili</label><input type="text" inputmode="decimal" name="kg" value="${kg ?? ''}" placeholder="es. 69,4" required></div>
      <button class="btn primary">Salva</button></form>`,
    (el, close) => {
      $('[name=kg]', el).focus();
      $('#fp', el).onsubmit = safe(async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        await api('/weights', { method: 'POST', body: { day: d.day, kg: +String(d.kg).replace(',', '.'), user_id: idAtleta } });
        close(); toast('Pesata salvata'); render();
      });
    });
  // Toccando il grafico si legge la pesata piu' vicina al dito: sul telefono non
  // esiste il passaggio del mouse, e i suggerimenti del disegno resterebbero muti
  const disegnoPeso = $('.grafico-peso');
  if (disegnoPeso) {
    const coordinate = JSON.parse(disegnoPeso.dataset.punti);
    const larghezza = +disegnoPeso.dataset.larghezza;
    const guida = $('.guida-scelta', disegnoPeso), segno = $('.punto-scelto', disegnoPeso), scritta = $('#peso-scelto');
    const mostra = i => {
      const p = coordinate[i], prima = coordinate[i - 1];
      guida.setAttribute('x1', p.x); guida.setAttribute('x2', p.x); guida.removeAttribute('hidden');
      segno.setAttribute('cx', p.x); segno.setAttribute('cy', p.y); segno.removeAttribute('hidden');
      const salto = prima ? p.kg - prima.kg : null;
      scritta.innerHTML = `<b>${num(p.kg, 1)} kg</b> \u00b7 ${fdate(p.day)}`
        + (salto != null ? ` <span class="${salto > 0.049 ? 'in-salita' : salto < -0.049 ? 'in-discesa' : 'muted'}">${salto > 0.049 ? '+' : salto < -0.049 ? '\u2212' : '\u00b1'}${num(Math.abs(salto), 1)} kg dalla pesata prima</span>` : '');
    };
    const cerca = e => {
      const r = disegnoPeso.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * larghezza;
      let vicino = 0;
      coordinate.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(coordinate[vicino].x - x)) vicino = i; });
      mostra(vicino);
    };
    let premuto = false;
    disegnoPeso.addEventListener('pointerdown', e => { premuto = true; cerca(e); });
    disegnoPeso.addEventListener('pointermove', e => { if (premuto) cerca(e); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(v => disegnoPeso.addEventListener(v, () => { premuto = false; }));
  }
  $('#peso-nuovo').onclick = () => finestraPesata(null, null);
  $$('[data-peso-mod]').forEach(b => b.onclick = () => finestraPesata(b.dataset.pesoMod, b.dataset.kg));
  $$('[data-peso-del]').forEach(b => b.onclick = safe(async () => {
    if (!await confirmDlg('Eliminare la pesata del ' + fdate(b.dataset.pesoDel) + '?')) return;
    await api(`/weights/${b.dataset.pesoDel}?user_id=${idAtleta}`, { method: 'DELETE' });
    toast('Pesata eliminata'); render();
  }));
  $('#sync').onclick = safe(async () => { toast('Sincronizzazione…'); const r = await api('/komoot/sync', { method: 'POST', body: {} }); toast(`Importati ${r.imported} nuovi tour`); render(); });
  $('#gpx').onchange = safe(async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); await api('/workouts/gpx', { method: 'POST', body: fd }); toast('GPX importato'); render(); });
  $('#hjson').onchange = safe(async e => {
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    fd.append('user_id', String(idAtleta));
    toast('Importazione in corso\u2026');
    const r = await api('/workouts/health-json', { method: 'POST', body: fd });
    // Il riepilogo dice anche che cosa portava il file quanto a pesate: se il
    // periodo non e' quello che ci si aspettava, il problema e' nell'esportazione
    const pesi = r.letture_peso
      ? `${r.pesate} pesate su ${r.letture_peso} letture${r.periodo_pesi ? `, dal ${fdate(r.periodo_pesi.dal)} al ${fdate(r.periodo_pesi.al)}` : ''}`
      : 'nessuna pesata nel file';
    toast(`Letti ${r.letti}: ${r.saved} salvati, ${r.merged} uniti\u00a0\u2014 ${pesi}`); render();
  });
  $$('[data-per]').forEach(c => c.onclick = () => { elenco.periodo = c.dataset.per; render(); });
  if ($('#s-tipo')) $('#s-tipo').onchange = e => { elenco.scelta.tipo = e.target.value; render(); };
  if ($('#s-applica')) $('#s-applica').onclick = () => {
    const c = elenco.scelta;
    if ($('#s-giorno')) c.giorno = $('#s-giorno').value || today();
    if ($('#s-mese')) c.mese = +$('#s-mese').value;
    if ($('#s-anno')) c.anno = +$('#s-anno').value;
    if ($('#s-dal')) c.from = $('#s-dal').value || null;
    if ($('#s-al')) c.to = $('#s-al').value || null;
    render();
  };
  $('#f-discipline').ontoggle = e => { elenco.tendinaDiscipline = e.target.open; if (e.target.open) sistemaTendina(e.target); };
  $$('[data-disc]').forEach(c => c.onchange = () => {
    const v = c.dataset.disc;
    elenco.discipline = c.checked ? [...elenco.discipline, v] : elenco.discipline.filter(x => x !== v);
    render();
  });
  $('#d-senza-tapis').onclick = () => { elenco.discipline = DISCIPLINE.map(([k]) => k).filter(k => k !== 'tapis' && quante[k] > 0); render(); };
  $('#d-azzera').onclick = () => { elenco.discipline = []; render(); };
  $('#f-viaggi').ontoggle = e => { elenco.tendinaAperta = e.target.open; if (e.target.open) sistemaTendina(e.target); };
  $$('[data-trip]').forEach(c => c.onchange = () => {
    const v = c.dataset.trip;
    elenco.trips = c.checked ? [...elenco.trips, v] : elenco.trips.filter(x => x !== v);
    render();
  });
  $('#v-azzera').onclick = () => { elenco.trips = []; render(); };
  // Gli esclusi: cancellati a mano e tenuti fuori dalle sincronizzazioni.
  // Ripristinarne uno riapre solo la porta: torna quando la sorgente lo rimanda.
  $('#esclusi')?.addEventListener('click', () => modal(`<h2>Allenamenti esclusi</h2>
    <p class="small muted">Li hai cancellati tu, quindi Komoot, Strava e Salute non li riportano pi\u00f9 indietro. Ripristinandone uno torner\u00e0 alla prima sincronizzazione che lo rimanda.</p>
    <div class="stack" style="margin-top:12px;max-height:50vh;overflow:auto">${esclusi.map(e => `<div class="row between" style="gap:10px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:8px">
      <div class="small"><b>${esc(e.name || e.sport || 'Allenamento')}</b><br><span class="muted">${fdt(e.started_at)} \u00b7 <span class="badge">${esc(e.source)}</span></span></div>
      <button class="btn sm" data-ripristina="${e.id}">Ripristina</button></div>`).join('')}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Chiudi</button></div>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      $$('[data-ripristina]', el).forEach(b => b.onclick = safe(async () => {
        await api('/workouts/esclusi/' + b.dataset.ripristina, { method: 'DELETE' });
        close(); toast('Riammesso: tornera\u2019 alla prossima sincronizzazione'); render();
      }));
    }));
  // Uscite spezzate: la stessa disciplina piu' volte nella giornata, a poca
  // distanza. Si propone di ricomporle, ma la scelta resta a chi guarda
  $('#gruppi').onclick = safe(async () => {
    const mostra = async (minuti, el, close) => {
      const { gruppi } = await api(`/workouts/gruppi?user_id=${idAtleta}&minuti=${minuti}`);
      const scelta = `<div class="row" style="gap:10px;align-items:center;margin-top:10px">
        <label class="small muted">Stacco massimo fra un tratto e l\u2019altro</label>
        <select id="g-min" style="width:auto">${[15, 30, 60, 120, 240].map(m => `<option value="${m}" ${m === minuti ? 'selected' : ''}>${m} minuti</option>`).join('')}</select></div>`;
      const corpo = !gruppi.length
        ? '<div class="empty">Nessuna uscita spezzata con questo stacco.</div>'
        : `<div class="stack" style="margin-top:12px;max-height:46vh;overflow:auto">${gruppi.map((g, i) => `<div class="card" style="padding:12px">
            <label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" class="gchk" value="${i}" checked>
              <div class="grow"><b>${sportIco(g.unione.sport)} ${esc(g.unione.name || g.unione.sport || '')}</b>
              <span class="small muted">\u00b7 ${fdate(g.unione.started_at)} \u00b7 ${g.pezzi.length} tratti</span></div></label>
            <div class="small muted" style="margin:6px 0 0 26px">${g.pezzi.map((p, k) => `${k ? `<span title="stacco">\u2007\u21b3 ${g.stacchi[k - 1]} min\u2007</span>` : ''}${fdt(p.started_at).split(', ')[1] || fdt(p.started_at)} \u00b7 ${num((p.distance_m || 0) / 1000)} km \u00b7 ${dur(p.duration_s)}${p.has_track ? ' \u00b7 \ud83d\uddfa\ufe0f' : ''}`).join('<br>')}</div>
            <div class="small" style="margin:8px 0 0 26px"><b>Unita:</b> ${num((g.unione.distance_m || 0) / 1000)} km \u00b7 ${dur(g.unione.duration_s)}${g.unione.speed_avg_kmh ? ' \u00b7 ' + num(g.unione.speed_avg_kmh) + ' km/h' : ''}${g.unione.calories ? ' \u00b7 \ud83d\udd25 ' + g.unione.calories : ''}${g.unione.hr_avg ? ' \u00b7 \u2764\ufe0f ' + g.unione.hr_avg + ' bpm medi' : ''}${g.unione.elevation_up_m ? ' \u00b7 \u26f0\ufe0f ' + g.unione.elevation_up_m + ' m' : ''}</div>
          </div>`).join('')}</div>`;
      $('#g-corpo', el).innerHTML = scelta + corpo;
      $('#g-vai', el).disabled = !gruppi.length;
      $('#g-vai', el).textContent = gruppi.length ? `Unisci i selezionati (${gruppi.length})` : 'Niente da unire';
      $('#g-min', el).onchange = e => mostra(+e.target.value, el, close);
      $('#g-vai', el).onclick = safe(async () => {
        const scelti = $$('.gchk', el).filter(c => c.checked).map(c => gruppi[+c.value].pezzi.map(p => p.id));
        if (!scelti.length) return toast('Nessun gruppo selezionato', true);
        const tratti = scelti.reduce((t, g) => t + g.length, 0);
        if (!await confirmDlg(`Unire ${scelti.length === 1 ? 'questa uscita' : scelti.length + ' uscite'}, ${tratti} tratti in tutto? I singoli tratti spariscono e non verranno piu\u2019 ricaricati.`)) return;
        const r = await api('/workouts/gruppi/unisci', { method: 'POST', body: { gruppi: scelti } });
        close();
        toast(`${r.unite === 1 ? 'Un\u2019uscita ricomposta' : r.unite + ' uscite ricomposte'}, ${r.assorbiti === 1 ? 'un tratto assorbito' : r.assorbiti + ' tratti assorbiti'}`);
        render();
      });
    };
    modal(`<h2>\ud83e\udde9 Uscite spezzate</h2>
      <p class="small muted">Stessa disciplina, stesso giorno, a poca distanza l\u2019una dall\u2019altra: probabilmente e\u2019 una sola uscita registrata a tratti. Unendole si sommano distanza, durata, dislivello e calorie, si incollano le tracce in ordine e il battito medio si pesa sulla durata.</p>
      <div id="g-corpo"><div class="empty">Cerco\u2026</div></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Annulla</button><button class="btn primary" id="g-vai" disabled>Cerco\u2026</button></div>`,
      (el, close) => { $('[data-x]', el).onclick = close; mostra(60, el, close); });
  });
  $('#dup').onclick = safe(async () => {
    const { gruppi, totale_da_eliminare } = await api('/workouts/duplicates');
    if (!gruppi.length) return toast('Nessun doppione trovato');
    const riga = w => `<div class="small">${sportIco(w.sport)} <b>${esc(w.name || w.sport || 'Allenamento')}</b> · ${fdt(w.started_at)} · ${esc(w.athlete)}
      · <span class="badge">${w.source}</span> · ${num((w.distance_m || 0) / 1000)} km · ${dur(w.duration_s)}${w.has_track ? ' · 🗺️ traccia' : ''}${w.calories ? ' · 🔥 ' + w.calories : ''}${w.hr_avg ? ' · ❤️ ' + w.hr_avg : ''}</div>`;
    modal(`<h2>${gruppi.length} possibil${gruppi.length === 1 ? 'e doppione' : 'i doppioni'}</h2>
      <p class="small muted">Di ogni gruppo tengo il record pi\u00f9 completo e propongo di eliminare gli altri. Togli la spunta a quelli che vuoi conservare.</p>
      <div class="stack" style="margin-top:12px;max-height:50vh;overflow:auto">${gruppi.map((g, i) => `<div class="card" style="padding:12px">
        <div class="small muted" style="margin-bottom:6px">Gruppo ${i + 1} — tengo questo:</div>${riga(g.tieni)}
        <div class="small muted" style="margin:8px 0 6px">da eliminare:</div>
        ${g.elimina.map(w => `<label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" class="dupchk" value="${w.id}" checked>${riga(w)}</label>`).join('')}
      </div>`).join('')}</div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Annulla</button><button class="btn danger" id="godup">Elimina i selezionati (${totale_da_eliminare})</button></div>`,
      (el, close) => {
        $('[data-x]', el).onclick = close;
        $('#godup', el).onclick = safe(async () => {
          const ids = $$('.dupchk', el).filter(c => c.checked).map(c => +c.value);
          if (!ids.length) return toast('Nessun allenamento selezionato', true);
          if (!await confirmDlg(ids.length === 1 ? 'Eliminare questo allenamento? L\u2019operazione non si annulla.' : `Eliminare ${ids.length} allenamenti? L\u2019operazione non si annulla.`)) return;
          const r = await api('/workouts/duplicates/remove', { method: 'POST', body: { ids } });
          close(); toast(r.eliminati === 1 ? 'Eliminato 1 allenamento' : `Eliminati ${r.eliminati} allenamenti`); render();
        });
      });
  });
  const scelti = () => $$('.scelta').filter(c => c.checked).map(c => +c.value);
  const aggiornaBarra = () => {
    const n = scelti().length, barra = $('#barra-scelta');
    if (!barra) return;
    barra.hidden = n === 0;
    $('#quanti-scelti').textContent = n;
  };
  $$('.scelta').forEach(c => c.onchange = aggiornaBarra);
  if ($('#scelta-annulla')) $('#scelta-annulla').onclick = () => { $$('.scelta').forEach(c => { c.checked = false; }); aggiornaBarra(); };
  $$('[data-copia]').forEach(b => b.onclick = safe(async () => {
    const ids = scelti();
    if (!ids.length) return;
    const nome = b.textContent.replace('Copia in Allenamenti ', '');
    if (!await confirmDlg(`Copiare ${ids.length === 1 ? 'questo allenamento' : ids.length + ' allenamenti'} negli allenamenti di ${nome}?`)) return;
    const r = await api('/workouts/copy', { method: 'POST', body: { ids, to_user_id: +b.dataset.copia } });
    toast(`${r.copiati} copiat${r.copiati === 1 ? 'o' : 'i'} per ${r.atleta}` + (r.gia_presenti ? `, ${r.gia_presenti} gi\u00e0 presenti` : ''));
    render();
  }));
  $$('[data-ren]').forEach(b => b.onclick = () => renameWorkout(b.dataset.ren, b.dataset.name, render));
  $$('[data-del]').forEach(b => b.onclick = safe(async () => {
    if (!await confirmDlg('Eliminare l\'allenamento? Non verr\u00e0 pi\u00f9 ricaricato dalle sincronizzazioni.')) return;
    await api('/workouts/' + b.dataset.del, { method: 'DELETE' });
    toast('Allenamento eliminato'); render();
  }));
}
// Il battito di un'uscita, minuto per minuto. La media e il massimo sono due
// numeri; la curva racconta dove si e' spinto e dove si e' tirato il fiato.
const mmss = s => { const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
function graficoBattiti(serie, durataAllenamento, letture = 0) {
  if (!Array.isArray(serie) || serie.length < 2) return '';
  const bpm = serie.map(p => p[1]);
  const minimo = Math.min(...bpm), massimo = Math.max(...bpm);
  const durata = serie[serie.length - 1][0] || 1;
  const media = Math.round(serie.reduce((t, p) => t + p[1], 0) / serie.length);
  const L = 640, A = 210, sx = 40, dx = 10, su = 12, giu = 26;
  const respiro = Math.max(6, (massimo - minimo) * 0.12);
  const basso = Math.max(30, minimo - respiro), alto = massimo + respiro;
  const X = t => sx + (t / durata) * (L - sx - dx);
  const Y = v => su + (1 - (v - basso) / (alto - basso)) * (A - su - giu);
  const punti = serie.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`);
  const base = (A - giu).toFixed(1);
  const area = `M${punti[0]} L${punti.join(' L')} L${X(durata).toFixed(1)},${base} L${sx},${base} Z`;
  const tacche = [massimo, media, minimo];
  const griglia = tacche.map(v => `<line x1="${sx}" y1="${Y(v).toFixed(1)}" x2="${L - dx}" y2="${Y(v).toFixed(1)}" class="griglia"/>
    <text x="${sx - 6}" y="${(Y(v) + 3.5).toFixed(1)}" class="tacca" text-anchor="end">${v}</text>`).join('');
  const orari = [0, durata / 2, durata].map((t, i) => `<text x="${X(t).toFixed(1)}" y="${A - 8}" class="tacca" text-anchor="${i === 0 ? 'start' : i === 1 ? 'middle' : 'end'}">${mmss(t)}</text>`).join('');
  const coordinate = serie.map(p => ({ x: +X(p[0]).toFixed(1), y: +Y(p[1]).toFixed(1), t: p[0], bpm: p[1] }));
  return `<div class="card" style="margin-top:14px"><div class="row between"><h2>\u2764\ufe0f Battito</h2>
      <div class="small muted">${serie.length} misure in ${mmss(durata)} \u00b7 min ${minimo} \u00b7 media ${media} \u00b7 max ${massimo} bpm</div></div>
    <svg class="grafico-peso grafico-battito" viewBox="0 0 ${L} ${A}" role="img" aria-label="Battito durante l\u2019allenamento"
        data-larghezza="${L}" data-battiti="${esc(JSON.stringify(coordinate))}">
      ${griglia}<path d="${area}" class="area"/><polyline points="${punti.join(' ')}" class="linea"/>
      <line class="guida-scelta" y1="${su}" y2="${base}" x1="0" x2="0" hidden/>
      <circle class="punto-scelto" r="6" cx="0" cy="0" hidden/>
      ${orari}<rect class="tocco" x="0" y="0" width="${L}" height="${A}" fill="transparent"/></svg>
    <div class="peso-scelto" id="battito-scelto">Tocca il grafico per vedere minuto e battito</div>
    ${durataAllenamento && durata > durataAllenamento * 1.1 + 300
      ? `<div class="small muted" style="margin-top:6px">L\u2019orologio ha registrato per ${mmss(durata)}, piu\u2019 della durata segnata dell\u2019uscita (${dur(durataAllenamento)}): la curva copre tutto quello che ha misurato.</div>`
      : ''}
    ${letture ? `<div class="small muted" style="margin-top:6px">Curva ricostruita da ${letture} letture della giornata, una ogni ${Math.round(durata / letture / 60) || 1} minuti circa: l\u2019orologio misurava, ma non era stato avviato nessun allenamento. Con l\u2019allenamento avviato le misure sono una ogni pochi secondi.</div>` : ''}</div>`;
}

async function viewWorkout(id) {
  const w = await api('/workouts/' + id);
  const trips = await api('/trips');
  const stat = (l, v) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div></div>`;
  $('#app').innerHTML = layout(`<a href="${tornaAllenamenti(w)}" class="small">← Allenamenti ${esc(w.athlete || '')}</a><div class="row between" style="margin:4px 0 14px"><h1>${sportIco(w.sport)} ${esc(w.name || w.sport || 'Allenamento')}</h1><div class="row nowrap" style="gap:6px"><button class="btn" id="mod">Modifica dati</button><button class="btn ghost icon" id="ren" title="Rinomina">✏️</button><button class="btn ghost danger icon" id="del" title="Elimina">🗑</button></div></div>
    <div class="muted small" style="margin-bottom:12px">${fdt(w.started_at)}${w.luogo ? ' · 📍 ' + esc(w.luogo) : ''} · ${esc(w.athlete)} · fonte: ${w.source}${w.meta?.komoot_url ? ` · <a href="${esc(w.meta.komoot_url)}" target="_blank">apri su Komoot</a>` : ''}${w.meta?.merged_from_health ? ' · battito e calorie da iPhone' : ''}${w.meta?.battiti_da_letture ? ` · <span title="Nessun allenamento registrato sull\u2019orologio: i battiti sono le letture della giornata ritagliate su queste ore">battiti ricostruiti</span>` : ''}${w.meta?.calorie_da_letture ? ' · <span title="Somma dell\u2019energia attiva misurata in quelle ore">calorie ricavate dall\u2019energia attiva</span>' : ''}${w.trip_title ? ` · <span class="badge link" title="Collegato al viaggio">🔗 ${esc(w.trip_title)}</span>` : ''}</div>
    <div class="tiles" style="margin-bottom:14px">${stat('Distanza', num((w.distance_m || 0) / 1000) + ' km')}${stat('Durata', dur(w.duration_s))}${stat('Media oraria', mediaKmh(w) ? num(mediaKmh(w)) + ' km/h' : '—')}${stat('Dislivello', (w.elevation_up_m || 0) + ' m')}${dislivelloOrario(w) ? stat('Dislivello orario', num(dislivelloOrario(w), 0) + ' m/h') : ''}${stat('❤️ Medio', w.hr_avg ? w.hr_avg + ' bpm' : '—')}${stat('❤️ Max', w.hr_max ? w.hr_max + ' bpm' : '—')}${stat('Calorie', w.calories ? w.calories + ' kcal' : '—')}${w.peso_kg != null ? stat('Peso', `${num(w.peso_kg, 1)} kg<div class="sub">pesata del giorno</div>`) : ''}</div>
    ${w.track ? '<div class="card pad-0"><div id="map" class="map tall"></div></div>' : '<div class="card muted">Nessuna traccia GPS per questo allenamento.</div>'}
    ${w.track ? '<div class="row" style="margin-top:10px"><button class="btn sm primary" id="rivedi-uno">\u25b6 Rivedi il percorso</button></div>' : ''}
    ${graficoBattiti(w.hr_track, w.duration_s, w.meta?.battiti_da_letture || 0)}
    <div class="card" style="margin-top:14px"><div class="row"><div class="grow"><label class="f">Associato al viaggio</label>
      <select id="trip">
        <option value="auto" ${w.trip_manual ? '' : 'selected'}>Automatico, in base alle date</option>
        <option value="" ${w.trip_manual && !w.trip_id ? 'selected' : ''}>Nessun viaggio</option>
        ${trips.map(t => `<option value="${t.id}" ${w.trip_manual && w.trip_id === t.id ? 'selected' : ''}>${esc(nomeViaggio(t))}</option>`).join('')}
      </select>
      <div class="small muted" style="margin-top:6px">${w.trip_manual
        ? (w.trip_id ? 'Scelta tua: resta su questo viaggio anche se le date non coincidono.' : 'Scelta tua: resta senza viaggio, l\u2019abbinamento automatico non lo tocca.')
        : (w.trip_title ? `Abbinato da solo a «${esc(w.trip_title)}» perché la data ricade nel periodo.` : 'Nessun viaggio copre questa data.')}</div>
      </div></div></div>`);
  if (w.track) { const map = makeMap($('#map')); window.__mappaAllenamento = map; const pl = L.polyline(w.track.map(p => [p[0], p[1]]), { color: '#ec4899', weight: 4 }).addTo(map); map.fitBounds(pl.getBounds(), { padding: [20, 20] });
    L.marker(w.track[0], { icon: pin('#16a34a', '▶') }).addTo(map); L.marker(w.track[w.track.length - 1], { icon: pin('#dc2626', '■') }).addTo(map);
    // Rivedere il giro: una traccia sola, con l'icona della disciplina
    $('#rivedi-uno')?.addEventListener('click', () => riproduci(map, [{
      punti: w.track.map(p => [p[0], p[1]]),
      faccia: sportIco(w.sport),
      da: w.luogo || null,
      titolo: `Allenamento ${w.athlete || ''}`.trim(),
      nome: [w.luogo, w.name || w.sport || 'Allenamento'].filter(Boolean).join(' \u00b7 '),
      quando: fdate(w.started_at),
      numeri: numeriAllenamento(w),
    }], [], { secondi: 20 }));
  }
  $('#trip').onchange = safe(async e => {
    const v = e.target.value;
    await api('/workouts/' + id, { method: 'PUT', body: v === 'auto' ? { trip_auto: true } : { trip_id: v || null } });
    toast(v === 'auto' ? 'Torna all\u2019abbinamento automatico' : 'Salvato'); render();
  });
  // Come per il peso: sul telefono il passaggio del mouse non esiste, e i
  // suggerimenti del disegno resterebbero muti
  const disegno = $('.grafico-battito');
  if (disegno) {
    const coordinate = JSON.parse(disegno.dataset.battiti);
    const larghezza = +disegno.dataset.larghezza;
    const guida = $('.guida-scelta', disegno), segno = $('.punto-scelto', disegno), scritta = $('#battito-scelto');
    const cerca = e => {
      const r = disegno.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * larghezza;
      let vicino = 0;
      coordinate.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(coordinate[vicino].x - x)) vicino = i; });
      const p = coordinate[vicino];
      guida.setAttribute('x1', p.x); guida.setAttribute('x2', p.x); guida.removeAttribute('hidden');
      segno.setAttribute('cx', p.x); segno.setAttribute('cy', p.y); segno.removeAttribute('hidden');
      scritta.innerHTML = `<b>${p.bpm} bpm</b> \u00b7 dopo ${mmss(p.t)}`;
    };
    let premuto = false;
    disegno.addEventListener('pointerdown', e => { premuto = true; cerca(e); });
    disegno.addEventListener('pointermove', e => { if (premuto) cerca(e); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(v => disegno.addEventListener(v, () => { premuto = false; }));
  }
  $('#mod').onclick = () => modificaWorkout(w, render);
  $('#ren').onclick = () => renameWorkout(id, w.name || w.sport || '', render);
  $('#del').onclick = safe(async () => { if (await confirmDlg('Eliminare l\'allenamento?')) { await api('/workouts/' + id, { method: 'DELETE' }); location.hash = tornaAllenamenti(w); } });
}

// ---------- Cruscotto ----------
// Ogni filtro e' un elenco: vuoto significa "nessun vincolo", piu' valori si sommano
const dash = { trips: [], stati: [], atleti: [], sport: [], fonti: [], anni: [], mesi: [], from: '', to: '', q: '', aperte: {} };
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// Menu a tendina con scelta multipla, riusato da tutti i filtri del Cruscotto
function tendinaMulti(id, etichetta, voci, scelti, vuoto) {
  const testo = !scelti.length ? vuoto
    : scelti.length > 1 ? `${scelti.length} selezionate`
    : (voci.find(v => v.valore === scelti[0]) || { nome: scelti[0] }).nome;
  return `<div class="field w-md"><label class="f">${etichetta}</label>
    <details class="tendina" data-tendina="${id}" ${dash.aperte[id] ? 'open' : ''}>
      <summary>${esc(String(testo))}</summary>
      <div class="tendina-corpo">
        ${voci.map(v => `<label><input type="checkbox" data-filtro="${id}" value="${esc(v.valore)}" ${scelti.includes(v.valore) ? 'checked' : ''}> ${esc(v.nome)}${v.quanti != null ? ` <span class="muted">(${v.quanti})</span>` : ''}</label>`).join('')}
        <button class="btn" data-azzera="${id}" ${scelti.length ? '' : 'disabled'}>Tutte</button>
      </div>
    </details></div>`;
}

async function viewDashboard() {
  const [ws, trips] = await Promise.all([api('/workouts'), api('/trips')]);
  // Con piu' atleti, e con le copie di uno stesso giro su entrambi, partire da
  // "tutti" raddoppierebbe i totali. Si parte da chi e' collegato.
  if (!dash.avviato) { dash.avviato = true; if (atleti.length > 1) dash.atleti = [user.name]; }
  // Le voci di ogni menu vengono dai dati, col numero di attivita' accanto
  const conteggio = (chiave, trasforma = v => v) => {
    const m = new Map();
    ws.forEach(w => { const v = trasforma(w[chiave] ?? w); if (v != null && v !== '') m.set(v, (m.get(v) || 0) + 1); });
    return m;
  };
  const daMappa = (m, nome = v => String(v)) => [...m.entries()].sort((a, b) => b[1] - a[1])
    .map(([valore, quanti]) => ({ valore: String(valore), nome: nome(valore), quanti }));

  const annoDi = w => String(new Date(w.started_at).getFullYear());
  const meseDi = w => String(new Date(w.started_at).getMonth());

  const vociAtleti = daMappa(conteggio('athlete'));
  const vociSport = daMappa(conteggio('sport'));
  const vociFonti = daMappa(conteggio('source'));
  const vociAnni = [...conteggio(null, annoDi).entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([valore, quanti]) => ({ valore, nome: valore, quanti }));
  const vociMesi = [...conteggio(null, meseDi).entries()].sort((a, b) => +a[0] - +b[0])
    .map(([valore, quanti]) => ({ valore, nome: MESI_BREVI[+valore], quanti }));
  const vociViaggi = [{ valore: 'none', nome: 'Senza viaggio' }, ...trips.map(t => ({ valore: String(t.id), nome: t.title }))];
  const vociStati = [{ valore: 'open', nome: 'Aperti' }, { valore: 'closed', nome: 'Chiusi' }];

  // Filtra gli allenamenti: un elenco vuoto non vincola, piu' valori si sommano
  const filtra = () => {
    const q = dash.q.trim().toLowerCase();
    const idsStato = new Set(trips.filter(t => dash.stati.includes(t.status)).map(t => t.id));
    return ws.filter(w => {
      if (dash.trips.length && !dash.trips.includes(w.trip_id ? String(w.trip_id) : 'none')) return false;
      if (dash.stati.length && !(w.trip_id && idsStato.has(w.trip_id))) return false;
      if (dash.atleti.length && !dash.atleti.includes(w.athlete)) return false;
      if (dash.sport.length && !dash.sport.includes(w.sport)) return false;
      if (dash.fonti.length && !dash.fonti.includes(w.source)) return false;
      if (dash.anni.length && !dash.anni.includes(annoDi(w))) return false;
      if (dash.mesi.length && !dash.mesi.includes(meseDi(w))) return false;
      const d = iso(w.started_at);
      if (dash.from && d < dash.from) return false;
      if (dash.to && d > dash.to) return false;
      if (q && !`${w.name || ''} ${w.sport || ''} ${w.trip_title || ''} ${w.athlete || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  };

  $('#app').innerHTML = layout(`<div class="row between" style="margin-bottom:12px"><h1>Cruscotto</h1><button class="btn" id="reset">Azzera filtri</button></div>
    <div class="card">
      <div class="row">
        ${tendinaMulti('trips', 'Viaggio', vociViaggi, dash.trips, 'Tutti i viaggi')}
        ${tendinaMulti('stati', 'Stato', vociStati, dash.stati, 'Tutti')}
        ${tendinaMulti('atleti', 'Atleta', vociAtleti, dash.atleti, 'Tutti')}
        ${tendinaMulti('sport', 'Sport', vociSport, dash.sport, 'Tutti')}
        ${tendinaMulti('anni', 'Anno', vociAnni, dash.anni, 'Tutti')}
        ${tendinaMulti('mesi', 'Mese', vociMesi, dash.mesi, 'Tutti')}
        ${tendinaMulti('fonti', 'Fonte', vociFonti, dash.fonti, 'Tutte')}
      </div>
      <div class="row" style="margin-top:4px">
        <div class="field w-md"><label class="f">Dal</label><input type="date" id="f-from" value="${dash.from}"></div>
        <div class="field w-md"><label class="f">Al</label><input type="date" id="f-to" value="${dash.to}"></div>
        <div class="field grow" style="min-width:180px"><label class="f">Cerca</label><input id="f-q" placeholder="Nome allenamento, sport o viaggio" value="${esc(dash.q)}"></div>
      </div>
      <div class="small muted" style="margin-top:8px">In ogni menu puoi spuntare piu' voci: i valori scelti si sommano.</div>
    </div>
    <div id="out"></div>`);

  const disegna = () => {
    const f = filtra();
    const t = f.reduce((a, w) => ({ n: a.n + 1, km: a.km + (w.distance_m || 0) / 1000, s: a.s + (w.duration_s || 0), kcal: a.kcal + (w.calories || 0), up: a.up + (w.elevation_up_m || 0), hr: a.hr + (w.hr_avg || 0), hrn: a.hrn + (w.hr_avg ? 1 : 0) }),
      { n: 0, km: 0, s: 0, kcal: 0, up: 0, hr: 0, hrn: 0 });

    const perSport = {};
    f.forEach(w => { const k = w.sport || 'altro'; perSport[k] = (perSport[k] || 0) + (w.distance_m || 0) / 1000; });
    const sportOrd = Object.entries(perSport).sort((a, b) => b[1] - a[1]);
    const maxKm = Math.max(1, ...sportOrd.map(x => x[1]));

    const perTrip = {};
    f.forEach(w => { const k = w.trip_id || 0; (perTrip[k] ||= { titolo: w.trip_title || 'Senza viaggio', n: 0, km: 0, kcal: 0, s: 0 }); const r = perTrip[k]; r.n++; r.km += (w.distance_m || 0) / 1000; r.kcal += w.calories || 0; r.s += w.duration_s || 0; });
    // Un viaggio chiesto per nome nei filtri compare comunque, anche se in quel
    // periodo non ci si e' allenati: le ore al volante ci sono lo stesso, e
    // cercarlo e non trovarlo sembrerebbe che non sia mai esistito
    dash.trips.filter(x => x !== 'none').forEach(id => {
      const v = trips.find(x => String(x.id) === String(id));
      if (v && !perTrip[id]) perTrip[id] = { titolo: v.title, n: 0, km: 0, kcal: 0, s: 0 };
    });
    const tripOrd = Object.entries(perTrip).sort((a, b) => b[1].km - a[1].km);
    const datiViaggio = id => trips.find(x => x.id === +id);
    // I km del camper vengono dalle tappe del viaggio, non dagli allenamenti:
    // sono due grandezze diverse e vanno tenute separate.
    const kmCamper = tripOrd.reduce((a, [id]) => a + (datiViaggio(id)?.km || 0), 0);
    // Le ore al volante dei viaggi in elenco: quanto e' costato, in tempo,
    // arrivare dove si e' andati
    const guidaTot = tripOrd.reduce((a, [id]) => a + (datiViaggio(id)?.minuti_guida || 0), 0);

    const MAX = 60;
    $('#out').innerHTML = `
      ${atleti.length > 1 && dash.atleti.length !== 1 ? `<div class="card small" style="margin:14px 0 0;border-left:3px solid var(--warn)">
        \u26a0\ufe0f Stai guardando ${dash.atleti.length ? 'pi\u00f9 atleti insieme' : 'tutti gli atleti insieme'}: un giro copiato su entrambi viene contato due volte.</div>` : ''}
      <div class="tiles" style="margin:14px 0">
        <div class="tile accent"><div class="label">Attività</div><div class="value">${t.n}</div><div class="sub">su ${ws.length} totali</div></div>
        <div class="tile"><div class="label">Km allenamento</div><div class="value">${num(t.km)} km</div></div>
        <div class="tile"><div class="label">Km in camper</div><div class="value">${num(kmCamper, 0)} km</div><div class="sub">dei viaggi in elenco</div></div>
        <div class="tile"><div class="label">Ore di guida</div><div class="value">${dur(guidaTot * 60)}</div><div class="sub">${guidaTot ? num(kmCamper / (guidaTot / 60), 0) + ' km/h di media' : 'dei viaggi in elenco'}</div></div>
        <div class="tile"><div class="label">Tempo</div><div class="value">${dur(t.s)}</div></div>
        <div class="tile"><div class="label">Calorie</div><div class="value">${num(t.kcal, 0)}</div></div>
        <div class="tile"><div class="label">Dislivello</div><div class="value">${num(t.up, 0)} m</div></div>
        <div class="tile"><div class="label">Battito medio</div><div class="value">${t.hrn ? Math.round(t.hr / t.hrn) + ' bpm' : '—'}</div></div>
      </div>
        <div class="card pad-0" style="margin-bottom:14px"><div style="padding:14px 16px 6px"><h2>Per viaggio</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Viaggio</th><th>Date</th><th class="num">Km camper</th><th class="num">Guida</th><th class="num">Attività</th><th class="num">Km allenam.</th><th class="num">Tempo</th><th class="num">Spesa</th></tr></thead>
          <tbody>${tripOrd.map(([id, r]) => { const v = datiViaggio(id); return `<tr><td>${+id ? `<a href="#/trip/${id}">${esc(v ? nomeViaggio(v) : r.titolo)}</a>` : `<span class="muted">${esc(r.titolo)}</span>`}${v ? ` <span class="badge ${v.status === 'open' ? 'open' : 'closed'}">${v.status === 'open' ? 'aperto' : 'chiuso'}</span>` : ''}</td>
            <td class="nowrap small">${v ? `${dateCliccabili(v)}` : '<span class="muted">\u2014</span>'}</td><td class="num">${v ? num(v.km, 0) : '—'}</td><td class="num nowrap" ${v?.minuti_strada > v?.minuti_guida + 5 ? `title="In strada ${dur(v.minuti_strada * 60)}, soste comprese"` : ''}>${v?.minuti_guida ? dur(v.minuti_guida * 60) : '—'}</td><td class="num">${r.n}</td><td class="num">${num(r.km)}</td><td class="num">${dur(r.s)}</td><td class="num">${v ? eur(v.total) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Nessun dato con questi filtri</td></tr>'}</tbody></table></div></div>
      <div class="grid due">
        <div class="card"><h2>Km di allenamento per sport</h2><div class="small muted">i km in camper sono nella tabella accanto</div>
          <div class="barre-oriz">${sportOrd.map(([k, v]) => `<div class="barra-oriz">
            <div class="riga"><span class="etichetta">${sportIco(k)} ${esc(k)}</span><b class="valore">${num(v)} km</b></div>
            <span class="traccia"><i style="width:${Math.max(2, v / maxKm * 100)}%"></i></span></div>`).join('') || '<div class="empty">Nessun dato con questi filtri</div>'}</div></div>
      <div class="card pad-0"><div class="row between" style="padding:14px 16px 6px"><h2>Allenamenti (${f.length})</h2>${f.length > MAX ? `<span class="small muted">mostrati i primi ${MAX}</span>` : ''}</div>
        <div class="list">${f.slice(0, MAX).map(w => `<div class="item"><a class="item-main" href="#/allenamento/${w.id}"><div class="sport-ico">${sportIco(w.sport)}</div><div class="grow"><div class="title">${esc(w.name || w.sport || 'Allenamento')}</div>
          <div class="meta">${fdt(w.started_at)} · ${esc(w.athlete)} · <span class="badge">${w.source}</span>${w.trip_title ? ` · <span class="badge link">🔗 ${esc(w.trip_title)}</span>` : ''}</div></div>
          <div class="right small nowrap">${numeriRiga(w)}</div></a></div>`).join('') || '<div class="empty">Nessun allenamento corrisponde ai filtri.</div>'}</div></div>
      </div>`;
  };

  const lega = (sel, chiave, evento = 'change') => { const el = $(sel); el.addEventListener(evento, () => { dash[chiave] = el.value; disegna(); }); };
  lega('#f-from', 'from'); lega('#f-to', 'to'); lega('#f-q', 'q', 'input');

  // Le tendine si aggiornano sul posto invece di ridisegnare tutta la pagina: cosi'
  // restano aperte e la ricerca testuale non perde il cursore
  const vociPer = { trips: vociViaggi, stati: vociStati, atleti: vociAtleti, sport: vociSport, anni: vociAnni, mesi: vociMesi, fonti: vociFonti };
  const vuotoPer = { trips: 'Tutti i viaggi', stati: 'Tutti', atleti: 'Tutti', sport: 'Tutti', anni: 'Tutti', mesi: 'Tutti', fonti: 'Tutte' };
  const aggiornaTendina = id => {
    const scelti = dash[id], voci = vociPer[id];
    const testo = !scelti.length ? vuotoPer[id]
      : scelti.length > 1 ? `${scelti.length} selezionate`
      : (voci.find(v => v.valore === scelti[0]) || { nome: scelti[0] }).nome;
    $(`[data-tendina="${id}"] summary`).textContent = testo;
    $(`[data-azzera="${id}"]`).disabled = !scelti.length;
  };
  $$('[data-tendina]').forEach(d => d.ontoggle = () => {
    dash.aperte[d.dataset.tendina] = d.open;
    if (d.open) sistemaTendina(d);
  });
  $$('[data-filtro]').forEach(c => c.onchange = () => {
    const id = c.dataset.filtro;
    dash[id] = c.checked ? [...dash[id], c.value] : dash[id].filter(x => x !== c.value);
    aggiornaTendina(id); disegna();
  });
  $$('[data-azzera]').forEach(b => b.onclick = () => {
    const id = b.dataset.azzera;
    dash[id] = [];
    $$(`[data-filtro="${id}"]`).forEach(x => { x.checked = false; });
    aggiornaTendina(id); disegna();
  });
  $('#reset').onclick = () => {
    ['trips', 'stati', 'atleti', 'sport', 'fonti', 'anni', 'mesi'].forEach(k => { dash[k] = []; });
    if (atleti.length > 1) dash.atleti = [user.name];   // azzerare non deve rimettere insieme gli atleti
    dash.from = ''; dash.to = ''; dash.q = ''; dash.aperte = {};
    render();
  };
  disegna();
}

// ---------- Riepiloghi ----------
const state = { period: 'month', from: null, to: null, group: 'month', atleta: null, viaggio: null, avviato: false };
// I grafici che hanno senso solo dentro un viaggio: su tutto l'archivio le
// tappe di viaggi diversi finirebbero nello stesso grafico senza voler dire
// niente. Qui invece la domanda e' «in questo viaggio, dove sono finiti i
// chilometri, le ore e i soldi».
const barreOriz = (voci, unita) => {
  if (!voci.length) return '<div class="empty">Nessun dato</div>';
  const massimo = Math.max(1, ...voci.map(v => v.valore));
  return `<div class="barre-oriz">${voci.map(v => `<div class="barra-oriz">
    <div class="riga"><span class="etichetta">${v.etichetta}</span><b class="valore">${v.testo ?? (num(v.valore) + ' ' + unita)}</b></div>
    <span class="traccia"><i style="width:${Math.max(2, v.valore / massimo * 100)}%"></i></span></div>`).join('')}</div>`;
};

function graficiDelViaggio(d) {
  const { trip, legs, expenses, workouts, totals } = d;
  const nome = l => `${esc(String(l.from_name).split(',')[0])} \u2192 ${esc(String(l.to_name).split(',')[0])}`;
  // Il gasolio calcolato sulle tappe un luogo non ce l'ha: si consuma lungo la
  // strada, e metterlo nel mucchio del «senza luogo» faceva sparire la voce piu'
  // grossa del viaggio dentro una parola che non spiega niente
  const perLuogo = {};
  expenses.forEach(e => {
    const k = (e.place || '').trim()
      || (e.auto && e.category === 'gasolio' ? '\u26fd Gasolio delle tappe' : 'Senza luogo');
    perLuogo[k] = (perLuogo[k] || 0) + (+e.amount || 0) * (+e.rate || 1);
  });
  const luoghi = Object.entries(perLuogo).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const quanteSenzaLuogo = expenses.filter(e => !(e.place || '').trim() && !(e.auto && e.category === 'gasolio')).length;
  const perSport = {};
  workouts.forEach(w => { const k = w.sport || 'Altro'; perSport[k] = (perSport[k] || 0) + (w.distance_m || 0) / 1000; });
  const sport = Object.entries(perSport).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return `<div class="card" style="margin-top:14px"><div class="row between"><h2>\ud83d\ude90 ${esc(nomeViaggio(trip))}</h2>
      <div class="small muted">${dateViaggio(trip)} \u00b7 ${legs.length} tappe \u00b7 ${num(totals.km)} km \u00b7 ${dur(totals.minutes * 60)} di guida</div></div></div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><h2>Chilometri per tappa</h2><div class="small muted">dove sono finiti i chilometri di questo viaggio</div>
        ${barreOriz(legs.map(l => ({ etichetta: nome(l), valore: +l.distance_km || 0 })), 'km')}</div>
      <div class="card"><h2>Ore di guida per tappa</h2><div class="small muted">quanto e\u2019 costata, in tempo, ogni tratta</div>
        ${barreOriz(legs.map(l => ({ etichetta: nome(l), valore: l.duration_min || 0, testo: dur((l.duration_min || 0) * 60) })), 'min')}</div>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><h2>Spese per luogo</h2><div class="small muted">dove sono stati spesi i soldi${quanteSenzaLuogo ? ` \u00b7 ${quanteSenzaLuogo} ${quanteSenzaLuogo === 1 ? 'spesa non ha' : 'spese non hanno'} il luogo scritto` : ''}</div>
        ${barreOriz(luoghi.map(([k, v]) => ({ etichetta: esc(k), valore: v, testo: eur(v) })), '\u20ac')}</div>
      <div class="card"><h2>Km di allenamento per disciplina</h2><div class="small muted">le attivit\u00e0 dentro le date del viaggio</div>
        ${barreOriz(sport.map(([k, v]) => ({ etichetta: `${sportIco(k)} ${esc(k)}`, valore: v })), 'km')}</div>
    </div>`;
}

async function viewSummary() {
  const now = new Date();
  const presets = { week: [iso(now - 6 * 864e5), today(), 'day'], month: [iso(new Date(now.getFullYear(), now.getMonth(), 1)), today(), 'day'], year: [`${now.getFullYear()}-01-01`, today(), 'month'], all: ['2000-01-01', today(), 'year'], custom: null };
  if (state.period !== 'custom') [state.from, state.to, state.group] = presets[state.period];
  // Come nel Cruscotto: di partenza gli allenamenti sono quelli di chi e' collegato,
  // per non sommare le copie dello stesso giro presenti su piu' atleti
  if (!state.avviato) { state.avviato = true; if (atleti.length > 1) state.atleta = user.id; }
  const viaggi = await api('/trips');
  // Scelto un viaggio, il periodo diventa il suo: chiedere anche le date sarebbe
  // far fare due volte lo stesso lavoro, e sbagliarle nasconderebbe tutto
  const viaggio = state.viaggio ? viaggi.find(v => v.id === state.viaggio) : null;
  if (viaggio) {
    state.from = viaggio.start_date ? iso(viaggio.start_date) : state.from;
    state.to = viaggio.end_date ? iso(viaggio.end_date) : today();
    if (state.period !== 'custom') state.group = 'day';
  }
  const s = await api(`/summary?from=${state.from}&to=${state.to}&group=${state.group}${state.atleta ? '&user_id=' + state.atleta : ''}${viaggio ? '&trip_id=' + viaggio.id : ''}`);
  // Del viaggio scelto si prende tutto: tappe, spese e allenamenti servono ai
  // grafici che hanno senso solo dentro un viaggio
  const dettaglio = viaggio ? await api('/trips/' + viaggio.id) : null;
  const periods = [...new Set([...s.periods.map(p => p.period), ...s.km.map(p => p.period), ...s.workouts.map(p => p.period)])].sort();
  const fmtP = p => state.group === 'year' ? p.slice(0, 4) : state.group === 'month' ? new Date(p).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }) : new Date(p).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const spentBy = Object.fromEntries(periods.map(p => [p, s.periods.filter(x => x.period === p).reduce((a, b) => a + b.total, 0)]));
  const max = Math.max(1, ...Object.values(spentBy));
  const kmBy = Object.fromEntries(s.km.map(k => [k.period, k.km]));
  const woBy = Object.fromEntries(s.workouts.map(k => [k.period, k]));
  // Scale separate: i km in camper sono di un ordine di grandezza piu' grandi
  const maxKmCamper = Math.max(1, ...Object.values(kmBy));
  const maxKmSport = Math.max(1, ...Object.values(woBy).map(x => x.km || 0));
  const total = s.totals.spent || 1;
  let acc = 0; const grad = s.by_category.map(c => { const a = acc; acc += c.total / total * 100; return `${catColor(c.category)} ${a}% ${acc}%`; }).join(', ');
  $('#app').innerHTML = layout(`<h1 style="margin-bottom:12px">Riepiloghi</h1>
    <div class="card">${viaggio ? `<div class="small muted">Il periodo e’ quello del viaggio: <b>${dateViaggio(viaggio)}</b>. Per guardare un periodo qualsiasi, rimetti «Tutti i viaggi».</div>` : `<div class="chips">${[['week', '7 giorni'], ['month', 'Questo mese'], ['year', 'Quest\'anno'], ['all', 'Tutto'], ['custom', 'Periodo…']].map(([k, l]) => `<span class="chip ${state.period === k ? 'active' : ''}" data-p="${k}">${l}</span>`).join('')}</div>`}
      <div class="row" style="margin-top:12px">${viaggio ? '' : `<div class="field w-md"><label class="f">Dal</label><input type="date" id="from" value="${state.from}"></div><div class="field w-md"><label class="f">Al</label><input type="date" id="to" value="${state.to}"></div>`}
      <div class="field w-md"><label class="f">Viaggio</label><select id="f-viaggio">
        <option value="">Tutti i viaggi</option>${viaggi.map(v => `<option value="${v.id}" ${state.viaggio === v.id ? 'selected' : ''}>${esc(nomeViaggio(v))}${v.start_date ? ' \u00b7 ' + fdate(v.start_date) : ''}</option>`).join('')}</select></div>
      ${atleti.length > 1 ? `<div class="field w-sm"><label class="f">Allenamenti di</label><select id="f-atleta">
        <option value="">Tutti insieme</option>${atleti.map(a => `<option value="${a.id}" ${state.atleta === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field w-sm"><label class="f">Raggruppa</label><select id="group">${[['day', 'Giorno'], ['week', 'Settimana'], ['month', 'Mese'], ['year', 'Anno']].map(([k, l]) => `<option value="${k}" ${state.group === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>${viaggio ? '' : '<div class="field" style="align-self:flex-end"><button class="btn primary" id="go">Applica</button></div>'}</div></div>
    <div class="tiles" style="margin:14px 0"><div class="tile accent"><div class="label">Speso</div><div class="value">${eur(s.totals.spent)}</div><div class="sub">${s.totals.trips} viagg${s.totals.trips === 1 ? 'io' : 'i'}</div></div><div class="tile"><div class="label">Km in camper</div><div class="value">${num(s.totals.km, 0)}</div><div class="sub">${s.totals.legs} tappe · ${s.totals.km ? eur(s.totals.spent / s.totals.km) + '/km' : ''}</div></div><div class="tile"><div class="label">Allenamenti</div><div class="value">${s.totals.workouts}</div><div class="sub">${num(s.totals.workout_km)} km</div></div><div class="tile"><div class="label">Calorie</div><div class="value">${num(s.totals.calories, 0)}</div></div></div>
    ${dettaglio ? graficiDelViaggio(dettaglio) : ''}
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><h2>Spese per ${({ day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' })[state.group]}</h2>
        <div class="bars">${periods.map(p => `<div class="bar" title="${fmtP(p)}: ${eur(spentBy[p])}"><i style="height:${(spentBy[p] || 0) / max * 100}%"></i><b>${fmtP(p)}</b></div>`).join('') || '<div class="empty grow">Nessun dato nel periodo</div>'}</div></div>
      <div class="card"><h2>Per categoria</h2><div class="donut" style="margin-top:10px"><div class="ring" style="background:conic-gradient(${grad || 'var(--surface-2) 0 100%'})"><b>${eur(s.totals.spent)}</b></div>
        <div class="legend" style="flex-direction:column;gap:6px">${s.by_category.map(c => `<span><i class="dot" style="display:inline-block;background:${catColor(c.category)}"></i>${catLabel(c.category)} <b>${eur(c.total)}</b> <span class="muted">${Math.round(c.total / total * 100)}%</span></span>`).join('') || '<span class="muted">—</span>'}</div></div></div>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><h2>Km in camper</h2><div class="small muted">dalle tappe del viaggio</div>
        <div class="bars">${periods.map(p => `<div class="bar" title="${fmtP(p)}: ${num(kmBy[p] || 0, 0)} km in camper"><i style="height:${(kmBy[p] || 0) / maxKmCamper * 100}%"></i><b>${fmtP(p)}</b></div>`).join('') || '<div class="empty grow">Nessun dato nel periodo</div>'}</div></div>
      <div class="card"><h2>Km di allenamento</h2><div class="small muted">a piedi, in bici e le altre attività</div>
        <div class="bars">${periods.map(p => `<div class="bar" title="${fmtP(p)}: ${num(woBy[p]?.km || 0)} km di attività"><i class="sport" style="height:${(woBy[p]?.km || 0) / maxKmSport * 100}%"></i><b>${fmtP(p)}</b></div>`).join('') || '<div class="empty grow">Nessun dato nel periodo</div>'}</div></div>
    </div>
    <div class="small muted" style="margin:6px 2px 0">I due grafici hanno scale indipendenti: le altezze non sono confrontabili fra loro.${atleti.length > 1 ? ` Gli allenamenti mostrati sono ${state.atleta ? 'di ' + esc((atleti.find(a => a.id === state.atleta) || {}).name || '') : 'di tutti gli atleti insieme'}; spese e chilometri in camper riguardano il viaggio e restano comuni.` : ''}</div>
    <div class="card pad-0" style="margin-top:14px"><div class="table-wrap"><table><thead><tr><th>Periodo</th><th class="num">Spese</th><th class="num">Km camper</th><th class="num">Allenamenti</th><th class="num">Km allenamento</th><th class="num">Calorie</th><th class="num">❤️ medio</th></tr></thead>
      <tbody>${periods.map(p => `<tr><td>${fmtP(p)}</td><td class="num"><b>${eur(spentBy[p])}</b></td><td class="num">${num(kmBy[p] || 0, 0)}</td><td class="num">${woBy[p]?.n || 0}</td><td class="num">${num(woBy[p]?.km || 0)}</td><td class="num">${num(woBy[p]?.calories || 0, 0)}</td><td class="num">${woBy[p]?.hr_avg || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nessun dato</td></tr>'}</tbody></table></div></div>`);
  $$('.chip').forEach(c => c.onclick = () => { state.period = c.dataset.p; render(); });
  if ($('#go')) $('#go').onclick = () => { state.period = 'custom'; state.from = $('#from').value; state.to = $('#to').value; state.group = $('#group').value; render(); };
  // Col viaggio scelto non c'e' un «Applica» da premere: il raggruppamento si
  // cambia e il disegno si rifa'
  if (viaggio) $('#group').onchange = e => { state.group = e.target.value; render(); };
  if ($('#f-atleta')) $('#f-atleta').onchange = e => { state.atleta = e.target.value ? +e.target.value : null; render(); };
  $('#f-viaggio').onchange = e => { state.viaggio = e.target.value ? +e.target.value : null; state.period = 'custom'; render(); };
}

// ---------- Impostazioni ----------
async function viewSettings() {
  const v = settings.vehicle || {};
  const devices = await api('/auth/devices');
  const k = await api('/komoot');
  const st = await api('/strava');
  // Messaggio di ritorno dal giro su Strava, poi ripuliamo l'indirizzo
  const esitoStrava = (location.hash.match(/[?&]strava=([^&]+)/) || [])[1];
  if (esitoStrava) {
    const messaggi = { collegato: ['Strava collegato', false], negato: ['Autorizzazione negata su Strava', true], 'stato-non-valido': ['Richiesta non valida, riprova', true], errore: ['Collegamento a Strava fallito', true] };
    const [testo, err] = messaggi[decodeURIComponent(esitoStrava)] || ['Esito sconosciuto', true];
    toast(testo, err);
    history.replaceState(null, '', '#/impostazioni');
  }
  const adm = user.role === 'admin' ? await api('/auth/users') : null;
  const condivisioni = adm ? await api('/shares') : null;
  const rubrica = adm ? await api('/rubrica') : null;
  const endpoint = location.origin + '/api/ingest/health';
  $('#app').innerHTML = layout(`<h1 style="margin-bottom:12px">Impostazioni</h1>
    <div class="grid cols-2">
    <div class="card"><h2>🚐 Camper</h2><form id="veh" class="form-grid" style="margin-top:12px"><div><label class="f">Lunghezza (m)</label><input type="number" step="0.1" name="length_m" value="${v.length_m ?? 6}"></div><div><label class="f">Consumo (km/l)</label><input type="number" step="0.1" name="km_per_liter" value="${v.km_per_liter ?? 10}"></div><div><label class="f">Prezzo gasolio predefinito (€/l)</label><input type="number" step="0.001" name="fuel_price" value="${v.fuel_price ?? 1.75}"></div><div><label class="f">Pedaggio stimato (€/km)</label><input type="number" step="0.001" name="toll_per_km" value="${v.toll_per_km ?? 0.09}" title="In Italia un camper sta in classe B: circa nove centesimi al chilometro"></div><div><label class="f">Casa</label><input name="casa" value="${esc(settings.casa || 'Susegana')}" title="Intorno a casa non si cercano aree sosta"></div><div style="align-self:end"><button class="btn primary" style="width:100%">Salva</button></div></form>
      <p class="small muted" style="margin:10px 0 0">Il prezzo si può cambiare per ogni viaggio e per ogni singola tappa. Le spese gasolio si ricalcolano finché non le modifichi a mano.</p></div>
    <div class="card"><h2>🗺️ Komoot</h2>${k.connected ? `<p>Collegato (utente ${esc(k.external_user_id)})${k.last_sync_at ? ' · ultima sincronizzazione ' + fdt(k.last_sync_at) : ''}. I tour registrati vengono scaricati ogni 6 ore e quando premi «Sincronizza».</p><div class="row"><button class="btn" id="ksync">Sincronizza ora</button><button class="btn" id="kfull">Importa tutto lo storico</button><button class="btn ghost danger" id="kdel">Scollega</button></div>`
      : `<p class="small muted">Komoot non ha un'API pubblica: la dashboard usa lo stesso accesso del sito. La password serve solo una volta per ottenere un token, che viene salvato cifrato; la password non viene mai memorizzata.</p><form id="kf" class="stack"><input name="email" type="email" placeholder="Email Komoot" required autocomplete="off"><input name="password" type="password" placeholder="Password Komoot" required autocomplete="off"><button class="btn primary">Collega Komoot</button></form>`}</div>

    <div class="card" style="margin-top:14px"><h2>🟠 Strava</h2>${!st.configurato
      ? `<p class="small muted">Per collegare Strava servono le credenziali dell\u2019applicazione. Crea un\u2019applicazione su <span class="code">strava.com/settings/api</span>, indica come dominio di richiamo <span class="code">${location.host}</span>, poi imposta su Railway le variabili <span class="code">STRAVA_CLIENT_ID</span> e <span class="code">STRAVA_CLIENT_SECRET</span>. Al riavvio il pulsante di collegamento comparir\u00e0 qui.</p>`
      : st.connected
        ? `<p>Collegato (atleta ${esc(st.external_user_id)})${st.last_sync_at ? ' · ultima sincronizzazione ' + fdt(st.last_sync_at) : ''}. Le attivit\u00e0 vengono scaricate ogni 6 ore e quando premi «Sincronizza».</p>
           <div class="row"><button class="btn" id="ssync">Sincronizza ora</button><button class="btn" id="sfull">Importa tutto lo storico</button><button class="btn ghost danger" id="sdel">Scollega</button></div>`
        : `<p class="small muted">Verrai portato su Strava per autorizzare la dashboard in sola lettura. Non viene memorizzata alcuna password: solo i token, cifrati, rinnovati da soli.</p>
           <a class="btn primary" href="/api/strava/connect">Collega Strava</a>`}</div>
    </div>
    <div class="card" style="margin-top:14px"><div class="row between"><h2>📱 iPhone e Apple Watch</h2><button class="btn primary sm" id="adddev">＋ Aggiungi dispositivo</button></div>
      <p class="small muted">Ogni iPhone riceve un token personale con cui invia allenamenti (battito, calorie, distanza) a questa dashboard. I dati restano solo qui, sul tuo server. ${user.role === 'admin' ? 'I dispositivi degli altri utenti vanno approvati da te.' : 'Il dispositivo deve essere approvato dall\'amministratore.'}</p>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Utente</th><th>Token</th><th>Stato</th><th>Ultimo invio</th><th></th></tr></thead><tbody>${devices.map(d => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.owner)}</td><td class="small muted">${esc(d.token_hint)}</td><td>${d.approved ? '<span class="badge ok">autorizzato</span>' : '<span class="badge warn">in attesa</span>'}</td><td class="small">${d.last_seen_at ? fdt(d.last_seen_at) : '—'}</td>
        <td class="num">${user.role === 'admin' && !d.approved ? `<button class="btn sm" data-appr="${d.id}">Autorizza</button>` : ''}<button class="btn sm ghost danger" data-deldev="${d.id}">Revoca</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessun dispositivo</td></tr>'}</tbody></table></div>
      <details style="margin-top:12px"><summary>Come configurare l'iPhone</summary><div class="stack small" style="margin-top:8px">
        <div><b>Opzione A – Health Auto Export</b> (app App Store, la più completa): crea un'automazione «REST API», metodo POST, URL <span class="code">${endpoint}</span>, header <span class="code">Authorization: Bearer &lt;token&gt;</span>, tipo di dati «Workouts», formato JSON, e imposta la frequenza (es. ogni ora). Includi «Route» se vuoi anche il GPS.</div>
        <div><b>Opzione B – Comandi Rapidi</b> (gratis): un comando «Trova allenamenti» (ultimi 7 giorni) → per ogni allenamento «Ottieni contenuti di URL» POST a <span class="code">${endpoint}</span> con header Authorization e corpo JSON: <span class="code">{"start": "…", "type": "…", "duration_min": …, "distance_km": …, "calories": …, "hr_avg": …}</span>. Aggiungilo a un'automazione «Fine allenamento».</div>
        <div>Gli allenamenti senza GPS che iniziano entro 15 minuti da un tour Komoot vengono uniti a quel tour: così il percorso Komoot acquista battito e calorie.</div></div></details></div>
    <div class="card" style="margin-top:14px"><h2>🔑 La mia password</h2>
      <form id="pwd" class="row" style="margin-top:12px">
        <div class="field w-md"><label class="f">Password attuale</label><input type="password" name="attuale" required autocomplete="current-password"></div>
        <div class="field w-md"><label class="f">Nuova password</label><input type="password" name="nuova" minlength="8" required autocomplete="new-password"></div>
        <div class="field" style="align-self:flex-end"><button class="btn primary">Cambia</button></div>
      </form>
      <div class="small muted" style="margin-top:8px">Almeno 8 caratteri. Viene chiesta anche quella attuale: cos\u00ec una sessione lasciata aperta non basta per prenderti l\u2019account.</div>
    </div>
    ${adm ? `<div class="card" style="margin-top:14px"><div class="row between"><h2>👥 Utenti</h2><button class="btn primary sm" id="inv">＋ Codice invito</button></div>
      <p class="small muted">Chi si registra con un codice invito entra in attesa finché non lo autorizzi. Ogni utente vede i viaggi condivisi e i propri allenamenti.</p>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Stato</th><th></th></tr></thead><tbody>${adm.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td class="small">${esc(u.email)}</td><td>${u.role}</td><td>${u.approved ? '<span class="badge ok">autorizzato</span>' : '<span class="badge warn">in attesa</span>'}</td><td class="num">${u.id !== user.id ? `<button class="btn sm" data-uappr="${u.id}" data-v="${!u.approved}">${u.approved ? 'Sospendi' : 'Autorizza'}</button><button class="btn sm" data-upwd="${u.id}" data-uname="${esc(u.name)}">Reimposta password</button><button class="btn sm ghost danger" data-udel="${u.id}">Elimina</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${adm.invites.filter(i => !i.used_by && new Date(i.expires_at) > Date.now()).length ? `<div class="small" style="margin-top:10px">Inviti attivi: ${adm.invites.filter(i => !i.used_by && new Date(i.expires_at) > Date.now()).map(i => `<span class="code">${i.code}</span>`).join(' ')}</div>` : ''}</div>` : ''}
    ${rubrica ? `<div class="card" style="margin-top:14px"><div class="row between"><h2>\ud83d\udcd2 Rubrica</h2><button class="btn primary sm" id="newcontatto">\uff0b Numero</button></div>
      <p class="small muted">Un link si puo\u2019 mandare solo a un numero scritto qui. Un numero sbagliato di una cifra e\u2019 un viaggio di famiglia finito a uno sconosciuto, e un indirizzo mandato non si richiama indietro: prima si scrive chi e\u2019, poi gli si manda qualcosa. Togliendo qualcuno dalla rubrica, i suoi link si spengono.</p>
      <div class="table-wrap"><table><thead><tr><th>Chi \u00e8</th><th>Numero</th><th>Nota</th><th>Link</th><th></th></tr></thead><tbody>${rubrica.map(c => `<tr>
        <td><b>${esc(c.nick)}</b></td><td class="nowrap">${esc(c.telefono)}</td><td class="small muted">${esc(c.note || '')}</td>
        <td class="small">${c.link_attivi ? `<span class="badge ok">${c.link_attivi} attiv${c.link_attivi === 1 ? 'o' : 'i'}</span>` : c.link ? `<span class="muted">${c.link} spent${c.link === 1 ? 'o' : 'i'}</span>` : '<span class="muted">\u2014</span>'}</td>
        <td class="num nowrap"><button class="btn sm ghost icon" data-mod-contatto="${c.id}" title="Modifica">\u270f\ufe0f</button><button class="btn sm ghost danger icon" data-del-contatto="${c.id}" title="Togli dalla rubrica">\ud83d\uddd1</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Rubrica vuota. Aggiungi il numero di chi deve poter guardare i viaggi: finch\u00e9 non \u00e8 qui, non gli si pu\u00f2 mandare niente.</td></tr>'}</tbody></table></div></div>` : ''}
    ${condivisioni ? (() => {
      const nomeAtleta = id => (condivisioni.atleti.find(a => a.id === +id) || {}).name || '?';
      // Cosa apre un link, detto in una riga: e' quello che si rilegge fra sei
      // mesi per decidere se quel link puo' restare acceso
      const riassunto = x => [
        !x.viaggi ? 'tutti i viaggi' : `${x.viaggi.length} viagg${x.viaggi.length === 1 ? 'io' : 'i'}`,
        x.tracciati ? 'percorsi da rivedere' : null,
        x.foto ? 'foto e video' : 'senza foto',
        x.spese ? 'con le spese' : null,
        (x.allenamenti || []).length ? 'allenamenti di ' + x.allenamenti.map(nomeAtleta).join(' e ') : null,
      ].filter(Boolean).join(' \u00b7 ');
      const stato = x => x.revoked_at ? '<span class="badge warn">spento</span>'
        : x.expires_at && new Date(x.expires_at) < Date.now() ? '<span class="badge warn">scaduto</span>'
        : '<span class="badge ok">attivo</span>';
      return `<div class="card" style="margin-top:14px"><div class="row between"><h2>\ud83d\udd17 Link di sola lettura</h2><button class="btn primary sm" id="newshare">\uff0b Nuovo link</button></div>
      <p class="small muted">Un indirizzo da mandare a chi deve solo guardare: niente registrazione, niente password, e vede soltanto quello che spunti tu. Si spegne quando vuoi, anche dopo averlo mandato.</p>
      <div class="table-wrap"><table><thead><tr><th>Per chi</th><th>Cosa apre</th><th>Scadenza</th><th>Aperture</th><th></th></tr></thead><tbody>${condivisioni.shares.map(x => `<tr>
        <td><b>${esc(x.contatto_nick || x.nome || 'Senza nome')}</b>${x.contatto_telefono ? `<div class="small muted">${esc(x.contatto_telefono)}</div>` : ''}
          <div class="small muted">${stato(x)} \u00b7 ${x.inviato_at ? 'mandato ' + fdate(x.inviato_at) : 'creato ' + fdate(x.created_at)}</div></td>
        <td class="small">${esc(riassunto(x))}</td>
        <td class="small">${x.expires_at ? fdate(x.expires_at) : 'nessuna'}</td>
        <td class="small">${x.viste || 0}${x.ultima_vista ? `<div class="muted">${fdt(x.ultima_vista)}</div>` : ''}</td>
        <td class="num nowrap">${x.contatto_telefono && !x.revoked_at ? `<button class="btn sm" data-manda-link="${x.id}" data-come="whatsapp" data-tel="${esc(x.contatto_telefono)}" data-nick="${esc(x.contatto_nick || '')}" data-token="${esc(x.token)}" title="Mandaglielo su WhatsApp">\ud83d\udcf1 WhatsApp</button><button class="btn sm" data-manda-link="${x.id}" data-come="messaggi" data-tel="${esc(x.contatto_telefono)}" data-nick="${esc(x.contatto_nick || '')}" data-token="${esc(x.token)}" title="Mandaglielo con Messaggi">\ud83d\udcac Messaggi</button>` : ''}<button class="btn sm" data-copia-link="${esc(x.token)}" title="Copia l\u2019indirizzo da mandare">\ud83d\udccb Copia</button>
          <button class="btn sm ghost" data-spegni-link="${x.id}" data-acceso="${x.revoked_at ? 0 : 1}">${x.revoked_at ? 'Riaccendi' : 'Spegni'}</button>
          <button class="btn sm ghost danger" data-elimina-link="${x.id}" title="Elimina">\ud83d\uddd1</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nessun link. Creane uno per far vedere un viaggio a chi non ha un posto qui dentro.</td></tr>'}</tbody></table></div></div>`;
    })() : ''}
    <div class="card small muted" style="margin-top:14px">Dati mappa © OpenStreetMap · percorsi OSRM · aree sosta da OpenStreetMap (Overpass). <a href="#" data-logout>Esci</a></div>`);
  $('#veh').onsubmit = safe(async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    // La casa non e' un dato del mezzo: viaggia per conto suo
    const { casa, ...mezzo } = d;
    settings.vehicle = await api('/settings/vehicle', { method: 'PUT', body: mezzo });
    settings.casa = (await api('/settings/casa', { method: 'PUT', body: { casa } })).casa;
    toast('Salvato');
  });
  $('#ssync')?.addEventListener('click', safe(async () => { toast('Sincronizzazione\u2026'); const r = await api('/strava/sync', { method: 'POST', body: {} }); toast(`Importate ${r.imported} attivit\u00e0`); render(); }));
  $('#sfull')?.addEventListener('click', safe(async () => { toast('Importazione storico\u2026 pu\u00f2 richiedere un minuto'); const r = await api('/strava/sync', { method: 'POST', body: { full: true } }); toast(`Importate ${r.imported} attivit\u00e0`); render(); }));
  $('#sdel')?.addEventListener('click', safe(async () => { if (await confirmDlg('Scollegare Strava? Gli allenamenti gi\u00e0 importati restano.')) { await api('/strava', { method: 'DELETE' }); toast('Strava scollegato'); render(); } }));
  $('#kf')?.addEventListener('submit', safe(async e => { e.preventDefault(); toast('Collegamento…'); const r = await api('/komoot/connect', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Komoot collegato' + (r.displayName ? ' come ' + r.displayName : '')); render(); }));
  $('#ksync')?.addEventListener('click', safe(async () => { toast('Sincronizzazione…'); const r = await api('/komoot/sync', { method: 'POST', body: {} }); toast(`Importati ${r.imported} tour`); render(); }));
  $('#kfull')?.addEventListener('click', safe(async () => { toast('Importazione storico… può richiedere un minuto'); const r = await api('/komoot/sync', { method: 'POST', body: { full: true } }); toast(`Importati ${r.imported} tour`); render(); }));
  $('#kdel')?.addEventListener('click', safe(async () => { if (await confirmDlg('Scollegare Komoot?')) { await api('/komoot', { method: 'DELETE' }); render(); } }));
  $('#adddev').onclick = () => {
    // Il dispositivo appartiene a un atleta: i suoi invii finiscono in quella
    // sezione. Chi amministra puo' quindi preparare il token anche per gli altri
    const altri = (adm?.users || []).filter(u => u.approved);
    const scelta = altri.length > 1
      ? `<label class="small muted">Allenamenti di<select name="user_id">${altri.map(u => `<option value="${u.id}"${u.id === user.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>`
      : '';
    modal(`<h2>Nuovo dispositivo</h2><form id="f" class="stack" style="margin-top:12px"><input name="name" placeholder="Es. iPhone di Andrea" required>${scelta}<button class="btn primary">Genera token</button></form>`, (el, close) => $('#f', el).onsubmit = safe(async e => {
    e.preventDefault(); const r = await api('/auth/devices', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); close();
    modal(`<h2>Token per «${esc(r.name)}»</h2><p class="small">Allenamenti di <b>${esc(r.owner)}</b>. Copialo ora: non sarà più visibile.${r.approved ? '' : ' Deve ancora essere autorizzato dall\'amministratore.'}</p><div class="code">${r.token}</div><p class="small muted" style="margin-top:8px">Endpoint: <span class="code">${esc(r.endpoint)}</span></p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="cp">Copia</button><button class="btn primary" data-x>Fatto</button></div>`,
      (el2, close2) => { $('#cp', el2).onclick = () => { navigator.clipboard?.writeText(r.token); toast('Copiato'); }; $('[data-x]', el2).onclick = () => { close2(); render(); }; });
  }));
  };
  // ---- la rubrica ----
  const contattoForm = (c = null) => modal(`<h2>${c ? 'Modifica il contatto' : '\ud83d\udcd2 Nuovo numero in rubrica'}</h2>
    <form id="f" class="stack" style="margin-top:12px">
      <div><label class="f">Chi \u00e8</label><input name="nick" maxlength="60" required placeholder="Es. Nonna Lucia" value="${esc(c?.nick || '')}"></div>
      <div><label class="f">Numero di telefono</label><input name="telefono" required placeholder="Es. 333 1234567" value="${esc(c?.telefono || '')}">
        <div class="small muted">Senza prefisso si intende l\u2019Italia. Il numero serve a mandare il link su WhatsApp: non esce da qui.</div></div>
      <div><label class="f">Nota (facoltativa)</label><input name="note" maxlength="200" placeholder="Es. mamma di Cate" value="${esc(c?.note || '')}"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">${c ? 'Salva' : 'Aggiungi'}</button></div>
    </form>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    $('#f', el).onsubmit = safe(async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      await api(c ? '/rubrica/' + c.id : '/rubrica', { method: c ? 'PUT' : 'POST', body });
      close(); toast(c ? 'Contatto aggiornato' : 'Numero in rubrica'); render();
    });
  });
  $('#newcontatto')?.addEventListener('click', () => contattoForm());
  $$('[data-mod-contatto]').forEach(b => b.onclick = () => contattoForm(rubrica.find(c => c.id === +b.dataset.modContatto)));
  $$('[data-del-contatto]').forEach(b => b.onclick = safe(async () => {
    const c = rubrica.find(x => x.id === +b.dataset.delContatto);
    if (!await confirmDlg(`Togliere ${c.nick} dalla rubrica?${c.link_attivi ? ` I suoi ${c.link_attivi} link si spengono subito.` : ''}`)) return;
    const r = await api('/rubrica/' + c.id, { method: 'DELETE' });
    toast(r.spenti ? `Tolto dalla rubrica \u00b7 ${r.spenti} link spenti` : 'Tolto dalla rubrica');
    render();
  }));

  // ---- i link di sola lettura ----
  const indirizzoLink = t => `${location.origin}/v/${t}`;
  // Il messaggio con cui parte un link: due righe, il nome di chi lo riceve e
  // l'indirizzo. WhatsApp si apre gia' scritto, mandarlo resta a te.
  const messaggio = (nick, url) => `Ciao${nick ? ' ' + nick : ''}! Qui ci sono i nostri viaggi in camper, da guardare quando vuoi: ${url}`;
  const suWhatsapp = (tel, nick, url) => `https://wa.me/${String(tel).replace(/\D/g, '')}?text=${encodeURIComponent(messaggio(nick, url))}`;
  // Messaggi di Apple vuole la e commerciale prima del testo, Android il punto
  // interrogativo: scritto nell'altro modo, il messaggio si apre vuoto
  const suMessaggi = (tel, nick, url) => `sms:${tel}${/iPhone|iPad|iPod|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(messaggio(nick, url))}`;
  $$('[data-manda-link]').forEach(b => b.onclick = safe(async () => {
    const url = indirizzoLink(b.dataset.token);
    const dove = b.dataset.come === 'messaggi'
      ? suMessaggi(b.dataset.tel, b.dataset.nick, url)
      : suWhatsapp(b.dataset.tel, b.dataset.nick, url);
    // Messaggi non e' una pagina: aprirlo in una scheda nuova lascia in giro
    // una finestra vuota, e su iPhone a volte non apre affatto
    if (b.dataset.come === 'messaggi') location.href = dove;
    else window.open(dove, '_blank', 'noopener');
    await api(`/shares/${b.dataset.mandaLink}/inviato`, { method: 'POST', body: {} }).catch(() => {});
  }));
  $$('[data-copia-link]').forEach(b => b.onclick = safe(async () => {
    const url = indirizzoLink(b.dataset.copiaLink);
    try { await navigator.clipboard.writeText(url); toast('Indirizzo copiato'); }
    catch { modal(`<h2>L\u2019indirizzo da mandare</h2><div class="code" style="word-break:break-all">${esc(url)}</div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-x>Fatto</button></div>`, (el, close) => $('[data-x]', el).onclick = close); }
  }));
  $$('[data-spegni-link]').forEach(b => b.onclick = safe(async () => {
    const acceso = b.dataset.acceso === '1';
    if (acceso && !await confirmDlg('Spegnere questo link? Da subito non apre piu\u2019 niente, nemmeno a chi ce l\u2019ha gi\u00e0.')) return;
    await api(`/shares/${b.dataset.spegniLink}/revoca`, { method: 'POST', body: { riacceso: !acceso } });
    toast(acceso ? 'Link spento' : 'Link riacceso');
    render();
  }));
  $$('[data-elimina-link]').forEach(b => b.onclick = safe(async () => {
    if (!await confirmDlg('Eliminare questo link? Chi ce l\u2019ha non vedr\u00e0 piu\u2019 niente.')) return;
    await api('/shares/' + b.dataset.eliminaLink, { method: 'DELETE' });
    render();
  }));
  $('#newshare')?.addEventListener('click', () => {
    const viaggi = condivisioni.viaggi, atleti = condivisioni.atleti;
    modal(`<h2>\ud83d\udd17 Nuovo link di sola lettura</h2>
      <form id="f" class="stack" style="margin-top:12px">
        <div><label class="f">Per chi \u00e8 (serve solo a te, per ricordartelo)</label><input name="nome" maxlength="80" placeholder="Es. I nonni"></div>
        <div><label class="f">Quali viaggi</label>
          <label class="scelta"><input type="checkbox" id="tutti-viaggi" checked> <span><b>Tutti</b> <span class="small muted">\u2014 anche quelli che farete poi. Restano fuori quelli in costruzione.</span></span></label>
          <div id="lista-viaggi" class="lista-scelte" hidden>${viaggi.map(t => `<label class="scelta"><input type="checkbox" name="viaggi" value="${t.id}"> <span>${esc(t.title)}${t.start_date ? ` <span class="small muted">${fdate(t.start_date)}</span>` : ''}${t.status === 'bozza' ? ' <span class="badge">in costruzione</span>' : ''}</span></label>`).join('')}</div></div>
        <div><label class="f">Cosa pu\u00f2 vedere</label>
          <label class="scelta"><input type="checkbox" name="tracciati" checked> <span>I percorsi da rivedere sulla mappa</span></label>
          <label class="scelta"><input type="checkbox" name="foto" checked> <span>Le foto e i video</span></label>
          <label class="scelta"><input type="checkbox" name="spese"> <span>Le spese, i totali e i biglietti</span></label></div>
        <div><label class="f">Allenamenti</label>
          ${atleti.map(a => `<label class="scelta"><input type="checkbox" name="allenamenti" value="${a.id}"> <span>Quelli di ${esc(a.name)}</span></label>`).join('')}
          <div class="small muted">Senza spunte, degli allenamenti non vede niente.</div></div>
        <div><label class="f">A chi lo mandi</label>
          ${rubrica.length ? `<div class="lista-scelte">${rubrica.map(c => `<label class="scelta"><input type="checkbox" name="contatti" value="${c.id}"> <span>${esc(c.nick)} <span class="small muted">${esc(c.telefono)}</span></span></label>`).join('')}</div>
            <div class="small muted">Ognuno riceve il suo indirizzo: cos\u00ec vedi chi apre, e puoi spegnere quello di uno senza togliere niente agli altri. Senza spunte viene creato un indirizzo solo, da copiare a mano.</div>`
            : '<div class="small muted">La rubrica \u00e8 vuota: aggiungi un numero l\u00ec sopra per poter mandare il link. Senza, viene creato solo un indirizzo da copiare a mano.</div>'}</div>
        <div><label class="f">Scadenza</label><select name="giorni"><option value="">Nessuna, finch\u00e9 non lo spengo</option><option value="7">7 giorni</option><option value="15" selected>15 giorni</option><option value="30">30 giorni</option><option value="90">3 mesi</option><option value="365">1 anno</option></select></div>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Crea il link</button></div>
      </form>`, (el, close) => {
      $('[data-x]', el).onclick = close;
      const tutti = $('#tutti-viaggi', el);
      tutti.onchange = () => { $('#lista-viaggi', el).hidden = tutti.checked; };
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const r = await api('/shares', { method: 'POST', body: {
          nome: fd.get('nome'),
          viaggi: tutti.checked ? [] : fd.getAll('viaggi').map(Number),
          tracciati: fd.get('tracciati') === 'on',
          foto: fd.get('foto') === 'on',
          spese: fd.get('spese') === 'on',
          allenamenti: fd.getAll('allenamenti').map(Number),
          contatti: fd.getAll('contatti').map(Number),
          giorni: fd.get('giorni') || null,
        } });
        close();
        const fatti = r.links.map(x => ({ ...x, url: indirizzoLink(x.token) }));
        modal(`<h2>${fatti.length === 1 ? 'Il link \u00e8 pronto' : `Pronti ${fatti.length} link`}</h2>
          <p class="small muted">Chi lo apre non deve registrarsi n\u00e9 installare niente. WhatsApp e Messaggi si aprono gi\u00e0 scritti: mandarlo resta a te.</p>
          <div class="list">${fatti.map(x => `<div class="item"><div class="item-main" style="cursor:default"><div class="grow">
            <div class="title">${esc(x.contatto_nick || 'Indirizzo da copiare')}${x.contatto_telefono ? ` <span class="small muted">${esc(x.contatto_telefono)}</span>` : ''}</div>
            <div class="meta code" style="word-break:break-all">${esc(x.url)}</div></div></div>
            <div class="item-actions">${x.contatto_telefono ? `<a class="btn sm primary" target="_blank" rel="noopener" href="${esc(suWhatsapp(x.contatto_telefono, x.contatto_nick, x.url))}" data-inviato="${x.id}">\ud83d\udcf1 WhatsApp</a>
              <a class="btn sm" href="${esc(suMessaggi(x.contatto_telefono, x.contatto_nick, x.url))}" data-inviato="${x.id}">\ud83d\udcac Messaggi</a>` : ''}
              <button class="btn sm ghost icon" data-cp="${esc(x.url)}" title="Copia l\u2019indirizzo">\ud83d\udccb</button></div></div>`).join('')}</div>
          <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-x>Fatto</button></div>`,
          (el2, close2) => {
            $$('[data-cp]', el2).forEach(b2 => b2.onclick = () => { navigator.clipboard?.writeText(b2.dataset.cp); toast('Copiato'); });
            $$('[data-inviato]', el2).forEach(a2 => a2.addEventListener('click', () => {
              api(`/shares/${a2.dataset.inviato}/inviato`, { method: 'POST', body: {} }).catch(() => {});
            }));
            $('[data-x]', el2).onclick = () => { close2(); render(); };
          });
      });
    });
  });

  $('#pwd')?.addEventListener('submit', safe(async e => {
    e.preventDefault();
    await api('/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast('Password cambiata');
  }));
  document.body.onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.upwd) {
      if (!await confirmDlg(`Reimpostare la password di ${b.dataset.uname}? Quella attuale smetter\u00e0 di funzionare.`)) return;
      const r = await api(`/auth/users/${b.dataset.upwd}/password`, { method: 'POST', body: {} });
      modal(`<h2>Password provvisoria per \u00ab${esc(r.name)}\u00bb</h2>
        <p class="small">Copiala ora: non sar\u00e0 pi\u00f9 visibile. Consegnagliela di persona, e falla cambiare da \u00abLa mia password\u00bb al primo accesso.</p>
        <div class="code" style="font-size:20px;text-align:center">${esc(r.password)}</div>
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="cp2">Copia</button><button class="btn primary" data-x>Fatto</button></div>`,
        (el, close) => { $('#cp2', el).onclick = () => { navigator.clipboard?.writeText(r.password); toast('Copiata'); }; $('[data-x]', el).onclick = close; });
      return;
    }
    if (b.dataset.appr) { await api(`/auth/devices/${b.dataset.appr}/approve`, { method: 'POST', body: {} }); render(); }
    if (b.dataset.deldev && await confirmDlg('Revocare il dispositivo?')) { await api('/auth/devices/' + b.dataset.deldev, { method: 'DELETE' }); render(); }
    if (b.dataset.uappr) { await api(`/auth/users/${b.dataset.uappr}/approve`, { method: 'POST', body: { approved: b.dataset.v === 'true' } }); render(); }
    if (b.dataset.udel && await confirmDlg('Eliminare l\'utente e i suoi dati?')) { await api('/auth/users/' + b.dataset.udel, { method: 'DELETE' }); render(); }
    if (b.id === 'inv') { const r = await api('/auth/invites', { method: 'POST', body: {} }); modal(`<h2>Codice invito</h2><p class="small">Valido 7 giorni, monouso. Chi lo usa dovrà poi essere autorizzato.</p><div class="code" style="font-size:24px;text-align:center">${r.code}</div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-x>Ok</button></div>`, (el, close) => $('[data-x]', el).onclick = () => { close(); render(); }); }
  });
}

// ---------- Router ----------
async function render(opzioni = {}) {
  document.body.onclick = null;
  const eraA = window.scrollY;
  try {
    if (!user) {
      const me = await api('/auth/me');
      if (me.user?.approved) {
        let valute;
        [settings, atleti, valute] = await Promise.all([api('/settings'), api('/athletes'), api('/valute').catch(() => null)]);
        user = me.user;
        if (valute) VALUTE = Object.fromEntries(Object.entries(valute).map(([c, v]) => [c, `${v.segno} ${v.nome}`]));
        // Una riga sola per ogni apertura, con la versione del codice che sta
        // girando davvero: senza, davanti a un guasto non si sa nemmeno se chi
        // lo vede ha in mano l'ultima correzione o quella di ieri
        segnala('avvio', VERSIONE);
      } else return viewAuth(me.setup);
    }
    const h = location.hash || '#/';
    const m = h.match(/^#\/(trip|allenamenti|allenamento)\/?(\d+)?/);
    if (m?.[1] === 'trip' && m[2]) await viewTrip(m[2]);
    else if (m?.[1] === 'allenamento' && m[2]) await viewWorkout(m[2]);
    else if (m?.[1] === 'allenamenti') await viewWorkouts(m[2] ? +m[2] : user.id);
    else if (h.startsWith('#/cruscotto')) await viewDashboard();
    else if (h.startsWith('#/riepiloghi')) await viewSummary();
    else if (h.startsWith('#/impostazioni')) await viewSettings();
    else await viewTrips();
    window.scrollTo(0, opzioni?.mantieniPosizione ? eraA : 0);
    segnaStato();                       // quello che cambi tu non e' una novita' in arrivo
  } catch (e) { $('#app').innerHTML = `<div class="loading">⚠️ ${esc(e.message)}<br><button class="btn" onclick="location.reload()">Ricarica</button></div>`; }
}
// Una tendina e' un <details>: da sola si chiude solo ricliccando il suo pulsante.
// Qui la chiudiamo anche al clic fuori e con Esc, come ci si aspetta da un menu.
// Il gestore sta sul documento, quindi sopravvive ai ridisegni della pagina; la
// chiusura fa scattare l'evento toggle, che riporta a posto lo stato ricordato.
const chiudiTendine = tranne => $$('details.tendina[open]').forEach(d => { if (d !== tranne && !d.contains(tranne)) d.open = false; });
document.addEventListener('click', e => { chiudiTendine(e.target); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') chiudiTendine(null); });

// La pagina si aggiorna da sola. Non ridisegna a intervalli fissi — sprecherebbe
// lavoro e farebbe saltare via lo scorrimento — ma chiede al server un'impronta
// di cio' che esiste e si ridisegna solo se e' cambiata. Chi sta compilando un
// campo o ha una finestra aperta non viene interrotto: l'aggiornamento aspetta.
let improntaStato = null, contiPrecedenti = null;
const leggiStato = () => api('/stato').catch(() => null);        // rete giu': si riprova dopo
// Il riferimento si prende appena la pagina e' disegnata, non al primo controllo:
// altrimenti cio' che arriva nel frattempo verrebbe assorbito senza ridisegnare
async function segnaStato() {
  const s = await leggiStato();
  if (s) { improntaStato = JSON.stringify(s); contiPrecedenti = s; }
}
async function guardaSeCambiato() {
  if (!user || document.hidden) return;
  if ($('.modal-bg')) return;                                   // c'e' una finestra aperta
  if ($('.barra-selezione:not([hidden])')) return;              // sta scegliendo delle voci
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select')) return;        // sta scrivendo
  const stato = await leggiStato();
  if (!stato) return;
  const impronta = JSON.stringify(stato);
  if (improntaStato === null) { improntaStato = impronta; contiPrecedenti = stato; return; }
  if (impronta === improntaStato) return;
  const nuoviAllenamenti = stato.allenamenti - (contiPrecedenti?.allenamenti ?? stato.allenamenti);
  const nuovePesate = stato.pesate - (contiPrecedenti?.pesate ?? stato.pesate);
  improntaStato = impronta; contiPrecedenti = stato;
  await render({ mantieniPosizione: true });
  if (nuoviAllenamenti > 0) toast(nuoviAllenamenti === 1 ? 'Arrivato un allenamento nuovo' : `Arrivati ${nuoviAllenamenti} allenamenti nuovi`);
  else if (nuovePesate > 0) toast(nuovePesate === 1 ? 'Arrivata una pesata nuova' : `Arrivate ${nuovePesate} pesate nuove`);
}
// Dopo aver salvato o tolto qualcosa, la pagina si rifa' ma lo sguardo resta
// dov'era: chi ha appena scritto una spesa vuole rivedere le spese, non la mappa
// del viaggio che sta in cima.
const restaQui = () => render({ mantieniPosizione: true });

setInterval(guardaSeCambiato, 45000);
// Tornando sulla scheda si controlla subito: e' il momento in cui si guarda
document.addEventListener('visibilitychange', () => { if (!document.hidden) guardaSeCambiato(); });
window.addEventListener('focus', guardaSeCambiato);

// Le date di un viaggio si toccano dovunque compaiano — elenco, intestazione,
// cruscotto — e fanno sempre la stessa cosa. Dentro una riga che e' un
// collegamento, il tocco resta alle date e non apre il viaggio.
document.addEventListener('click', e => {
  const d = e.target.closest('[data-date]');
  if (!d) return;
  e.preventDefault(); e.stopPropagation();
  dateForm({ id: +d.dataset.date, start_date: d.dataset.da || null, end_date: d.dataset.a || null }, render);
});

// Un file trascinato sulla pagina, il browser lo aprirebbe al posto della
// dashboard: il viaggio sparisce e al suo posto resta la foto, o un errore suo
// che non spiega niente. Qui il trascinamento lo prende la pagina intera, non
// un riquadro da centrare: le foto cadono dove capita e finiscono nel viaggio
// aperto.
const veloFoto = document.createElement('div');
veloFoto.className = 'velo-pagina';
veloFoto.innerHTML = '<div><b></b><span></span></div>';
// Un file trascinato che la pagina non ferma, il browser lo apre: la dashboard
// sparisce e al suo posto resta la foto, o un errore suo che non spiega niente.
// Quindi lo ferma sempre, dovunque cada — anche sopra il pulsante «Carica», che
// e' proprio dove uno punta, e che da solo non saprebbe prenderlo: il campo che
// riceve i file li' sotto e' nascosto, e un campo nascosto i file non li piglia.
// L'unica eccezione e' un campo file in vista, che sa gia' fare da se'.
const conFile = e => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return false;
  const campo = e.target?.closest?.('input[type=file]');
  return !(campo && !campo.hidden && campo.offsetParent !== null);
};
const viaggioAperto = () => { const m = (location.hash || '').match(/^#\/trip\/(\d+)/); return m ? +m[1] : null; };
// Il velo non si conta le entrate e le uscite: un trascinamento che esce dalla
// finestra senza salutare lascerebbe il conto sbilanciato e il velo o sempre
// acceso o mai piu'. Si accende quando il trascinamento passa, e si spegne da
// solo quando smette di passare.
let spegniVelo = null;
// La riga della sosta sotto il cursore si accende: cosi' si vede dove la foto
// andra' a finire prima di lasciarla, e non dopo
let sostaMirata = null;
const miraSosta = riga => {
  if (riga === sostaMirata) return;
  sostaMirata?.classList.remove('bersaglio');
  riga?.classList.add('bersaglio');
  sostaMirata = riga;
};
const nascondiVelo = () => { clearTimeout(spegniVelo); spegniVelo = null; veloFoto.remove(); miraSosta(null); };
const nomeSosta = riga => riga?.querySelector('.title')?.firstChild?.textContent?.trim();
function mostraVelo(riga) {
  const id = viaggioAperto();
  if (!veloFoto.isConnected) { veloFoto.classList.toggle('senza-viaggio', !id); document.body.appendChild(veloFoto); }
  const nome = nomeSosta(riga);
  veloFoto.querySelector('b').textContent = id ? 'Lascia qui le foto' : 'Apri prima un viaggio';
  veloFoto.querySelector('span').textContent = !id ? 'le foto stanno dentro a un viaggio'
    : nome ? `finiscono sotto \u00ab${nome}\u00bb` : 'finiscono nel viaggio aperto';
  clearTimeout(spegniVelo);
  spegniVelo = setTimeout(nascondiVelo, 900);
}
window.addEventListener('dragenter', e => { if (!conFile(e)) return; e.preventDefault(); if (!document.querySelector('.modal-bg')) mostraVelo(); });
window.addEventListener('dragover', e => {
  if (!conFile(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = viaggioAperto() ? 'copy' : 'none';
  if (document.querySelector('.modal-bg')) return;
  const riga = e.target?.closest?.('[data-sosta-riga]');
  miraSosta(riga);
  mostraVelo(riga);
});
window.addEventListener('dragend', nascondiVelo);
// Un errore che nessuno raccoglie muore nella console di chi l'ha visto
window.addEventListener('error', e => segnala('errore', `${e.message} \u2014 ${e.filename || '?'}:${e.lineno || 0}`));
window.addEventListener('unhandledrejection', e => segnala('promessa', String(e.reason?.message || e.reason || '')));
window.addEventListener('blur', nascondiVelo);
window.addEventListener('drop', safe(async e => {
  if (window.OSPITE || !conFile(e)) return;
  e.preventDefault();
  nascondiVelo();
  const id = viaggioAperto();
  // Di ogni trascinamento resta una riga nei log: quando qualcosa non arriva,
  // e' li' che si vede se il Mac ha consegnato il file o solo la sua promessa
  segnala('trascinamento', id ? 'nel viaggio ' + id : 'nessun viaggio aperto', dettagli(e.dataTransfer));
  // Con un pannello aperto il file non e' nostro, ma fermarlo si': dentro c'e'
  // un modulo a mezzo, e lasciare che il browser apra la foto lo butterebbe via
  if (document.querySelector('.modal-bg')) return toast('Chiudi prima il pannello aperto, poi trascina le foto', true);
  if (!id) return toast('Apri il viaggio dove vuoi mettere le foto, poi trascinale qui', true);
  // Lasciate sopra una sosta, sono foto di quella sosta
  const sosta = e.target?.closest?.('[data-sosta-riga]')?.dataset.sostaRiga;
  await caricaFoto(id, e.dataTransfer.files, sosta ? { stop_id: sosta } : {});
}));

// Uno scatto copiato dall'app Foto si incolla qui: \u2318V sulla pagina di un
// viaggio lo carica. Non quando si sta scrivendo da qualche parte, pero': li'
// \u2318V vuol dire incollare testo.
document.addEventListener('paste', e => {
  const viaggio = location.hash.match(/^#\/trip\/(\d+)/);
  if (window.OSPITE || !viaggio || !e.clipboardData || document.querySelector('.modal')) return;
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
  const foto = [...e.clipboardData.files].filter(paionoFoto);
  if (!foto.length) return;
  e.preventDefault();
  caricaFoto(+viaggio[1], foto);
});

document.addEventListener('click', e => { const a = e.target.closest('[data-logout]'); if (a) { e.preventDefault(); api('/auth/logout', { method: 'POST' }).then(() => { user = null; location.hash = '#/'; render(); }); } });
// Chi arriva da un link di sola lettura apre un'altra pagina, che pero' usa
// questa stessa mappa, queste stesse foto e lo stesso modo di rivedere un
// percorso: invece di riscriverli, glieli si passa. E l'app di casa, li', non
// si avvia nemmeno: non c'e' nessuno da far entrare.
window.Camper = { $, $$, esc, num, eur, dur, fdate, fdt, iso, notti, toast, apriLente, musichetta,
  legendaViaggio, mappaDelViaggio, rottaSvg, sportIco, coloreSport, ICO_SCARPA, coloreAtleta,
  atletiDi, trattoFra, MEZZI, mezzoDi, inCamper, nomeViaggio, nomeStato, giorniViaggio,
  itinerario, stileRitaglio, eVideo, facciaMedia, datiLente };
if (window.OSPITE) {
  document.body.classList.add('pagina-ospite');
} else {
  window.addEventListener('hashchange', render);
  render();
}
})();
