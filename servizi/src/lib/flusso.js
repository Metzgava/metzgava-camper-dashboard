// Cosa carica le batterie: da quali fonti, quanta corrente, e come va
// disegnato ciascun ramo.
//
// Disegno: docs/superpowers/specs/2026-11-19-flusso-carica-ective-design.md
//
// I numeri non si calcolano qui: arrivano da `conti.js`, che li produce a ogni
// apertura della pagina. Qui si decide soltanto **come si vedono**: quale ramo
// e' attivo, quanto spesso, quanto veloce.
//
// Perche' il conto sta in un file del server e non in `public/app.js`: li' non
// girano prove, e questa e' logica che va tenuta ferma. Un ramo a zero watt che
// si anima direbbe che sta entrando corrente quando non entra. E il ramo
// dedotto che perde il suo bollino direbbe misurato quel che e' una
// sottrazione.

// Lo spessore del ramo, in pixel, e il tempo di un giro dei puntini.
//
// La scala e' sul **totale che entra**, non su una scala assoluta di watt: il
// 19/11/2026 i pannelli davano sei watt sotto la pioggia, e su una scala
// assoluta sarebbero stati un filo immobile. Erano sei watt su sette: quasi
// tutto quel che entrava, e si devono vedere.
export const SPESSORE = { min: 2, max: 8 };
export const SECONDI = { lento: 3, veloce: 0.8 };

// L'ordine conta: e' l'ordine in cui compaiono in pagina, dall'alto. Il sole
// per primo perche' e' quello che c'e' sempre; la 220 per ultima perche' e'
// quella dedotta.
const FONTI = [
  { id: 'sole', nome: 'Sole', icona: '☀️', campo: 'sole_w', certezza: 'misurato' },
  { id: 'motore', nome: 'Alternatore', icona: '\u{1F501}', campo: 'motore_w', certezza: 'misurato' },
  // Non si misura: e' il totale meno gli altri due. Potrebbe venire da una
  // terza fonte che non vediamo, e la figura non deve dire il contrario.
  { id: 'rete', nome: 'Dalla 220', icona: '\u{1F50C}', campo: 'rete_w', certezza: 'dedotto' },
];

const fra = (v, min, max) => Math.min(max, Math.max(min, v));

// `null` quando non si sa, e non zero: prima regola del progetto. `Number(null)`
// fa 0, quindi il controllo va fatto prima della conversione.
function numero(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ramiDellaCarica(fonti) {
  const totale = numero(fonti?.valore);
  // E' il `manca()` di conti.js: senza letture delle Ective non c'e' niente da
  // disegnare, e la pagina mostra la spiegazione di cosa manca.
  if (totale == null) return null;

  const rami = FONTI.map(({ campo, ...f }) => {
    const watt = numero(fonti[campo]);
    if (watt == null) {
      // Non e' un ramo a zero: e' un ramo di cui non si sa niente. Si disegna
      // diverso e senza numero.
      return { ...f, watt: null, ignoto: true, attivo: false,
        spessore: SPESSORE.min, secondi: null };
    }
    // Una corrente negativa non e' una carica: le batterie si stanno
    // scaricando, il verso e' l'altro, e questa figura mostra solo quel che
    // entra.
    const attivo = watt > 0 && totale > 0;
    // La somma delle parti puo' superare il totale: il totale si misura sulle
    // batterie, le parti su apparecchi diversi, e i tre istanti non
    // coincidono. Senza il limite ne uscirebbe un ramo da trenta pixel.
    const quota = attivo ? fra(watt / totale, 0, 1) : 0;
    const arrotonda = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;
    return {
      ...f,
      watt,
      attivo,
      spessore: attivo
        ? arrotonda(SPESSORE.min + (SPESSORE.max - SPESSORE.min) * quota)
        : SPESSORE.min,
      secondi: attivo
        ? arrotonda(SECONDI.lento - (SECONDI.lento - SECONDI.veloce) * quota, 2)
        : null,
    };
  });

  return { totale, rami };
}
