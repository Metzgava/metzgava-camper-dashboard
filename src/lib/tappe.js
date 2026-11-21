// Da strada possibile a tappe.
//
// Quando una strada nasce, il calcolatore risponde con le sue varianti, e ogni
// variante porta con se' le tratte: da dove a dove, quanti chilometri, quanti
// minuti, e la linea da disegnare. Metterla in mappa e' tradurre quelle tratte
// in tappe del viaggio - non ricontare niente, e non chiamare nessuno.
//
// Quello che qui si decide e' una cosa sola: quale variante. Quella scelta, se
// c'e'; altrimenti la prima, che e' quella che si vede in cima all'elenco.
// Mettere in mappa una strada che nessuno ha scelto sarebbe peggio che non
// metterla.

const nomeDi = p => {
  const n = String(p?.name || p?.nome || '').trim();
  if (n) return n.slice(0, 200);
  // Un punto senza nome ha pero' le sue coordinate: dirle e' meglio che
  // scrivere «undefined» sulla mappa
  return `${(+p.lat).toFixed(3)}, ${(+p.lon).toFixed(3)}`;
};

const haPosto = p => Number.isFinite(+p?.lat) && Number.isFinite(+p?.lon);

export function tappeDaPercorso(percorso) {
  const varianti = percorso?.varianti || [];
  const v = varianti.find(x => x.chiave === percorso?.scelta) || varianti[0];
  if (!v) return [];
  return (v.tratte || [])
    // Una tratta di cui non si sa un capo non si puo' disegnare: si salta,
    // invece di inventarle un posto
    .filter(t => haPosto(t?.from) && haPosto(t?.to))
    .map((t, i) => ({
      posizione: i,
      from_name: nomeDi(t.from), from_lat: +t.from.lat, from_lon: +t.from.lon,
      to_name: nomeDi(t.to), to_lat: +t.to.lat, to_lon: +t.to.lon,
      distance_km: +(+t.distance_km || 0).toFixed(2),
      duration_min: Math.round(+t.duration_min || 0),
      geometry: Array.isArray(t.geometry) ? t.geometry : null,
      pedaggio_km: Number.isFinite(+t.pedaggio_km) ? +t.pedaggio_km : null,
    }));
}

// Quali numeri prende una tappa quando le si applica una strada.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// **CarLock misura i chilometri e il tempo; la strada no.** Manda solo
// partenza e arrivo, e la riga sulla mappa e' sempre una ricostruzione: fra le
// strade possibili si prende quella che misura quanto i chilometri veri.
//
// Fino al 21/11/2026 non era cosi' nel salvataggio di una tappa: aprendo
// «Modifica» la pagina mostra le strade possibili, e toccarne una scriveva i
// chilometri e la durata **della variante** al posto di quelli del tracker.
// Due tocchi, e la misura era persa -- con lei il gasolio, i totali del
// viaggio e il costo al km. Non e' una cosa che si nota: i numeri restano
// plausibili, solo non sono piu' quelli veri.
//
// Il pedaggio invece **segue la strada**, perche' dipende da lei e CarLock non
// lo misura. E' la distinzione che conta: si protegge quel che e' misurato,
// non tutto quel che e' scritto.
export function numeriDellaTappa(tappa, strada) {
  if (!strada) {
    return { distance_km: tappa?.distance_km ?? null, duration_min: tappa?.duration_min ?? null,
             geometry: tappa?.geometry ?? null, pedaggio_km: tappa?.pedaggio_km ?? null };
  }
  const dalTracker = tappa?.source === 'carlock';
  return {
    distance_km: dalTracker ? tappa.distance_km : strada.distance_km,
    duration_min: dalTracker ? tappa.duration_min : strada.duration_min,
    geometry: strada.geometry,
    // `null` e non `0`: un percorso che non dice niente sui pedaggi non sta
    // dicendo che non ce ne sono.
    pedaggio_km: strada.pedaggio_km ?? null,
  };
}

// I punti dichiarati che si possono davvero usare per disegnare questa tappa.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// Due filtri, e tutti e due dicono qualcosa:
//
//   - **solo in camper.** Una rotta e un volo le statali non le seguono, e
//     disegnare l'autostrada sotto un aereo sarebbe un racconto falso. Se il
//     mezzo e' cambiato dopo che i punti erano stati scritti, i punti restano
//     salvati e si ignorano: butterebbero via un'informazione che tornera'
//     utile se il mezzo torna quello di prima.
//   - **solo quelli trovati.** Un nome che il geocoder non ha riconosciuto
//     resta scritto -- cosi' chi l'ha scritto lo vede e lo corregge -- ma
//     senza coordinate non si puo' passare da nessuna parte.
//
// Il mezzo mancante vale «camper», come dappertutto nel programma.
export function puntiDaUsare(tappa) {
  const mezzo = String(tappa?.mezzo || 'camper');
  if (mezzo !== 'camper') return [];
  return (tappa?.via || []).filter(p => p?.lat != null && p?.lon != null);
}
