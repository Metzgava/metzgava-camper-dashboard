// Le note lunghe si chiudono, e si riaprono con un tocco.
//
// Prove: test/note-compresse.test.js, che raccontano le ragioni.
//
// Le `.nota` -- le scatole ambrate -- sono ventiquattro, da tre a otto righe
// l'una. Spiegano bene, e la prima volta servono. Dalla seconda in poi stanno
// fra te e il numero che sei venuto a vedere, e su un telefono vuol dire
// scorrere. Chiesto il 28/11/2026: chiuderle, e farlo su tutte le pagine.
//
// **Si fa qui e una volta sola**, non riscrivendo ventiquattro punti della
// pagina: dopo ogni disegno si passa e si chiude quel che va chiuso. Così
// vale anche per le note che verranno, senza che nessuno se ne ricordi.
//
// I `.perche` restano come sono: una riga sotto ogni voce, cinquantaquattro
// in tutto. Chiuderli costerebbe un tocco per non risparmiare niente.

// Sotto questa lunghezza la nota si lascia stare. A 13,5px dentro una scatola
// larga come un telefono ci stanno circa 55 caratteri per riga: la soglia sta
// quindi poco sopra le due righe. Chiudere due righe dentro un riassunto di
// una riga risparmia una riga e nasconde una spiegazione: non conviene.
export const SOGLIA_CARATTERI = 140;

// Quanto è lungo il riassunto. Una riga, con lo spazio per il triangolino.
const RIASSUNTO_CARATTERI = 48;

const pulito = t => String(t ?? '').replace(/\s+/g, ' ').trim();

/** Se questa nota vale la pena di chiuderla. */
export function vaCompressa(testo) {
  return pulito(testo).length > SOGLIA_CARATTERI;
}

/**
 * La prima riga della nota, tagliata su uno spazio.
 *
 * **Sono le sue parole, non un'etichetta.** Se tutte dicessero «spiegazione»
 * non sapresti quale aprire, e non ne apriresti più nessuna: il riassunto
 * deve far riconoscere *questa* nota fra le altre.
 */
export function riassunto(testo, massimo = RIASSUNTO_CARATTERI) {
  const t = pulito(testo);
  if (!t) return '';
  if (t.length <= massimo) return t;
  const tagliato = t.slice(0, massimo);
  const spazio = tagliato.lastIndexOf(' ');
  // Mai dentro una parola: `lastIndexOf` può non trovare niente se la prima
  // parola è lunghissima, e allora si taglia dove capita invece di sparire.
  return (spazio > 0 ? tagliato.slice(0, spazio) : tagliato).trimEnd() + '…';
}

/**
 * Come si riconosce la stessa nota fra un disegno e l'altro.
 *
 * `#/adesso` ed `#/energia` si rifanno **ogni due secondi e mezzo**,
 * sostituendo tutto. Senza questa chiave una nota aperta si richiuderebbe in
 * faccia dopo due secondi, e sembrerebbe un tasto rotto invece di una scelta.
 *
 * **Le cifre si tolgono**, e non è un dettaglio: qualche nota porta dentro un
 * valore vivo, e una chiave che cambiasse con lui richiuderebbe proprio le
 * note delle pagine che si rifanno più spesso.
 */
export function chiaveNota(testo) {
  return pulito(testo).replace(/\d+/g, '#').slice(0, 60);
}

// Il taglio: dall'apertura della nota al **primo** `</div>`.
//
// Oggi nessuna delle ventiquattro ha un `<div>` dentro -- c'e' una prova che
// lo controlla -- quindi il primo `</div>` e' sempre il suo. Se un giorno
// qualcuno ne annida uno, il taglio cadrebbe nel punto sbagliato e
// spezzerebbe la pagina: in quel caso la nota **si lascia stare**. Meglio una
// nota non chiusa che una pagina rotta.
const APERTURA = /<div class="nota"([^>]*)>/g;

// Il testo visibile, per il riassunto e per la chiave: via i tag, e le entita'
// che usiamo davvero rimesse al loro posto.
const senzaTag = html => html
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&egrave;/g, 'è').replace(/&rsquo;/g, '’')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const scappa = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Chiude le note lunghe **nel testo**, prima che la pagina lo disegni.
 *
 * `aperte` e' un `Set` di chiavi che vive fuori di qui: e' quel che fa
 * sopravvivere una nota aperta al ridisegno.
 *
 * Si fa sul testo e non sul DOM perche' la pagina **confronta invece di
 * sostituire** (`rifondi`): una modifica fatta dopo il disegno verrebbe
 * annullata al giro successivo, ogni due secondi e mezzo.
 *
 * Si usa `<details>`: si apre e si chiude da se', ci si arriva da tastiera, e
 * dentro un `<details>` chiuso gli elementi **esistono** nel documento --
 * quindi nessun tasto dentro una nota smette di funzionare.
 */
export function comprimiNelTesto(html, aperte = new Set()) {
  const testo = String(html ?? '');
  let fuori = '', da = 0;
  APERTURA.lastIndex = 0;
  let m;
  while ((m = APERTURA.exec(testo)) !== null) {
    const chiusura = testo.indexOf('</div>', m.index + m[0].length);
    if (chiusura < 0) break;
    const dentro = testo.slice(m.index + m[0].length, chiusura);
    const nudo = senzaTag(dentro);
    // Un `<div>` annidato: il taglio non e' il suo. Si lascia com'e'.
    if (dentro.includes('<div') || !vaCompressa(nudo)) continue;

    const chiave = chiaveNota(nudo);
    const apri = aperte.has(chiave) ? ' open' : '';
    fuori += testo.slice(da, m.index)
      + `<details class="nota"${m[1]} data-chiave="${scappa(chiave)}"${apri}>`
      + `<summary style="cursor:pointer">${scappa(riassunto(nudo))}</summary>`
      + `<div style="margin-top:8px">${dentro}</div></details>`;
    da = chiusura + '</div>'.length;
  }
  return da ? fuori + testo.slice(da) : testo;
}

// ---------------------------------------------------------------------------
// I riassunti dei due blocchi grossi
// ---------------------------------------------------------------------------
//
// Misurati il 28/11/2026 a larghezza di telefono: la calcolatrice di Energia
// e' 835 px, un quarto della pagina; i cinque riquadri degli apparecchi
// attesi su Adesso sono 640 px -- centotrenta a testa per dire che non hanno
// niente da dire.
//
// Chiudere non deve voler dire **nascondere**: il riassunto porta fuori
// esattamente quel che si andava a leggere li' dentro, altrimenti bisogna
// aprire ogni volta e non si e' guadagnato niente.

const inNumero = n => n.toLocaleString('it-IT', { minimumFractionDigits: 2,
                                                  maximumFractionDigits: 2 });

/** La riga che si legge a calcolatrice chiusa: da quanto a quanto, e quanto manca. */
export function riassuntoCalcolo({ da, a, wh } = {}) {
  const testa = `Da ${da ?? '—'}% a ${a ?? '—'}%`;
  // Senza capacita' non si inventa un numero: si dice quel che si sa.
  return wh == null ? testa : `${testa}: ${inNumero(wh / 1000)} kWh da rimettere dentro`;
}

/**
 * La riga che si legge con gli apparecchi attesi chiusi.
 *
 * **Chi tace viene per primo, ed e' il punto.** Un apparecchio che ha parlato
 * e ora tace e' una notizia; uno che non ha mai parlato e' un pezzo che non
 * c'e' ancora. Nello stesso mucchio, il primo sparirebbe sotto il secondo --
 * e chiudere un blocco non deve mai sotterrare un allarme.
 */
export function riassuntoAttesi(attesi) {
  const tutti = attesi || [];
  if (!tutti.length) return '';
  const muti = tutti.filter(a => a?.tace_da_minuti != null).length;
  const mai = tutti.length - muti;
  const pezzi = [];
  if (muti) pezzi.push(muti === 1 ? '1 tace' : `${muti} tacciono`);
  if (mai) pezzi.push(mai === 1 ? '1 non ancora collegato' : `${mai} non ancora collegati`);
  return pezzi.join(', ');
}
