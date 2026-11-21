// Quanto da' davvero la presa a cui sei attaccato, e chi dei due frena.
//
// Disegno: docs/superpowers/specs/2026-11-21-colonnina-ampere-design.md
//
// Il proprietario, in viaggio: «cambia gli ampere da colonnina da 1 a 16 o
// oltre... era per il calcolo dei tempi di ricarica stimati sia di bluetti che
// di ective da colonnina, ora non si riesce a mettere 2 o 4 o 6».
//
// Non era un campo che rifiutava: era un campo che **non c'era**. L'unico dato
// della 220 nell'Impianto era `bluetti_carica_ac_w`, in watt, a 1800 --
// scriverci 4 vuol dire quattro watt.
//
// E 1800 W e' quel che la **Bluetti** sa prendere, non quel che la
// **colonnina** sa dare. In campeggio il limite e' quasi sempre la colonnina:
// 4 A sono 920 W, 6 A sono 1380. Il conto di prima usava sempre 1800, quindi
// su una presa da 4 A prometteva una ricarica doppia di quella vera -- e
// sbagliava nella direzione ottimista, la sola che fa restare fermi contando
// su ore che non ci sono.

// La tensione di rete europea. **Costante del codice, non dato da compilare**:
// chiederla sarebbe una domanda in piu' per un numero che non cambia mai.
// Scritta qui, con questo commento, cosi' chi legge sa da dove escono i watt.
export const RETE_V = 230;

// Le taglie fra cui si sceglie.
//
// «Devono essere selezionabili da 1 a 16 almeno», e niente campo libero: le
// prese esistono in **taglie**, non in numeri qualunque. Un ampere e mezzo non
// esiste, e su un iPad un campo numerico si sbaglia piu' facilmente di quanto
// si scelga da un elenco -- che era anche la ragione vera per cui «non si
// riesce a mettere 2 o 4 o 6» dava fastidio.
//
// Da 1 a 16 c'e' tutto quel che si incontra in piazzola, e il 16 e' anche la
// presa di casa; 20, 25 e 32 sono le taglie grosse standard, per i posti
// serviti bene e per il «o oltre» della prima richiesta.
export const TAGLIE_A = [...Array.from({ length: 16 }, (_, i) => i + 1), 20, 25, 32];

// Quanti watt passano davvero, e **chi dei due lo decide**.
//
// Il numero da solo non basta: senza sapere quale limite ha vinto, chi doveva
// cambiare piazzola cambia apparecchio. Quindi si torna anche `chi`.
//
//   `apparecchio`  i watt che l'apparecchio sa prendere dalla 220, o null
//   `ampere`       gli ampere della presa dichiarati, o null
//
// Senza ampere dichiarati non si cambia niente: resta il conto di oggi. Un
// valore assente non deve peggiorare quel che gia' funziona.
export function limiteDellaPresa(apparecchio, ampere) {
  const presa_w = ampere == null || !(Number(ampere) > 0) ? null : Number(ampere) * RETE_V;
  if (apparecchio == null) return { watt: null, chi: null, presa_w };
  if (presa_w == null) return { watt: apparecchio, chi: 'apparecchio', presa_w: null };
  // A pari merito **non** e' la presa a frenare: dirlo quando non lo e'
  // manderebbe a cercare una piazzola migliore chi non ne ha bisogno.
  return presa_w < apparecchio
    ? { watt: presa_w, chi: 'presa', presa_w }
    : { watt: apparecchio, chi: 'apparecchio', presa_w };
}
