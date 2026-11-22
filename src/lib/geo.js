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

// Il contrario del geocoder: da due coordinate il nome del posto. Serve agli
// allenamenti, che si chiamano tutti «Escursione» e non dicono dove: a rivedere
// il viaggio, «Sacra di San Michele» vale piu' di qualunque altro dato.
export async function luogoDaCoordinate(lat, lon, lang = 'it') {
  const pulisci = parti => [...new Set(parti.filter(Boolean))].slice(0, 2).join(', ').slice(0, 120) || null;
  try {
    const d = await fetchJson(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=${lang}`, { headers: { 'User-Agent': UA } }, 10000);
    const p = d.features?.[0]?.properties;
    if (p) {
      const nome = pulisci([p.name, p.city || p.town || p.village || p.locality || p.county]);
      if (nome) return nome;
    }
  } catch { }
  const attesa = 1100 - (Date.now() - lastNominatim);
  if (attesa > 0) await new Promise(r => setTimeout(r, attesa));
  lastNominatim = Date.now();
  try {
    const d = await fetchJson(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=14&accept-language=${lang}`, { headers: { 'User-Agent': UA } }, 10000);
    const a = d?.address || {};
    return pulisci([a.tourism || a.attraction || a.peak || a.hamlet || a.suburb, a.village || a.town || a.city || a.municipality]);
  } catch { return null; }
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

// park4night non ha un'API pubblica: non si importa nulla da loro. Quello che si
// puo' fare, e che basta, e' aprire la loro mappa gia' centrata sul posto —
// l'elenco dei luoghi arriva da OpenStreetMap, che di aree sosta ne conosce
// parecchie, e chi guarda decide confrontando le due cose.
export const linkPark4night = (lat, lon, zoom = 14) =>
  `https://park4night.com/it/search?lat=${(+lat).toFixed(5)}&lng=${(+lon).toFixed(5)}&z=${zoom}`;

// Ogni posto di park4night ha il suo numero, ed e' l'unica cosa che porta
// esattamente li': la ricerca per coordinate apre la zona, non il posto. Il
// numero si accetta come lo si ha sotto mano - nudo, con il cancelletto davanti
// o dentro l'indirizzo copiato dal sito.
export const numeroPark4night = v => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const m = t.match(/(?:place|lieu)\/(\d{2,9})/i) || t.match(/^#?\s*(\d{2,9})$/);
  return m ? m[1] : null;
};
export const linkPark4nightPosto = id => (id ? `https://park4night.com/it/place/${id}` : null);

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
    extra_info: ['tollways'],
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
  // I tratti a pedaggio arrivano come intervalli marcati 1. Di ognuno si prende
  // «amount», cioe' la quota di percorso che occupa: e' una percentuale, e una
  // percentuale non ha unita' di misura da sbagliare. La «distance» che sta
  // accanto cambia scala con units, e letta come metri diceva zero chilometri a
  // pedaggio su qualunque autostrada. Il prezzo invece nessun servizio gratuito
  // lo pubblica, e resta una stima a tariffa chilometrica.
  const quota = (f.properties.extras?.tollways?.summary || [])
    .filter(x => x.value === 1)
    .reduce((t, x) => t + (x.amount || 0), 0);
  return {
    distance_km: +s.distance.toFixed(1),
    duration_min: Math.round(s.duration / 60 * 1.15),   // il camper va piu' piano
    pedaggio_km: +(s.distance * quota / 100).toFixed(1),
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
// CarLock registra quanto si e' percorso, non per dove: la riga sulla mappa e'
// sempre una ricostruzione. Fra le strade possibili si prende quella che misura
// quanto dice il contachilometri — se si e' fatta la Romea invece
// dell'autostrada, la differenza si vede nei chilometri, ed e' l'unico indizio
// che si ha. Senza un numero vero a cui somigliare, resta la piu' rapida.
// Fra piu' strade possibili, quella che misura quanto i chilometri veri --
// scartando quelle che nel tempo vero non ci stanno.
//
// **Estratta e non copiata**: la usano il percorso diretto (`percorsoVicinoAiKm`)
// e quello che passa dai punti dichiarati (`percorsoPerIPunti`). Due copie
// della stessa regola un giorno divergono, su un numero che disegna una strada.
export function piuVicinaAiKm(varianti, kmVeri, minutiVeri) {
  if (!varianti?.length) throw new Error('nessun percorso');
  if (!(kmVeri > 0)) return { ...varianti[0], scelta_per_km: false };
  const tetto = minutiVeri > 0 ? minutiVeri * 1.35 + 10 : null;
  const possibili = tetto ? varianti.filter(v => !(v.duration_min > 0) || v.duration_min <= tetto) : varianti;
  const papabili = possibili.length ? possibili : varianti;
  const vicino = papabili.reduce((migliore, v) =>
    Math.abs(v.distance_km - kmVeri) < Math.abs(migliore.distance_km - kmVeri) ? v : migliore);
  return { ...vicino, scelta_per_km: papabili.length > 1, scarto_km: +(vicino.distance_km - kmVeri).toFixed(1),
    media_oraria: minutiVeri > 0 ? Math.round(kmVeri / (minutiVeri / 60)) : null,
    scartate: varianti.length - papabili.length };
}

// Il percorso che passa **dai punti dichiarati dal proprietario**.
//
// CarLock manda solo partenza e arrivo, e fra le strade possibili si prende
// quella che misura quanto i chilometri veri. Ma i candidati sono due al
// massimo, e la strada fatta davvero puo' non essere nessuna delle due: il
// 21/11/2026 Novaledo-Udine passava per Bassano mentre erano passati per Vidor
// e Pieve di Soligo. Quell'informazione la ha solo chi c'era.
//
// La geometria si cuce dalle tratte, perche' `percorsiConTappe` torna le
// tratte e non una riga sola. I punti si attraversano **nell'ordine scritto**:
// un ordine sbagliato da' una strada che torna indietro, e si deve vedere --
// chi guarda la mappa se ne accorge, il programma no.
//
// `percorsi` si puo' sostituire: serve alle prove, che una suite che martella
// i servizi gratuiti di percorsi e' un modo di farseli chiudere.
export async function percorsoPerIPunti(from, punti, to, kmVeri, minutiVeri,
                                        { percorsi = percorsiConTappe } = {}) {
  const tappe = [from, ...(punti || []).filter(p => p?.lat != null && p?.lon != null), to];
  if (tappe.length < 3) return percorsoVicinoAiKm(from, to, kmVeri, minutiVeri);
  const varianti = await percorsi(tappe);
  const scelta = piuVicinaAiKm(varianti, kmVeri, minutiVeri);
  const geometry = [];
  for (const t of (scelta.tratte || [])) {
    for (const p of (t.geometry || [])) {
      const ultimo = geometry[geometry.length - 1];
      // Il capo di una tratta e' il capo della prossima: scritto due volte
      // sarebbe un punto doppio in mezzo alla riga.
      if (!ultimo || ultimo[0] !== p[0] || ultimo[1] !== p[1]) geometry.push(p);
    }
  }
  return { ...scelta, geometry, per_i_punti: true };
}

export async function percorsoVicinoAiKm(from, to, kmVeri, minutiVeri) {
  const varianti = await variantiTratto(from, to);
  return piuVicinaAiKm(varianti, kmVeri, minutiVeri);
}


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
      pedaggio_km: scelte.some(t => t.pedaggio_km != null)
        ? +scelte.reduce((a, t) => a + (t.pedaggio_km || 0), 0).toFixed(1) : null,
      stimato: scelte.some(t => t.source === 'stima'),
      tratte: scelte,
    };
  });
}

// POI lungo il percorso: aree sosta camper, campeggi e camper service.
// Con un punto solo si cerca intorno a quello: e' il caso della destinazione di
// una tappa, che e' dove si dorme. Con una traccia si copre tutta la strada.
export async function poisAlongRoute(geometry, radiusM = 4000) {
  if (!geometry || !geometry.length) return { stops: [] };
  // Quanti centri servono lo decide la lunghezza della strada, non un numero
  // fisso: cerchi piazzati a una volta e mezza il raggio coprono tutto senza
  // sovrapporsi. Con troppi, la richiesta scade dopo novanta secondi.
  const lunghezzaKm = geometry.length < 2 ? 0
    : geometry.reduce((t, p, i) => i ? t + haversineKm(geometry[i - 1], p) : 0, 0);
  const passoKm = Math.max(3, (radiusM / 1000) * 1.5);
  const quanti = Math.min(15, Math.max(2, Math.round(lunghezzaKm / passoKm) + 1));
  const around = samplePoints(geometry, quanti).map(([lat, lon]) => `${lat},${lon}`).join(',');

  const chiedi = async corpoQuery => {
    const query = `[out:json][timeout:90];\n(${corpoQuery}\n);\nout center tags 150;`;
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      try {
        // Senza un User-Agent che dica chi siamo, Overpass risponde 406 e
        // rifiuta tutto: e' scritto nelle loro regole d'uso
        const d = await fetchJson(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } }, 95000);
        if (d.remark) throw new Error(String(d.remark).slice(0, 120));
        return { elementi: d.elements || [] };
      } catch (e) {
        const motivo = String(e.message || '');
        const vaRiprovato = /429|503|504|abort|timed out|timeout/i.test(motivo);
        console.warn(`POI: Overpass non ha risposto (${motivo.slice(0, 90)})${vaRiprovato && tentativo === 0 ? ', riprovo fra poco' : ''}`);
        if (!vaRiprovato || tentativo === 1) return { errore: motivo };
        await new Promise(r => setTimeout(r, 12000));
      }
    }
  };

  const soste = await chiedi(`
  nwr["tourism"="caravan_site"](around:${radiusM},${around});
  nwr["tourism"="camp_site"]["caravans"!="no"](around:${radiusM},${around});
  nwr["amenity"="sanitary_dump_station"](around:${radiusM},${around});`);
  const stops = [];
  for (const el of (soste.elementi || [])) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const kind = t.tourism === 'caravan_site' ? 'area_sosta' : t.amenity ? 'camper_service' : 'campeggio';
    stops.push({ name: t.name || (kind === 'area_sosta' ? 'Area sosta camper' : kind === 'campeggio' ? 'Campeggio' : 'Camper service'),
      kind, lat, lon, fee: t.fee || null, website: t.website || t['contact:website'] || null, phone: t.phone || null,
      opening_hours: t.opening_hours || null, capacity: t.capacity || null, power: t.power_supply || null, drinking_water: t.drinking_water || null });
  }
  const seen = new Set();
  const uniq = arr => arr.filter(v => !seen.has(v.name) && seen.add(v.name));
  const avviso = !soste.errore ? null
    : /429/.test(soste.errore) ? 'Il servizio delle mappe sta limitando le richieste: riprova fra qualche minuto'
    : /timed out|timeout/i.test(soste.errore) ? 'Ricerca troppo ampia per il servizio: prova un raggio piu\u2019 stretto'
    : 'Servizio mappe momentaneamente non disponibile';
  return { stops: uniq(stops).slice(0, 40), ...(avviso ? { warning: avviso } : {}) };
}

// I nomi dei posti scritti a mano diventano punti.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// «Siamo passati per vidor e pieve di soligo»: due nomi, scritti come si
// scrivono i nomi dei posti. Qui si cercano, con la stessa macchina che usa
// l'import di CarLock -- piu' modi di scrivere lo stesso indirizzo
// (`addressCandidates`) e una pausa fra una richiesta e l'altra, perche'
// martellare i geocoder gratuiti e' il modo di farseli chiudere.
//
// **Un nome che non si trova non spegne gli altri, e resta scritto.** Buttarlo
// in silenzio vorrebbe dire fargli riscrivere una cosa che ha gia' scritto,
// senza dirgli perche' non ha funzionato. Resta li' con le coordinate vuote, e
// chi chiama sa dirlo.
//
// E un geocoder che si lamenta non fa cadere tutto: i servizi gratuiti
// rifiutano, ogni tanto, e un nome che non si e' potuto cercare e' un nome non
// trovato -- non un errore che svuota la tappa.
// Quanti punti si accettano in una volta.
//
// Trovato in revisione il 21/11/2026: non c'era nessun limite. Ogni nome costa
// fino a due richieste ai geocoder gratuiti, con l'attesa obbligatoria di
// Nominatim, e poi il percorso fa due richieste per **ogni segmento**. Una
// riga di dieci nomi tiene la risposta aperta per minuti; chi non vede
// muoversi niente ricarica, e le richieste raddoppiano verso i servizi che
// tutto il resto di questo file e' attentissimo a non martellare.
//
// Otto bastano per raccontare una giornata di strada, e sono gia' nove tratte.
export const PUNTI_MASSIMI = 8;

export async function puntiDichiarati(nomi, { cerca = geocode,
                                              candidati = n => [n],
                                              pausa = 250 } = {}) {
  const tutti = (nomi || []).map(n => String(n ?? '').trim()).filter(Boolean);
  const puliti = tutti.slice(0, PUNTI_MASSIMI);
  const punti = [], non_trovati = [];
  // Lo stesso nome due volte si cerca una volta sola: e' la stessa attenzione
  // che ha gia' l'import di CarLock con la sua cache per indirizzo.
  const visti = new Map();
  for (const nome of puliti) {
    let trovato = visti.has(nome) ? visti.get(nome) : null;
    if (!visti.has(nome)) {
      const prove = candidati(nome);
      for (let i = 0; i < prove.length; i++) {
        try {
          const r = await cerca(prove[i]);
          if (r?.length) { trovato = { lat: r[0].lat, lon: r[0].lon }; break; }
        } catch { /* un rifiuto e' un «non trovato», non un guasto */ }
        // Dopo l'ultimo tentativo la pausa non serve a nessuno.
        if (pausa && i < prove.length - 1) await new Promise(r => setTimeout(r, pausa));
      }
      visti.set(nome, trovato);
    }
    if (!trovato) non_trovati.push(nome);
    punti.push({ nome, lat: trovato?.lat ?? null, lon: trovato?.lon ?? null });
  }
  return { punti, non_trovati, troppi: tutti.length - puliti.length };
}
