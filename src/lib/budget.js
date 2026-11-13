// I conti di un budget che non è ancora stato speso.
//
// La regola di questo file: ogni numero porta con sé **come** è stato contato.
// Un totale tondo senza i suoi pezzi non si può né correggere né credere, e
// quando manca un dato non si mette zero — zero vuol dire «non costa niente»,
// e non è quello che si sta dicendo. Si torna null, e chi guarda legge che
// manca il consumo del camper invece di un gasolio da zero euro.

const dueDecimali = n => Math.round(n * 100) / 100;
// I numeri si scrivono come li scrive chi legge: migliaia col punto, decimali
// con la virgola
const comeSiScrive = (n, dec = 0) => n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Quanto gasolio costerà tutta la strada. I km sono quelli delle tappe gia'
// disegnate: man mano che il giro cresce, cresce anche questo.
export function gasolioPrevisto({ km, kmPerLitro, prezzoLitro }) {
  const k = Number(km) || 0;
  const consumo = Number(kmPerLitro) || 0;
  const prezzo = Number(prezzoLitro) || 0;
  if (!k || !consumo || !prezzo) return null;
  const litri = k / consumo;
  return {
    importo: dueDecimali(litri * prezzo),
    conto: `${comeSiScrive(k)} km ÷ ${comeSiScrive(consumo, 1)} km/l × ${comeSiScrive(prezzo, 3)} € = ${comeSiScrive(litri)} litri`,
  };
}

// Quanto costeranno i posti dove si dorme. Si conta sulla media di quelli
// scelti, non su tutti quelli proposti: gli altri non si sa ancora se ci si
// andrà, e metterli nel conto gonfierebbe un numero su cui si decide.
export function campeggiPrevisti({ prezzi, notti }) {
  const validi = (prezzi || []).map(Number).filter(x => Number.isFinite(x) && x > 0);
  const n = Number(notti) || 0;
  if (!validi.length || !n) return null;
  const media = validi.reduce((a, b) => a + b, 0) / validi.length;
  return {
    importo: dueDecimali(media * n),
    conto: `${comeSiScrive(media, 2)} € a notte in media su ${validi.length} ${validi.length === 1 ? 'posto scelto' : 'posti scelti'} × ${n} ${n === 1 ? 'notte' : 'notti'}`,
  };
}
