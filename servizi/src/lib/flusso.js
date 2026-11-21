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
import { SOGLIA_W as SOGLIA_TRAVASO_W, SOGLIA_RETE_W } from './travaso.js';

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

// Sotto questa potenza e' rumore, non un flusso. Non e' inventata qui: sta in
// `app.js` come `VERSO_W`, con la sua ragione -- un apparecchio acceso che non
// fa niente consuma qualche watt, e non e' una scarica. Un ramo che si muove
// per il rumore direbbe che sta succedendo qualcosa quando non succede niente.
//
// Vale per la Bluetti, che dichiara i suoi watt anche da ferma. Non per le
// Ective, dove la corrente in ingresso e' gia' il fatto che interessa.
export const SOGLIA_W = 5;

// Il riferimento dello spessore del ramo in uscita, in watt.
//
// In entrata la scala e' **relativa**: ogni ramo si misura sul totale del
// proprio lato, e sei watt dal sole sotto la pioggia si vedono perche' erano
// quasi tutto quel che entrava. In uscita quella scala non si puo' usare: il
// ramo e' uno solo, la sua quota sul proprio lato e' sempre uno, e trenta watt
// si disegnerebbero identici a trecento -- cioe' la figura perderebbe
// esattamente la differenza che interessa guardare.
//
// Quindi qui la scala e' assoluta, e questo numero e' il suo riferimento: un
// tondo scelto perche' il campo normale si legga bene -- il camper fermo in
// sosta, qualche decina di watt, resta un filo sottile; tutto accesso insieme,
// frigo e Truma e pompa e Starlink, arriva vicino al massimo. Non e' un limite
// e non e' una misura: e' una **scelta di disegno**, e sopra questa soglia il
// tratto non cresce piu' mentre il numero scritto accanto continua a dire la
// verita'.
export const RIFERIMENTO_USCITA_W = 300;

// Le due soglie che decidono se il pacco si puo' chiamare **pieno**.
//
// Disegno: docs/superpowers/specs/2026-11-21-potenza-netta-ective-design.md
//
// Servono tutte e due, e la seconda e' quella che il primo disegno aveva
// mancato. Il 21/11/2026 la pagina scriveva «sono gia' cariche» con i
// quadranti al 95 % e 98 %: la carica, da sola, era la soglia che mancava. Ma
// con la sola carica il conto non sarebbe scattato mai, perche' **un pacco
// davvero pieno non legge zero**: a riposo il proprietario ha misurato -0,29 A
// il 16/11/2026, cioe' circa 3,8 W che escono. Chiedere «esce esattamente
// zero» vuol dire non chiamare mai pieno niente.
//
// `CARICA_PIENA_PCT`: il proprietario ha letto 95 e 98 e non le ha chiamate
// piene. Una LiFePO4 in mantenimento sta sopra il 99 %.
//
// `USCITA_FERMA_W`: sopra i 3,8 W misurati a riposo, e sotto qualunque
// apparecchio vero -- Starlink da solo ne prende diciotto. **Non e'
// `SOGLIA_W`**: quella decide se *animare* un ramo, e qui sopra c'e' scritto
// che per le Ective non vale. Questa decide quale *frase* dire, e sono due
// mestieri diversi.
//
// E non nasconde niente: i watt in uscita restano scritti tali e quali
// accanto al loro ramo. E' solo la parola «piene» che tollera i quattro watt
// del riposo.
export const CARICA_PIENA_PCT = 99;
export const USCITA_FERMA_W = 6;

// Le stesse di `travaso.js`, e per le stesse ragioni gia' scritte li'. Qui si
// ripetono i nomi e non i numeri: una soglia che vive in due posti con due
// valori diversi e' il modo di far dire a due parti della pagina cose
// contrarie sullo stesso istante.
// `export ... from` rigira il nome a chi importa ma **non** lo porta nello
// scope di questo file: dentro `origineDella220` le soglie erano indefinite, e
// le prove lo hanno preso subito. Si importa e si riesporta.
export { SOGLIA_TRAVASO_W, SOGLIA_RETE_W };

const fra = (v, min, max) => Math.min(max, Math.max(min, v));

// Chi sta facendo la 220 che carica le Ective.
//
// Il ramo si chiamava «Dalla 220» e taceva su chi quella 220 la facesse, e
// sono due situazioni opposte. Dalla **colonnina**: energia che arriva da
// fuori, non costa niente al camper, e intanto si carica anche la Bluetti.
// Dalla **Bluetti**: non e' energia nuova, e' energia spostata da una batteria
// all'altra, e per strada se ne perde un quinto fra inverter e caricatore.
//
// La regola non e' nuova: e' quella di `travaso.js`, «eroga e non riceve», con
// le sue soglie gia' motivate -- sotto i 150 W l'uscita 220 non e' un
// apparecchio che lavora, sopra i 50 W in ingresso c'e' la rete e la corrente
// la paga la colonnina.
//
// Su una lettura vecchia non si attribuisce niente. Il 19/11/2026 una lettura
// di sei minuti fa, messa accanto a watt freschi, aveva gia' prodotto un
// «esce 0, arriva 201»: battezzare la sorgente su un dato vecchio sarebbe lo
// stesso errore, travestito meglio.
function origineDella220(b) {
  if (!b || b.vecchia) return null;
  const rete = numero(b.rete_w) ?? 0;
  const esce = numero(b.uscita_ac_w) ?? 0;
  if (rete >= SOGLIA_RETE_W) return 'colonnina';
  if (esce >= SOGLIA_TRAVASO_W) return 'bluetti';
  return null;
}

const NOME_220 = {
  colonnina: 'Dalla colonnina',
  bluetti: 'Dalla Bluetti',
};

// Come si vede un ramo che porta `watt` su un totale di `totale`. La scala e'
// sempre sul totale del **proprio lato**: trecento watt in uscita e dieci in
// entrata, con una scala sola, farebbero dell'entrata un filo invisibile --
// mentre quei dieci watt sono tutto quel che entra.
function aspetto(watt, totale, soglia = 0) {
  const arrotonda = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;
  const attivo = watt > soglia && totale > 0;
  const quota = attivo ? fra(watt / totale, 0, 1) : 0;
  return {
    attivo,
    spessore: attivo
      ? arrotonda(SPESSORE.min + (SPESSORE.max - SPESSORE.min) * quota)
      : SPESSORE.min,
    secondi: attivo
      ? arrotonda(SECONDI.lento - (SECONDI.lento - SECONDI.veloce) * quota, 2)
      : null,
  };
}

// I due lati della Bluetti: cosa le entra e cosa le esce.
//
// Rispetto alle Ective cambia una cosa, ed e' importante: **tutti e quattro i
// numeri sono misurati**, arrivano dal loro cloud cosi' come sono. Nessun ramo
// dedotto, nessun bollino di stima -- la figura non deve aggiungere incertezza
// dove non ce n'e'.
const BLUETTI = {
  entrata: [
    { id: 'fotovoltaico', nome: 'Fotovoltaico', icona: '\u2600\uFE0F', campo: 'fotovoltaico_w' },
    { id: 'rete', nome: 'Dalla rete', icona: '\u{1F50C}', campo: 'rete_w' },
  ],
  uscita: [
    { id: 'ac', nome: '220 V', icona: '\u{1F50C}', campo: 'uscita_ac_w' },
    { id: 'dc', nome: '12 V', icona: '\u{1F50B}', campo: 'uscita_dc_w' },
  ],
};

function lato(elenco, b) {
  const letti = elenco.map(({ campo, ...f }) => ({ ...f, watt: numero(b[campo]) }));
  const totale = letti.reduce((s, r) => s + (r.watt > 0 ? r.watt : 0), 0);
  return {
    totale,
    rami: letti.map(r => r.watt == null
      ? { ...r, ignoto: true, attivo: false, spessore: SPESSORE.min, secondi: null }
      : { ...r, ...aspetto(r.watt, totale, SOGLIA_W) }),
  };
}

export function ramiDellaBluetti(b) {
  if (!b) return null;
  return {
    carica: numero(b.carica),
    entrata: lato(BLUETTI.entrata, b),
    uscita: lato(BLUETTI.uscita, b),
  };
}

// `null` quando non si sa, e non zero: prima regola del progetto. `Number(null)`
// fa 0, quindi il controllo va fatto prima della conversione.
function numero(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// `letture` dice se le Ective si stanno leggendo, ed e' necessario perche' il
// totale non basta a distinguere i due casi.
//
// `sommaPos` in conti.js torna **null**, non zero, quando nessun valore e'
// positivo: a camper fermo con le batterie piene il totale e' null esattamente
// come quando le Ective non si leggono affatto. La prima stesura guardava solo
// il totale, e il 19/11/2026 la figura spariva nello stato piu' comune della
// giornata -- confondendo «non entra niente» con «non so niente», che e'
// proprio la distinzione che il resto del progetto tiene separata dappertutto.
// Oltre questa eta' la figura non si anima piu'. Mezz'ora, come per i
// termometri: col passo a due minuti sono quindici letture perse, e uno o due
// giri saltati sono normali.
export const FERMA_DOPO_MINUTI = 30;

export function ramiDellaCarica(fonti, { letture = false, bluetti = null,
                                         minuti = null, consumo = null,
                                         carica = null } = {}) {
  // Un disegno che si muove su dati vecchi mente meglio di un numero fermo: i
  // puntini che scorrono dicono «sta entrando corrente **adesso**» con piu'
  // forza di quanta ne abbia uno zero immobile. Quindi oltre la mezz'ora i
  // rami restano fermi, e i numeri restano scritti -- erano veri, solo di
  // prima: e' l'eta' che va detta, non il valore che va nascosto.
  //
  // Non sapere l'eta' non vuol dire «vecchio»: si continua come prima, o una
  // chiamata che si dimentica di passarla spegnerebbe la figura per sempre.
  const misurato = numero(fonti?.valore);
  // Senza letture delle Ective non c'e' niente da disegnare, e la pagina
  // mostra la spiegazione di cosa manca -- e' il `manca()` di conti.js.
  if (misurato == null && !letture) return null;
  const totale = misurato == null ? 0 : misurato;

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

  // Una fonte che produce mentre nelle batterie non entra niente: quella
  // corrente non sparisce, va ai consumi del camper. Il numero della fonte
  // resta scritto, il ramo no -- e la pagina puo' dire dove sta andando,
  // invece di lasciare un sei watt senza spiegazione accanto a uno zero.
  //
  // **Ma non basta sapere che va altrove: bisogna sapere perche'.** Fino al
  // 21/11/2026 questo era un booleano e la pagina ne ricavava una frase sola,
  // «sono gia' cariche». Sono due situazioni opposte:
  //
  //   - il pacco e' **pieno** e il caricatore si fa da parte: tutto bene, quei
  //     watt vanno ai consumi e non servivano alle batterie;
  //   - il pacco **si sta scaricando** e le fonti non bastano a coprire i
  //     consumi: il sole paga una parte e il resto lo pagano le batterie, che
  //     si svuotano.
  //
  // Dire la prima mentre succede la seconda e' un errore nel verso ottimista.
  const produce = rami.some(r => (r.watt ?? 0) > 0);
  const nonEntra = totale <= 0;
  const spiegazione = !produce || !nonEntra ? null
    : carica == null || consumo == null ? 'non_so'
      : carica >= CARICA_PIENA_PCT && consumo < USCITA_FERMA_W ? 'piene'
        : 'scarica';

  // Il ramo della 220 dice da dove viene, quando si puo' sapere. La
  // **quantita'** resta una sottrazione: sapere da dove viene non la rende
  // misurata, e il bollino della stima resta.
  const ferma = minuti != null && minuti > FERMA_DOPO_MINUTI;
  if (ferma) {
    for (const r of rami) {
      r.attivo = false;
      r.spessore = SPESSORE.min;
      r.secondi = null;
    }
  }

  const origine = origineDella220(bluetti);
  for (const r of rami) {
    if (r.id !== 'rete') continue;
    r.origine = origine;
    if (origine) r.nome = NOME_220[origine];
    if (origine === 'bluetti') r.travaso = true;
  }

  // L'altro lato della figura: quanto esce dal pacco verso i consumi del
  // camper. **Un ramo solo e senza nome**, perche' si misura il pacco e non i
  // circuiti: i nomi -- frigo, Truma, pompa, luci, Starlink -- arrivano qui
  // dentro soltanto dopo la serata di taratura, misurati uno per volta.
  //
  // Nessuna soglia di rumore, al contrario della Bluetti: a camper fermo il
  // consumo non e' zero, la scatoletta stessa pesa qualche watt, e quel peso e'
  // una misura vera che il progetto calcola altrove (`costo_scatoletta`).
  // Mascherarla sotto una soglia la nasconderebbe.
  const uscita = { totale: consumo == null ? 0 : consumo, rami: [
    consumo == null
      // Non e' un ramo a zero: e' un ramo di cui non si sa niente. Uno zero
      // qui direbbe «non esce niente» mentre invece non lo sappiamo.
      ? { id: 'consumi', nome: 'Consumi camper', icona: '\u{1F3E0}', watt: null,
          ignoto: true, attivo: false, spessore: SPESSORE.min, secondi: null }
      : { id: 'consumi', nome: 'Consumi camper', icona: '\u{1F3E0}', watt: consumo,
          ...aspetto(consumo, RIFERIMENTO_USCITA_W) },
  ] };

  // La regola del fermo vale nei due versi: oltre la mezz'ora i puntini non
  // scorrono piu' da nessuna parte, e i numeri restano scritti con la loro
  // eta'. Un disegno in movimento su dati vecchi mente meglio di un numero
  // fermo, e questo e' vero anche di quel che esce.
  if (ferma) {
    for (const r of uscita.rami) {
      r.attivo = false;
      r.spessore = SPESSORE.min;
      r.secondi = null;
    }
  }

  // Lo stato si da' **anche a figura ferma**, al contrario del vecchio
  // `altrove` che si spegneva: con quello, una pagina ferma ricadeva su
  // «nessuna fonte sta caricando», che e' un'affermazione al presente su
  // letture di un'ora prima. Lo stato dice cos'era; il campo `ferma`, accanto,
  // dice a chi scrive la frase che non la deve mettere al presente.
  const fuori = { totale, rami, uscita, spiegazione };
  if (ferma) fuori.ferma = true;
  return fuori;
}
