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
