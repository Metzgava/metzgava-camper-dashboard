// Un numero che cambia ci arriva invece di saltarci.
//
// Perche' non e' un vezzo. Col vivo acceso la pagina si riaggiorna ogni due
// secondi e mezzo, e fino a oggi ogni cifra si sostituiva di colpo: 120 W
// diventava 340 W senza passare per nulla. Chi guarda non vede un valore che
// sale, vede due valori diversi — e non sa se il secondo e' una lettura nuova o
// un altro numero che non aveva notato. Il movimento dice **che questo numero
// e' quello di prima, cambiato**, che e' un'informazione in piu', non una
// decorazione.
//
// Come si usa, attorno al ridisegno:
//
//     const prima = istantanea(radice);
//     rifondi(radice, html);            // il testo arriva al valore finale
//     scorri(radice, prima);            // e poi ci si torna, scorrendo
//
// L'ordine conta: `rifondi` mette subito il numero giusto, cosi' se questo
// pezzo non gira — o se chi guarda ha chiesto meno animazioni — in pagina c'e'
// comunque il valore vero. L'animazione e' un ripensamento, non la fonte.
//
// Un elemento partecipa dichiarando il valore in cifre, non in parole:
//
//     <span data-num="340" data-num-dec="1">340,0</span>
//
// L'attributo serve perche' il testo e' gia' formattato all'italiana — «1.240»
// — e rileggerlo da li' vorrebbe dire interpretare un punto che a volte separa
// le migliaia e a volte i decimali. Il valore in cifre non ha questo problema.

const DURATA = 700;
const CORSE = new WeakMap();   // elemento -> fotogramma prenotato

// Dove sta il numero a frazione `t` della corsa.
//
// La frazione si tronca fra 0 e 1 di proposito. Un fotogramma in ritardo —
// scheda tornata in primo piano, telefono che rallenta — darebbe una frazione
// oltre 1, e senza il taglio il numero passerebbe oltre l'arrivo prima di
// tornare: su una carica, un 103 % anche solo per un fotogramma e' un guasto,
// non un'animazione.
export function aFrazione(da, a, t) {
  const f = Math.min(1, Math.max(0, t));
  const q = 1 - (1 - f) ** 3;
  return da + (a - da) * q;
}

// E come lo si scrive. Deve scrivere **come `num()` della pagina**: durante la
// corsa la cifra la riscrive questo pezzo, e se le due forme non coincidessero
// ogni numero cambierebbe aspetto per sette decimi di secondo — 1.240 che
// diventa 1240 e poi di nuovo 1.240.
export function scritto(v, decimali = 0) {
  return v.toLocaleString('it-IT',
    { minimumFractionDigits: decimali, maximumFractionDigits: decimali });
}

const valore = e => {
  const v = parseFloat(e.getAttribute('data-num'));
  return Number.isFinite(v) ? v : null;
};

// Quel che la pagina mostra adesso, prima che il ridisegno lo cambi.
export function istantanea(radice) {
  const m = new Map();
  if (!radice) return m;
  for (const e of radice.querySelectorAll('[data-num]')) {
    const v = valore(e);
    if (v != null) m.set(e, v);
  }
  return m;
}

export function scorri(radice, prima) {
  if (!radice || !prima) return;
  // Chi ha chiesto meno movimento al sistema vede il numero nuovo e basta: ce
  // l'ha gia' davanti, l'ha messo il ridisegno. Si perde l'animazione, non il
  // dato — come l'alone e la lancetta.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  for (const e of radice.querySelectorAll('[data-num]')) {
    const a = valore(e);
    if (a == null) continue;
    const da = prima.get(e);
    // Un elemento che prima non c'era non ha un «da cui partire»: nasce col suo
    // numero, senza scorrere. Partire da zero sarebbe una bugia breve ma
    // visibile, e su una carica le bugie brevi sono quelle che spaventano.
    if (da == null || da === a) continue;
    anima(e, da, a);
  }
}

function anima(e, da, a) {
  const decimali = Number(e.getAttribute('data-num-dec')) || 0;
  const prenotato = CORSE.get(e);
  if (prenotato) cancelAnimationFrame(prenotato);

  const inizio = performance.now();
  const passo = adesso => {
    const t = (adesso - inizio) / DURATA;
    e.textContent = scritto(aFrazione(da, a, t), decimali);
    if (t < 1) CORSE.set(e, requestAnimationFrame(passo));
    else CORSE.delete(e);
  };
  CORSE.set(e, requestAnimationFrame(passo));
}
