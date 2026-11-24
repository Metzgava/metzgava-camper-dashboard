// I tracciati veri di CarLock: dal file ai tragitti coi loro punti.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// Il tracker misura **quanto** si e' percorso e lo scrive nell'export
// normale; **per dove** non ce lo mette. Su richiesta pero' manda anche le
// posizioni registrate -- 32.069 punti su 143 tragitti, uno ogni quindici
// secondi -- e con quelle la riga sulla mappa smette di essere una
// ricostruzione.
//
// Quanto sbagliava, si e' misurato: su Novaledo -> Udine del 21/11 la riga
// ricostruita passava per Bassano, a **15,6 km** dalla strada vera.
//
//     trip,trip_start,trip_end,time,latitude,longitude,speed_kmh,heading_deg,altitude_m

// Le colonne si trovano per **nome**, non per posizione: e' la stessa scelta
// gia' presa per l'altro export di CarLock, e regge se un giorno ne
// aggiungono una in mezzo.
const quale = (capo, ...nomi) => capo.findIndex(c => nomi.includes(c));

const istante = s => {
  // «2026-07-31 17:20:26» non e' una data ISO: senza la T, Safari e qualche
  // versione di Node la leggono come invalida. Si normalizza.
  const t = new Date(String(s || '').trim().replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : null;
};

const numero = s => {
  const v = Number(String(s ?? '').trim());
  return Number.isFinite(v) ? v : null;
};

/**
 * Dal testo del file ai tragitti: `[{ id, da, a, punti: [{ t, lat, lon }] }]`.
 *
 * I punti di ogni tragitto escono **in ordine di tempo**: una riga fuori
 * ordine disegnerebbe un dente nella strada.
 *
 * **Una riga malformata si salta, il tragitto resta.** Buttare settecento
 * punti buoni per un refuso vorrebbe dire perdere la strada per niente.
 */
export function leggiTracciati(testo) {
  const righe = String(testo || '').split(/\r?\n/).filter(r => r.trim());
  if (righe.length < 2) return [];
  const capo = righe[0].split(',').map(c => c.trim().toLowerCase());
  const iTrip = quale(capo, 'trip'), iDa = quale(capo, 'trip_start'), iA = quale(capo, 'trip_end');
  const iT = quale(capo, 'time'), iLat = quale(capo, 'latitude'), iLon = quale(capo, 'longitude');
  if ([iTrip, iDa, iA, iT, iLat, iLon].some(i => i < 0)) return [];

  const per = new Map();
  for (const r of righe.slice(1)) {
    const c = r.split(',');
    const id = c[iTrip]?.trim();
    const lat = numero(c[iLat]), lon = numero(c[iLon]), t = istante(c[iT]);
    if (!id || lat == null || lon == null || t == null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (!per.has(id)) per.set(id, { id, da: istante(c[iDa]), a: istante(c[iA]), punti: [] });
    per.get(id).punti.push({ t, lat, lon });
  }
  const fuori = [...per.values()].filter(x => x.punti.length);
  for (const x of fuori) x.punti.sort((a, b) => a.t - b.t);
  return fuori;
}
