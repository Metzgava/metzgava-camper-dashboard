// I consumi ricavati dallo **storico**, non dall'istante.
//
// Disegno: docs/superpowers/specs/2026-11-21-durata-consumo-vivo-design.md
//
// Perche' un file suo e non una sezione in piu' di `conti.js`: li' dentro si
// fanno i conti sull'**adesso**, leggendo `istantanee`. Qui si interroga
// `misure` -- l'archivio -- con una domanda diversa: non «quanto ora» ma
// «quanto negli ultimi tempi». Due tabelle, due domande, due responsabilita'.
//
// **Un istante non e' un consumo.** Il 21/11/2026 l'autonomia si calcolava
// dividendo i Wh residui per i watt letti in quel momento: aperta la pagina
// mentre parte il compressore del frigo, crollava a poche ore; un minuto dopo
// diceva quaranta. Nessuno dei due e' sbagliato come misura, e tutti e due
// sono inutili come durata.
//
// E il verso dell'errore conta: un'autonomia gonfiata da una lettura presa in
// un momento di quiete e' **una partenza rimandata**.
import { usciteDelPacco } from './storico.js';

// La finestra su cui si media.
//
// E' una **scelta di disegno**, come `RIFERIMENTO_USCITA_W` in flusso.js, e
// sta fra due esigenze opposte: abbastanza lunga da contenere qualche ciclo
// del frigo -- che da solo fa oscillare il consumo del doppio -- e abbastanza
// corta da raccontare **adesso** e non la mattinata.
export const FINESTRA_MINUTI = 120;

// Quanto dura un intervallo corto, quello su cui si taglia il verso prima di
// mediare.
//
// **Non e' `FINE_MAX` di storico.js, e non va riusato.** Quello e' il tetto
// del righello corto dei grafici, che devono coprire fino a centottanta
// giorni: quindici minuti. Qui la finestra e' di due ore, e a quindici minuti
// resterebbero otto intervalli -- troppo pochi per dire se la finestra e'
// coperta. La scatoletta legge ogni due minuti, quindi cinque minuti sono due
// o tre letture per batteria: un intervallo pieno senza essere grosso.
export const FINE_MINUTI = 5;

// Sotto questo numero di letture non c'e' una media, c'e' un campione.
// Due ore a due minuti con due batterie fanno un centinaio di righe: dieci e'
// un pavimento molto sotto il normale, e scatta solo quando qualcosa non va.
export const CAMPIONI_MINIMI = 10;

// Quanta parte della finestra deve avere dati.
//
// Il conteggio delle letture **non basta**: con la scatoletta spenta per
// un'ora e mezza su due, i campioni dell'ultima mezz'ora sono tanti e la
// finestra e' scoperta. Una media di dieci minuti spacciata per due ore e'
// una durata inventata, e nessun conteggio di campioni lo vede.
export const COPERTURA_MINIMA = 0.5;

// I watt plausibili per **una** Ective.
//
// Non e' una copia del setaccio di `ingresso.js`: quello vale per la
// grandezza `watt` di qualunque apparecchio, Bluetti da 1800 W compresa.
// Questa e' una domanda piu' stretta -- quanto puo' dare o prendere una
// LiFePO4 da 95 Ah a tredici volt -- e un paio di migliaia di watt e' il
// doppio del suo massimo dichiarato.
//
// Serve perche' il setaccio protegge quel che **entra da oggi**, mentre
// l'archivio ha anche un passato: una riga a -5000 W scritta da una versione
// precedente della scatoletta sposta la media, e con lei l'autonomia.
export const WATT_LECITI = [-2000, 2000];

const dentroIlLecito = r => {
  if (r?.grandezza !== 'watt') return true;
  const v = Number(r.valore);
  return Number.isFinite(v) && v >= WATT_LECITI[0] && v <= WATT_LECITI[1];
};

// La media di quel che esce dal pacco sulla finestra.
//
// Pura: riceve le righe di `misure`, non interroga il database. Chi la chiama
// fa la query, cosi' le prove possono darle una giornata inventata.
//
// Torna `watt: null`, e non zero, quando i campioni o la copertura non
// bastano: chi la usa ricade sull'istante **e lo dice**. Una durata su un
// istante dichiarato e' onesta; su un istante taciuto, no.
export function consumoRecente(righe, { da, a, batterie = [],
                                        fine = FINE_MINUTI } = {}) {
  const finestra_minuti = Math.max(0,
    Math.round((new Date(a).getTime() - new Date(da).getTime()) / 60000));
  const { netti, fini, letture, fine_minuti } = usciteDelPacco(
    (righe || []).filter(dentroIlLecito), { da, a, fine, batterie });

  const vuoto = { watt: null, campioni: letture, copertura: 0,
                  in_carica_minuti: 0, finestra_minuti };
  if (!fini || !fini.length) return vuoto;

  // Gli intervalli **pieni**: quelli in cui tutte le batterie hanno parlato.
  // La copertura si misura su questi, perche' una finestra con un buco non e'
  // affidabile qualunque cosa ci fosse dentro.
  const pieni = fini.filter(v => v != null);
  const copertura = pieni.length / fini.length;

  // **Si media sui soli intervalli in cui il pacco si stava scaricando.**
  //
  // Il disegno aveva scelto il contrario -- dividere per la finestra intera,
  // contando gli intervalli di carica come zero -- con la cura di dirlo nella
  // spiegazione. Una revisione del 21/11/2026 ha misurato quanto costava:
  // due ore di finestra con un'ora e cinquanta in carica davano **159 ore**
  // di autonomia dove la verita' era tredici, e ogni sera di sole la finestra
  // ne conteneva una di carica, quindi la durata usciva circa il doppio del
  // vero. Il vincolo della casa e' esplicito: mai una durata piu' lunga del
  // vero, e fra due conti plausibili si prende quello che non promette ore
  // che non ci sono.
  //
  // E non si perde niente di quel che la media era nata a proteggere: la
  // punta del compressore del frigo sta dentro una finestra **tutta in
  // scarica**, quindi i due conti coincidono. Si distinguono soltanto dove la
  // media sulla finestra intera era ingannevole.
  //
  // Quando la finestra era tutta in carica non c'e' una velocita' di
  // svuotamento da misurare: non si da' un numero, e chi lo usa ricade
  // sull'istante dichiarandolo.
  const scarichi = fini.filter(v => v != null && v > 0);
  // In carica vuol dire netto negativo, non «niente in uscita»: il taglio a
  // zero rende identici un pacco che carica e un pacco in equilibrio, e la
  // frase in pagina dice «di cui un'ora in carica».
  const in_carica_minuti = netti.filter(v => v != null && v < 0).length * fine_minuti;
  // Quanto della finestra e' stato davvero di scarica: e' il **divisore**
  // della media, quindi la frase in pagina deve poterlo dire. Dire «media
  // delle ultime due ore» quando la media e' su dieci minuti di scarica
  // sarebbe una spiegazione che non corrisponde al conto.
  const in_scarica_minuti = scarichi.length * fine_minuti;

  const abbastanza = letture >= CAMPIONI_MINIMI && copertura >= COPERTURA_MINIMA;
  return {
    watt: abbastanza && scarichi.length
      ? scarichi.reduce((s, v) => s + v, 0) / scarichi.length
      : null,
    campioni: letture,
    copertura,
    in_carica_minuti,
    in_scarica_minuti,
    finestra_minuti,
  };
}

// ---------------------------------------------------------------------------
// Il consumo a riposo, misurato dalle notti
// ---------------------------------------------------------------------------
//
// In tabella c'erano 11 W col bollino «misurato». Lo erano -- misurati il
// 16/11/2026 -- ma da allora in camper sono arrivate la scatoletta e
// Starlink. Un numero misurato una volta e poi mai piu' e' una **stima
// travestita da misura**, e invecchia senza dirlo.

// Oltre questi watt sui pannelli non e' notte. Non zero esatto: all'alba e al
// tramonto i pannelli danno qualche watt, e un confronto con lo zero
// spezzerebbe la notte in tanti pezzi corti.
export const SOLE_SPENTO_W = 2;

// Sotto questa durata un tratto di buio non e' una notte da cui ricavare un
// pavimento: ci sta dentro un solo ciclo del frigo, e il pavimento sarebbe
// quello di quel ciclo invece che quello della casa.
export const NOTTE_MINIMA_MINUTI = 120;

// Quanti giorni indietro si guarda.
export const NOTTI = 5;

// Il pavimento di una notte: il quinto piu' basso dei suoi intervalli.
//
// **Il riposo e' il pavimento, non la media.** Una media notturna che include
// un'ora di Truma non e' un consumo a riposo: e' la media di una notte in cui
// si e' consumato. Un quinto lascia fuori gli apparecchi che partono e si
// fermano -- frigo, pompa, stufa -- e tiene quel che c'e' sempre.
export const PAVIMENTO = 0.2;

const mediana = v => {
  if (!v.length) return null;
  const o = [...v].sort((x, y) => x - y);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

const percentile = (v, p) => {
  if (!v.length) return null;
  const o = [...v].sort((x, y) => x - y);
  return o[Math.min(o.length - 1, Math.floor(p * o.length))];
};

// Quanto consuma il camper quando non sta facendo niente.
//
// Pura, come `consumoRecente`: riceve le righe di `misure`, non interroga il
// database.
//
// Tre filtri, e ciascuno evita di misurare il consumo **al netto** di qualcosa
// che lo stava pagando:
//
//   1. **Solo di notte**, cioe' dove i pannelli sono scritti e sotto soglia.
//      Di giorno si misurerebbe il consumo meno il sole.
//   2. **Senza la Bluetti sul 12 V.** Se la sua uscita a 12 V eroga, parte del
//      consumo lo paga lei e il pavimento scende sotto il vero. Si accetta la
//      conseguenza: con la Bluetti accesa spesso il numero puo' mancare per
//      lunghi periodi, ed e' il comportamento giusto.
//   3. **Notti abbastanza lunghe**, per avere un pavimento e non un istante.
//
// E «notte» vuol dire `pannelli_w` **scritto** e basso. Una riga che manca non
// e' notte: il Bluetooth perde annunci anche in pieno giorno, e leggerla come
// notte farebbe entrare ore diurne nel campione. Questo evita anche di dover
// sapere che ora e' dove sei -- il server gira in UTC e il camper si sposta,
// e un orologio sbagliato di due ore metterebbe il tramonto nel campione.
export function consumoARiposo(righe, { a, batterie = [], notti = NOTTI,
                                        fine = FINE_MINUTI } = {}) {
  const fineA = new Date(a).getTime();
  const da = new Date(fineA - notti * 24 * 60 * 60000);
  const buone = (righe || []).filter(dentroIlLecito);
  const { netti, fini, letture, fine_minuti } = usciteDelPacco(
    buone, { da, a, fine, batterie });

  const vuoto = (perche_manca, campioni = letture) =>
    ({ watt: null, notti: 0, campioni, perche_manca });
  if (!fini || !fini.length) return vuoto('non ho letture delle batterie in archivio', 0);

  // Il sole e l'uscita a 12 V della Bluetti, intervallo per intervallo. Qui
  // serve soltanto sapere **se** c'erano e quanto, quindi una media semplice
  // per apparecchio basta.
  const lf = fine_minuti * 60000;
  const t0 = new Date(da).getTime();
  const sole = new Array(fini.length).fill(null);
  const dc = new Array(fini.length).fill(null);
  const conta = { sole: new Array(fini.length).fill(0), dc: new Array(fini.length).fill(0) };
  for (const r of buone) {
    const campo = r.grandezza === 'pannelli_w' ? 'sole'
      : r.grandezza === 'uscita_dc_w' ? 'dc' : null;
    if (!campo) continue;
    const v = Number(r.valore);
    if (!Number.isFinite(v)) continue;
    const t = new Date(r.quando).getTime();
    if (!Number.isFinite(t)) continue;
    const i = Math.floor((t - t0) / lf);
    if (i < 0 || i >= fini.length) continue;
    const dove = campo === 'sole' ? sole : dc;
    dove[i] = (dove[i] || 0) + v;
    conta[campo][i]++;
  }
  const media = (somme, quanti, i) =>
    (quanti[i] ? somme[i] / quanti[i] : null);

  // Senza nemmeno una lettura dei pannelli non si sa quando era notte, e
  // questo e' diverso dal non avere notti buone: la ragione va detta giusta,
  // o si cerca il guasto dove non e'.
  if (!conta.sole.some(n => n > 0)) {
    return vuoto('non so quando era notte: in archivio non ci sono letture dei pannelli');
  }

  // L'ultima lettura nota dell'uscita 12 V della Bluetti, riportata avanti
  // per il suo passo.
  //
  // **Un'assenza non e' uno zero**, e questa e' la regola che il disegno
  // scrive per i pannelli e che qui era rovesciata. La Bluetti e'
  // l'apparecchio le cui letture mancano piu' spesso: `bluetti.js` non
  // archivia quelle di ripiego, cioe' proprio quelle dei momenti in cui il
  // cloud rifiuta -- e una notte col frigo pagato dalla Bluetti e il cloud
  // muto veniva tenuta, col pavimento misurato **al netto** della Bluetti.
  //
  // Ma non si puo' nemmeno pretendere una riga per intervallo: il cloud scrive
  // ogni quindici minuti e gli intervalli sono da cinque, quindi due su tre
  // non ce l'avrebbero e nessuna notte sarebbe mai abbastanza lunga. Una
  // lettura vale per il suo passo, con un po' di margine; oltre, e' «non so».
  const PASSO_BLUETTI = Math.ceil(20 / fine_minuti);
  const dcNoto = new Array(fini.length).fill(null);
  for (let i = 0, eta = Infinity, ultimo = null; i < fini.length; i++) {
    const d = media(dc, conta.dc, i);
    if (d != null) { ultimo = d; eta = 0; } else { eta++; }
    dcNoto[i] = eta <= PASSO_BLUETTI ? ultimo : null;
  }

  // Gli intervalli di **notte**: buio sui pannelli, uscita 12 V della Bluetti
  // nota e a zero, pacco letto. Sono questi a definire quanto dura una notte;
  // se il pacco stava caricando la notte resta notte -- si vedra' piu' sotto.
  let senzaBluetti = 0;
  const buono = fini.map((w, i) => {
    if (w == null) return false;
    const s = media(sole, conta.sole, i);
    if (s == null || s > SOLE_SPENTO_W) return false;
    if (dcNoto[i] == null) { senzaBluetti++; return false; }
    return dcNoto[i] <= 0;
  });

  // I tratti continui di intervalli buoni, tenuti solo se abbastanza lunghi.
  const minimo = Math.max(1, Math.round(NOTTE_MINIMA_MINUTI / fine_minuti));
  const pavimenti = [];
  let campioniTenuti = 0;
  for (let i = 0; i < buono.length;) {
    if (!buono[i]) { i++; continue; }
    let k = i;
    while (k < buono.length && buono[k]) k++;
    if (k - i >= minimo) {
      // **Solo gli intervalli in cui il pacco si stava davvero scaricando.**
      //
      // E' il difetto Critico trovato in revisione il 21/11/2026, e il buco
      // stava nel disegno prima che nel codice: elencava le fonti invisibili
      // -- il sole, la Bluetti sul 12 V, il rele' separatore di fabbrica --
      // e si dimenticava **la piu' comune di tutte, il caricabatterie della
      // 220**. Il travaso dalla Bluetti passa per la sua uscita in alternata,
      // quindi nemmeno il filtro del 12 V lo vedeva.
      //
      // In quegli intervalli il netto e' negativo, il taglio lo porta a zero,
      // e il percentile del pavimento prende proprio i piu' bassi: bastava
      // caricare per piu' di un quinto della notte perche' il pavimento fosse
      // **zero watt**. Camper in piazzola attaccato alla colonnina per una
      // settimana -- cioe' la situazione da cui tutto questo e' nato -- e
      // tutte le notti avevano pavimento zero.
      //
      // La notte resta notte: quel che si scarta sono gli intervalli, non il
      // tratto, altrimenti un'ora di carica in mezzo spezzerebbe una notte
      // buona in due pezzi troppo corti.
      const dentro = [];
      for (let j = i; j < k; j++) if (netti[j] > 0) dentro.push(fini[j]);
      if (dentro.length) {
        pavimenti.push(percentile(dentro, PAVIMENTO));
        campioniTenuti += dentro.length;
      }
    }
    i = k;
  }

  if (!pavimenti.length) {
    // Due ragioni diverse, e dirle giuste evita di far cercare il guasto dove
    // non e'. Se gli intervalli notturni sono caduti perche' non sapevamo che
    // cosa facesse la Bluetti, e' quello che va detto.
    return vuoto(senzaBluetti > 0
      ? 'non so se la Bluetti stava alimentando il 12 V in quelle notti: '
        + 'dal cloud non arrivano letture della sua uscita a 12 V'
      : 'non ho notti abbastanza lunghe in cui il camper stesse davvero a riposo, '
        + 'senza sole, senza la Bluetti sul 12 V e senza niente che caricasse');
  }

  // Fra le notti si prende la **mediana** dei pavimenti, non la media: una
  // notte sola e strana -- una sera di ospiti, un apparecchio dimenticato
  // acceso -- non deve decidere il numero.
  return {
    watt: mediana(pavimenti),
    notti: pavimenti.length,
    campioni: campioniTenuti,
    perche_manca: null,
  };
}

// ---------------------------------------------------------------------------
// Il consumo a riposo, chiesto all'archivio
// ---------------------------------------------------------------------------
//
// `consumoARiposo` qui sopra e' pura e riceve le righe: cosi' le prove le
// possono dare una giornata inventata. Questa invece fa la query, e ha due
// accortezze che servono perche' `/api/stato` si apre spesso.
//
// **La somma la fa Postgres.** Cinque giorni di letture ogni due minuti, su
// quattro grandezze, sono piu' di diecimila righe: tirarle fuori tutte a ogni
// apertura di pagina sarebbe sciocco quando il raggruppamento lo sa fare il
// database. Si chiede la media per intervallo, per apparecchio e per
// grandezza, cioe' esattamente quel che la funzione pura rimetterebbe in fila
// da se'. E' lo stesso mestiere che fa gia' `/storia/uscite`.
//
// **E si tiene da parte.** Il consumo a riposo cambia una volta per notte, non
// ogni tre secondi. Senza questo, la pagina aperta rifarebbe lo stesso conto su
// cinque giorni di archivio a ogni occhiata.
const RESPIRO_RIPOSO = 15 * 60 * 1000;
let tenuto = { quando: 0, dato: null };

export async function riposoDallArchivio(q, batterie, { notti = NOTTI,
                                                        fine = FINE_MINUTI } = {}) {
  if (tenuto.dato && Date.now() - tenuto.quando < RESPIRO_RIPOSO) return tenuto.dato;
  const a = new Date();
  const sec = fine * 60;
  const righe = (await q(
    `SELECT to_timestamp(floor(extract(epoch from quando) / $1) * $1) AS quando,
            apparecchio, grandezza, avg(valore) AS valore
       FROM misure
      WHERE grandezza IN ('watt', 'pannelli_w', 'uscita_dc_w')
        AND quando > now() - ($2 || ' days')::interval
      GROUP BY 1, 2, 3
      ORDER BY 1`, [sec, String(notti)])).rows;
  const dato = consumoARiposo(righe, { a, batterie, notti, fine });
  tenuto = { quando: Date.now(), dato };
  return dato;
}

// Le prove che cambiano l'archivio sotto i piedi devono poter buttare quel che
// si e' tenuto: senza questo la seconda prova vedrebbe il numero della prima.
export function dimenticaIlRiposo() {
  tenuto = { quando: 0, dato: null };
}
