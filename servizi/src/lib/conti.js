// I conti che servono a decidere.
//
// Regola di questa casa: ogni risultato dice **su cosa si basa**. «misurato»
// vuol dire che i numeri che lo compongono vengono dal tuo impianto;
// «stima» che almeno uno viene da un catalogo. Un conto che sembra misurato e
// non lo e' fa prendere decisioni sbagliate con sicurezza — ed e' esattamente
// quello che e' successo il 16/11/2026, quando l'Orion XS dichiarava 6 A
// mentre le batterie ne ricevevano 26, per colpa di un rele' che nessun
// depliant conosce.
//
// E se un dato manca, il conto non si fa: si dice quale manca. Niente valori
// di comodo.
import { q } from './db.js';
import { FERMA_DOPO_MINUTI } from './flusso.js';
import { consumoRecente, riposoDallArchivio, FINESTRA_MINUTI } from './consumo.js';
import { limiteDellaPresa } from './colonnina.js';

export async function impianto() {
  const righe = (await q('SELECT chiave, valore, unita, nota, misurato FROM impianto ORDER BY chiave')).rows;
  const mappa = Object.fromEntries(righe.map(r => [r.chiave, r]));
  return { righe, mappa };
}

const num = v => (v == null ? '\u2014' : Math.round(v));
const val = (m, k) => (m[k] && m[k].valore != null ? Number(m[k].valore) : null);
const misurato = (m, ...chiavi) => chiavi.every(k => m[k]?.misurato === true);

// Un risultato. `base` e `perche` non sono decorazioni: sono la differenza fra
// un numero e un numero di cui ti puoi fidare.
const conto = (valore, unita, { base, perche, detto = null, mancano = [] }) =>
  ({ valore, unita, base, perche, detto, mancano });
const manca = (unita, mancano, perche) =>
  ({ valore: null, unita, base: 'incompleto', perche, detto: null, mancano });

export function dilloInOre(ore) {
  if (ore == null) return null;
  if (ore < 1) return `${Math.round(ore * 60)} min`;
  if (ore < 10) { const h = Math.floor(ore), m = Math.round((ore - h) * 60); return m ? `${h} h ${m} min` : `${h} h`; }
  if (ore < 48) return `${Math.round(ore)} ore`;
  return `${Math.round(ore / 24)} giorni`;
}

// Se la lettura della Bluetti e' di ripiego, i conti che la mescolano con le
// Ective non si fanno.
//
// Il 19/11/2026 il proprietario ha acceso il 220 dalla Bluetti e ha letto
// «esce 0 W, arriva 201 W»: una frase impossibile. Non era un errore di
// misura. Il cloud di Bluetti rifiutava da sei minuti e il server mostrava
// correttamente l'ultima lettura buona -- quella di diciassette secondi
// **prima** che il 220 venisse acceso. La Bluetti era ferma a un istante in
// cui non erogava niente, le Ective arrivavano fresche di due minuti dalla
// scatoletta, e il conto «quanto ne arriva» veniva fatto fra i due.
//
// Il dato non manca: e' vecchio. E' il confronto fra due istanti diversi a
// essere falso, e va detto cosi'.
export function bluettiNonConfrontabile(bluetti) {
  if (!bluetti?.vecchia) return null;
  const eta = bluetti.minuti == null ? null : `di ${bluetti.minuti} minuti fa`;
  return 'la Bluetti non si legge in questo momento: l\u2019ultima lettura buona e\u2019 '
    + `${eta || 'di prima'}, e confrontarla con le letture fresche delle Ective `
    + 'darebbe un conto falso';
}

// ---------------------------------------------------------------------------
// Quanto esce dalle Ective
// ---------------------------------------------------------------------------
//
// Disegno: docs/superpowers/specs/2026-11-20-uscita-ective-design.md
//
// **Il netto, non la somma delle negative.** Se una batteria prende +3 A dal
// sole e l'altra da' -25 A, dal pacco escono 22 A: quei 3 A si sono solo
// spostati fra le due, e contarli come consumo del camper sarebbe un numero
// che non esiste.
//
// **E i due versi vengono da qui, tutti e due.** Fino al 21/11/2026 non era
// cosi': questa funzione dava il verso in uscita, e il verso in ingresso lo
// dava `sommaPos`, che teneva soltanto le correnti positive. Da quell'
// asimmetria uscivano due numeri falsi, e il commento che stava qui diceva
// «il modo pulito sarebbe un'unica potenza netta da cui ricavare entrambi i
// versi, e vale la pena farlo un giorno». Quel giorno e' arrivato per due
// ragioni, trovate lo stesso pomeriggio:
//
//   - **A pacco in scarica** tutte le potenze sono negative, il filtro le
//     scartava tutte, e la pagina scriveva «oggi nessuno misura la loro
//     corrente» su una corrente che misuriamo. Il proprietario l'ha visto con
//     le Ective al 95 % e 98 % e la figura che diceva «sono gia' cariche».
//   - **Con una in carica e l'altra in scarica** -- +11 A e -4 A -- la somma
//     delle positive dava 144 W «in ingresso» col bollino misurato, mentre nel
//     pacco ne entravano 92. I 52 W di differenza non entravano da nessuna
//     parte: si spostavano fra le due batterie. Era lo stesso numero inventato
//     che il paragrafo qui sopra evita per il verso in uscita.
//
// `sommaPos` esiste ancora, piu' sotto, ma solo per il sole e l'alternatore:
// per loro sommare le positive e' lecito, perche' sono apparecchi diversi e
// non due facce dello stesso serbatoio.
//
// Una riga e' una batteria se manda le celle: SmartSolar e Orion XS stanno
// nella stessa tabella e hanno anche loro volt e ampere.
const eBatteria = r => !!r?.dati?.celle_mv;

// Un numero con la virgola, come lo scrive il resto della pagina. A mano e non
// con `toLocaleString`: quello dipende dai dati di lingua compilati dentro
// Node, e un server con l'ICU ridotto tornerebbe il punto senza protestare --
// «13.08 V» nella spiegazione e «13,08 V» nel quadrante due centimetri sopra,
// che nella stessa scheda sembra un guasto.
const virgola = (v, d) => v.toFixed(d).replace('.', ',');

// Oltre questo scarto fra la lettura di una batteria e quella dell'altra, la
// loro somma non e' piu' una fotografia sola e lo si dice.
const SCARTO_MAX_MINUTI = 10;
const n = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function uscitaEctive(righe) {
  const batterie = (righe || []).filter(eBatteria);
  const con = batterie
    .map(r => ({ nome: r.apparecchio, volt: n(r.dati.volt), ampere: n(r.dati.ampere),
                 capacita_ah: n(r.dati.capacita_ah), carica: n(r.dati.carica),
                 quando: r.quando }))
    .filter(b => b.volt != null && b.ampere != null);

  const vuoto = { watt: null, ampere: null, netto: null, carica_pacco: null,
                  residuo_wh: null, manca_wh: null, ore: null,
                  lette: 0, totali: batterie.length, scarto_minuti: null,
                  per_batteria: [] };
  if (!con.length) return vuoto;

  // Cambiato di segno: in pagina «esce» e' un numero positivo. Il segno della
  // singola batteria invece resta il suo, perche' la differenza fra le due
  // righe e' l'unica cosa interessante quando una carica e l'altra scarica.
  const netto = -con.reduce((s, b) => s + b.volt * b.ampere, 0);
  // Un netto negativo vuol dire che nel pacco sta **entrando** corrente:
  // allora non esce niente, e «niente» si scrive zero. Il null di qui sopra e'
  // riservato al non sapere, cioe' a nessuna lettura.
  const watt = Math.max(0, netto);
  const ampere = Math.max(0, -con.reduce((s, b) => s + b.ampere, 0));

  // La carica del pacco, per chi deve decidere se chiamarlo **pieno**.
  //
  // Serve alla figura, e non e' un vezzo: il 21/11/2026 la pagina scriveva
  // «sono gia' cariche» mentre i due quadranti dicevano 95 % e 98 %. Senza
  // questo numero la figura non aveva modo di sapere che stava mentendo.
  //
  // Media semplice e non pesata sulla capacita': le due Ective sono gemelle,
  // e pesare per una capacita' che una delle due puo' non dichiarare
  // introdurrebbe un `null` dove serve un numero.
  const conCarica = con.filter(b => b.carica != null);
  const carica_pacco = conCarica.length
    ? conCarica.reduce((s, b) => s + b.carica, 0) / conCarica.length
    : null;

  // I Wh residui coi volt **misurati** adesso, non coi 12,8 nominali della
  // tabella dell'impianto: la tensione la si sta leggendo, sarebbe sciocco non
  // usarla. Una batteria che non dichiara capacita' o carica non si stima.
  const conCapacita = con.filter(b => b.capacita_ah != null && b.carica != null);
  const residuo_wh = conCapacita.length
    ? conCapacita.reduce((s, b) => s + b.capacita_ah * (b.carica / 100) * b.volt, 0)
    : null;
  // E quanti Wh **mancano** per arrivare in cima, che e' il numero da cui si
  // ricava un tempo di ricarica. Simmetrico a `residuo_wh` e misurato come
  // lui: capacita' e carica dichiarate dalla batteria, volt letti adesso --
  // nessun Ah di catalogo e nessun 12,8 nominale.
  const manca_wh = conCapacita.length
    ? conCapacita.reduce((s, b) => s + b.capacita_ah * ((100 - b.carica) / 100) * b.volt, 0)
    : null;

  // Quanto distano fra loro i due istanti sommati. `istantanee` tiene
  // l'**ultima** lettura di ciascuna batteria: quella che smette di rispondere
  // non sparisce e non resta senza numeri, resta li' coi suoi di prima e
  // invecchia da sola mentre l'altra e' fresca. Un netto fatto cosi' mescola
  // due momenti -- lo stesso errore che il 19/11 ha prodotto «esce 0 W, arriva
  // 201 W» fra Bluetti ed Ective, qui dentro lo stesso pacco.
  //
  // Null se c'e' una sola batteria, o se a una manca la data: non sapere non
  // e' «lontane».
  const istanti = con.map(b => (b.quando == null ? NaN : new Date(b.quando).getTime()))
    .filter(Number.isFinite);
  const scarto_minuti = con.length > 1 && istanti.length === con.length
    ? (Math.max(...istanti) - Math.min(...istanti)) / 60000
    : null;

  return {
    watt,
    ampere,
    // Il netto con il segno: positivo quando dal pacco **esce** corrente,
    // negativo quando ne **entra**. `watt` qui sopra e' questo numero tagliato
    // a zero, e fino al 21/11/2026 il taglio buttava via la meta' negativa --
    // cioe' esattamente il verso che serviva all'altra parte della pagina.
    netto,
    carica_pacco,
    residuo_wh,
    manca_wh,
    scarto_minuti,
    // Niente in uscita, nessuna autonomia da dare -- e nemmeno un infinito,
    // che sarebbe falso: finisce appena si accende una luce.
    ore: watt > 0 && residuo_wh != null ? residuo_wh / watt : null,
    lette: con.length,
    totali: batterie.length,
    per_batteria: con.map(b => ({ nome: b.nome, volt: b.volt, ampere: b.ampere,
                                  watt: b.volt * b.ampere })),
  };
}

// Quanti minuti ha la piu' recente lettura delle Ective, o null se non ce ne
// sono. Non sapere l'eta' non e' «vecchio»: e' non sapere, e la figura della
// carica continua come prima -- uno zero la spegnerebbe per sempre.
// Quanto stanno prendendo i carichi del camper. **Dedotto**, perche' nessuno
// li misura: non c'e' un contatore sulla linea a 12 V.
//
// L'app sa solo quanto esce dalle batterie, e quando il sole copre tutto
// dalle batterie non esce niente -- e la figura dice «niente», che e' vero ma
// si legge come «non consuma nulla». Il 24/11/2026: «ora vedo flussi da sole
// ma non consumi, come mai».
//
// Una formula sola per i due versi, perche' `entra` ed `esce` sono le due
// facce dello stesso netto e uno dei due e' sempre zero:
//
//     consumi = quel che esce dal pacco + le fonti - quel che entra nel pacco
//
// **E un caso in cui non si deduce niente.** Se entra piu' di quanto le fonti
// viste diano, c'e' una fonte che non vediamo -- e' la stessa differenza da
// cui si ricava il ramo della 220 -- e quella potrebbe alimentare anche i
// carichi. Un caricatore da 50 W mentre i consumi ne prendono 100 non si vede
// da qui: li' la risposta e' «non so», non «zero».
export function consumiDedotti({ entra, esce, sole, motore } = {}) {
  const n = v => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const dentro = n(entra), fuori = n(esce), s = n(sole), m = n(motore);
  // Serve sapere tutto: una fonte ignota rende ignota la sottrazione.
  if (dentro == null || fuori == null || s == null || m == null) return null;
  // Entra piu' di quanto si veda arrivare: c'e' una fonte nascosta, e non si
  // puo' dire quanto dei suoi watt vada ai carichi.
  if (dentro > s + m) return null;
  // Il fondo a zero: le misure vengono da apparecchi diversi in istanti
  // diversi, e qualche watt al rovescio e' rumore, non un consumo negativo.
  return { watt: Math.max(0, fuori + s + m - dentro), base: 'dedotto' };
}

export function etaEctiveMinuti(righe, adesso = Date.now()) {
  const quando = (righe || [])
    .filter(eBatteria)
    // `quando` assente va scartato **prima**: `new Date(null)` non e' una data
    // non valida, e' il 1970, e `Number.isFinite` lo lascia passare. Una riga
    // cosi' darebbe cinquant'anni di eta' invece di «non so», e la figura
    // della carica resterebbe ferma per sempre. La versione che stava in
    // `routes/stato.js` aveva questo baco, e la prova l'ha preso.
    .filter(r => r.quando != null)
    .map(r => new Date(r.quando).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return quando == null ? null : (adesso - quando) / 60000;
}

export async function tuttiIConti(bluetti) {
  const { mappa: m } = await impianto();
  const b = (bluetti?.apparecchi || [])[0] || null;
  const soc = b?.carica ?? null;

  const capacita = val(m, 'bluetti_wh');
  const chargerW = val(m, 'charger_w');
  const acW = val(m, 'bluetti_carica_ac_w');
  const ectiveAh = val(m, 'ective_ah');
  const ectiveV = val(m, 'ective_v');
  const rendimento = val(m, 'rendimento_bluetti_ective');
  const fermoW = val(m, 'consumo_fermo_w');
  // Gli ampere della presa a cui sei attaccato. Non e' un dato fisso del
  // camper: cambia a ogni piazzola, e per questo si sceglie accanto al tempo
  // di ricarica invece che nella tabella dei dati fissi.
  const colonninaA = val(m, 'colonnina_a');
  const scatolettaW = val(m, 'scatoletta_w');

  const out = {};

  // ---- quanta corrente c'e' ----
  out.carica_residua = soc == null || capacita == null
    ? manca('Wh', [soc == null ? 'carica della Bluetti' : 'bluetti_wh'],
        'Serve la carica letta dal cloud e la capacita’ dichiarata.')
    : conto(Math.round(capacita * soc / 100), 'Wh', {
        base: misurato(m, 'bluetti_wh') ? 'misurato' : 'stima',
        perche: `${soc} % di ${capacita} Wh`,
        detto: `${(capacita * soc / 100 / 1000).toFixed(2)} kWh`,
      });

  const mancaWh = soc == null || capacita == null ? null : Math.round(capacita * (100 - soc) / 100);
  out.manca_alla_piena = mancaWh == null
    ? manca('Wh', ['carica della Bluetti'], 'Serve la carica letta dal cloud.')
    : conto(mancaWh, 'Wh', {
        base: misurato(m, 'bluetti_wh') ? 'misurato' : 'stima',
        perche: `${100 - soc} % di ${capacita} Wh`,
        detto: `${(mancaWh / 1000).toFixed(2)} kWh`,
      });

  // ---- quanto consuma adesso ----
  const fuori = b && (b.uscita_ac_w != null || b.uscita_dc_w != null)
    ? (b.uscita_ac_w || 0) + (b.uscita_dc_w || 0) : null;
  const dentro = b && (b.fotovoltaico_w != null || b.rete_w != null)
    ? (b.fotovoltaico_w || 0) + (b.rete_w || 0) : null;
  out.saldo_adesso = fuori == null && dentro == null
    ? manca('W', ['letture della Bluetti'], 'Serve una lettura dal cloud.')
    : conto((dentro || 0) - (fuori || 0), 'W', {
        base: 'misurato',
        perche: `entra ${dentro ?? 0} W (fotovoltaico + rete), esce ${fuori ?? 0} W (AC + DC)`,
      });

  // ---- ore di motore col Charger ----
  out.ore_motore = mancaWh == null
    ? manca('h', ['carica della Bluetti'], 'Serve la carica letta dal cloud.')
    : chargerW == null
      ? manca('h', ['charger_w'], 'Non so quanti watt dia il Charger 2 dall’alternatore. Mettilo in Impianto e il conto compare.')
      : conto(mancaWh / chargerW, 'h', {
          base: misurato(m, 'charger_w', 'bluetti_wh') ? 'misurato' : 'stima',
          perche: `${mancaWh} Wh da rimettere, a ${chargerW} W di carica`,
          detto: dilloInOre(mancaWh / chargerW),
        });

  // ---- tempo da colonnina ----
  //
  // Disegno: docs/superpowers/specs/2026-11-21-colonnina-ampere-design.md
  //
  // **Il piu' piccolo fra i due limiti**, e si dichiara quale ha vinto. Fino
  // al 21/11/2026 questo conto usava sempre `bluetti_carica_ac_w` -- 1800 W,
  // quel che la Bluetti sa prendere -- mentre in campeggio il limite e' quasi
  // sempre la colonnina: 4 A sono 920 W. Su una presa da 4 A prometteva una
  // ricarica doppia di quella vera, nella direzione ottimista.
  const presaBluetti = limiteDellaPresa(acW, colonninaA);
  const comeDallaPresa = l => `a ${Math.round(l.watt)} W`
    + (l.chi === 'presa'
      ? ` — e' la presa da ${colonninaA} A a frenare, non l’apparecchio`
      : l.presa_w != null
        ? ` — la presa da ${colonninaA} A ne darebbe ${Math.round(l.presa_w)}, quindi non e’ lei a frenare`
        : ' dalla presa');
  out.ore_colonnina = mancaWh == null
    ? manca('h', ['carica della Bluetti'], 'Serve la carica letta dal cloud.')
    : presaBluetti.watt == null
      ? manca('h', ['bluetti_carica_ac_w'], 'Non so a quanti watt carica dalla 220.')
      : conto(mancaWh / presaBluetti.watt, 'h', {
          base: misurato(m, 'bluetti_carica_ac_w', 'bluetti_wh') ? 'misurato' : 'stima',
          perche: `${mancaWh} Wh da rimettere, ${comeDallaPresa(presaBluetti)}`,
          detto: dilloInOre(mancaWh / presaBluetti.watt),
        });
  // Chi ha vinto viaggia in un campo suo, non sepolto nella spiegazione: la
  // pagina lo mostra come avviso, ed e' la sola parte di quel testo che non si
  // legga gia' nel numero accanto.
  out.ore_colonnina.chi = presaBluetti.chi;
  out.ore_colonnina.presa_w = presaBluetti.presa_w;


  // ---- quante ore di Truma elettrica ci stanno nella Bluetti ----
  //
  // La resistenza della Combi tira 900 o 1800 W dalla 230 V. Se quella 230 V
  // la fa l'inverter della Bluetti, ogni ora di stufa si paga in carica: e' il
  // conto che dice se accendere l'elettrico in sosta libera ha senso o no.
  //
  // Due avvertenze senza le quali il numero inganna, e che la pagina ripete:
  //   - e' tempo di **resistenza accesa**, non di stufa accesa. La Combi
  //     stacca quando arriva a temperatura, quindi l'orologio dura di piu';
  //   - la ventola sta sui 12 V delle Ective, non sulla Bluetti: qui non c'e'.
  const rendInv = val(m, 'rendimento_inverter_bluetti');
  for (const [chiave, potenza] of [['ore_truma_el1', 'truma_el1_w'], ['ore_truma_el2', 'truma_el2_w']]) {
    const w = val(m, potenza);
    const residuoWh = out.carica_residua.valore;
    out[chiave] = residuoWh == null
      ? manca('h', ['carica della Bluetti'], 'Serve la carica letta dal cloud.')
      : w == null || rendInv == null
        ? manca('h', [potenza, 'rendimento_inverter_bluetti'].filter(k => val(m, k) == null),
            'Servono i watt della resistenza e il rendimento dell’inverter.')
        : conto(residuoWh * rendInv / w, 'h', {
            base: misurato(m, potenza, 'rendimento_inverter_bluetti', 'bluetti_wh') ? 'misurato' : 'stima',
            perche: `${Math.round(residuoWh)} Wh in Bluetti, ${w} W di resistenza, inverter al ${Math.round(rendInv * 100)} %`,
            detto: `${dilloInOre(residuoWh * rendInv / w)} di resistenza accesa`,
          });
  }

  // ---- da dove arriva la carica, e quando sara' piena ----
  //
  // La Bluetti lo dice da sola: due ingressi distinti, la 220 e la continua, e
  // i minuti che le restano per arrivare piena. Quei minuti sono una sua stima
  // sul ritmo **vero** di adesso: meglio di qualunque divisione che potremmo
  // fare noi coi watt di catalogo, ed e' il motivo per cui si preferisce il suo
  // numero al nostro quando c'e'.
  //
  // Un'avvertenza che la pagina deve ripetere: sulla Bluetti il Charger del
  // motore entra dalla **stessa porta** dei pannelli. Il numero non distingue
  // i due, e attribuirlo a occhio sarebbe peggio che dire che non si sa.
  const rete = b?.rete_w ?? null;
  const continua = b?.fotovoltaico_w ?? null;
  const entra = rete == null && continua == null ? null : (rete || 0) + (continua || 0);

  out.ingresso = entra == null
    ? manca('W', ['letture della Bluetti'], 'Serve il collegamento al cloud.')
    : conto(entra, 'W', {
        base: 'misurato',
        perche: `${Math.round(rete || 0)} W dalla 220, ${Math.round(continua || 0)} W in continua`,
        detto: entra === 0 ? 'non sta caricando'
          : [rete ? `${Math.round(rete)} W dalla 220` : null,
             continua ? `${Math.round(continua)} W in continua` : null].filter(Boolean).join(' + '),
      });
  // I due pezzi viaggiano insieme al totale: servono a disegnare la barra, e
  // un conto che porta con se' i suoi addendi si verifica a occhio.
  out.ingresso.rete_w = rete;
  out.ingresso.continua_w = continua;

  const minutiPiena = b?.alla_carica_minuti ?? null;
  const nostraStima = out.manca_alla_piena.valore != null && entra ? out.manca_alla_piena.valore / entra : null;
  out.alla_piena = minutiPiena
    ? conto(minutiPiena / 60, 'h', {
        base: 'misurato',
        perche: 'lo dice la Bluetti stessa, sul ritmo di adesso',
        detto: dilloInOre(minutiPiena / 60),
      })
    : nostraStima != null
      ? conto(nostraStima, 'h', {
          base: misurato(m, 'bluetti_wh') ? 'misurato' : 'stima',
          perche: `${out.manca_alla_piena.valore} Wh da rimettere, a ${Math.round(entra)} W in ingresso`,
          detto: dilloInOre(nostraStima),
        })
      : manca('h', ['letture della Bluetti'],
          entra === 0 ? 'Non sta caricando: non c\u2019e\u2019 nessun ritmo da cui partire.'
            : 'Serve il collegamento al cloud.');

  // ---- la catena: quanto esce dalla Bluetti, quanto arriva alle Ective ----
  //
  // Accesa l'uscita in alternata, la Bluetti serve i 220 del camper: le prese,
  // e il caricabatterie che riempie le Ective. Il conto e' «di quello che esce
  // da una parte, quanto arriva dall'altra».
  //
  // Ma **non tutto quello che entra nelle Ective viene dalla Bluetti**: ci
  // entrano anche il sole e l'alternatore. In una giornata di sole, senza
  // separarli, il conto direbbe che il caricabatterie fa miracoli. Quindi si
  // tolgono prima le due fonti che si misurano, e quel che resta e' la 220.
  //
  // E la differenza fra uscita e arrivo non e' solo perdita del
  // caricabatterie: sulla 220 c'e' attaccato anche il resto del camper. La
  // pagina lo dice, perche' chiamarla «rendimento» sarebbe falso.
  const vive = (await q('SELECT apparecchio, dati, quando FROM istantanee')).rows;
  const pot = (d, v = 'volt', a = 'ampere') =>
    d && d[v] != null && d[a] != null ? Number(d[v]) * Number(d[a]) : null;
  // La somma delle **sole positive**, che qui sotto si usa per il sole e per
  // l'alternatore e non per il pacco.
  //
  // Per loro e' lecita: sono apparecchi diversi, ciascuno con la sua misura,
  // e sommarne due che producono e' una somma vera. Per il **pacco** non lo
  // era: due batterie non sono due misure indipendenti, sono due facce dello
  // stesso serbatoio, e sommarne solo le positive conta come \u00abin ingresso\u00bb
  // anche la corrente che si sposta dall'una all'altra. Da qui il netto.
  const sommaPos = (righe, f) => {
    const n = righe.map(f).filter(x => x != null && x > 0);
    return n.length ? n.reduce((s, x) => s + x, 0) : null;
  };
  const batterie = vive.filter(r => r.dati?.celle_mv);

  // I due versi del pacco nascono qui, da un numero solo con il segno.
  const u = uscitaEctive(vive);

  // Il consumo **recente**, dall'archivio: e' quello su cui si calcolano le
  // durate. Si chiede solo la grandezza che serve e solo la finestra che
  // serve, cosi' la query resta piccola anche con un archivio di mesi.
  const finestraDa = new Date(Date.now() - FINESTRA_MINUTI * 60000);
  const recente = consumoRecente(
    (await q(`SELECT quando, apparecchio, grandezza, valore FROM misure
               WHERE grandezza = 'watt' AND quando > $1`, [finestraDa])).rows,
    { da: finestraDa, a: new Date(), batterie: batterie.map(r => r.apparecchio) });

  // Il consumo **a riposo**, ricavato dalle notti senza sole e senza la
  // Bluetti sul 12 V. La somma la fa Postgres e il risultato si tiene da
  // parte per un quarto d'ora: cambia una volta per notte, non ogni tre
  // secondi.
  const riposo = await riposoDallArchivio(q, batterie.map(r => r.apparecchio));
  const etaEctive = etaEctiveMinuti(vive);
  // Oltre la mezz'ora il numero resta scritto con la sua eta': e' l'eta' che
  // va detta, non il valore che va nascosto. Stessa regola della figura della
  // carica, stessa soglia -- col passo a due minuti sono quindici letture
  // perse, e uno o due giri saltati sono normali.
  const vecchie = etaEctive != null && etaEctive > FERMA_DOPO_MINUTI;
  // Mezzo pacco spacciato per il pacco intero e' un consumo dimezzato, cioe'
  // un'autonomia doppia: l'errore ottimista, il solo che fa restare fermi una
  // notte in piu' contando su ore che non ci sono. Va detto.
  //
  // Sta in un campo suo e non sepolto nella spiegazione, perche' la pagina lo
  // mostra in ambra: e' la sola parte di quel testo che non si legga gia' nei
  // due quadranti due centimetri sopra.
  const mezzoPacco = u.lette > 0 && u.lette < u.totali;
  // Due minuti di scarto sono il passo normale della scatoletta. Dieci sono
  // cinque giri persi da una delle due, ed e' il momento in cui la somma
  // smette di essere una fotografia sola. Un avviso che compare sempre e' un
  // avviso che nessuno legge.
  const lontane = u.scarto_minuti != null && u.scarto_minuti > SCARTO_MAX_MINUTI;
  const avviso = mezzoPacco
    ? `Ha risposto ${u.lette} batteria su ${u.totali}: dal pacco intero esce di pi\u00f9, e le ore sono meno di cos\u00ec.`
    : lontane
      ? `Le due batterie non sono state lette insieme: fra un\u2019istante e l\u2019altro ci sono `
        + `${Math.round(u.scarto_minuti)} minuti, e la somma di due momenti diversi non \u00e8 una fotografia sola.`
      : null;

  // Nel pacco **entra** corrente quando il netto e' negativo. Quanta, e' il
  // netto cambiato di segno; quando il netto e' positivo o zero non entra
  // niente, e \u00abniente\u00bb si scrive **zero**, non `\u2014`.
  const entraEctive = u.netto == null ? null : Math.max(0, -u.netto);
  const dalSole = sommaPos(vive.filter(r => r.dati?.pannelli_w != null), r => pot(r.dati));
  const dalMotore = sommaPos(vive.filter(r => r.dati?.uscita_ampere != null),
    r => pot(r.dati, 'uscita_volt', 'uscita_ampere'));
  // Il ramo dedotto si ottiene per differenza da quel che **entra**. Se non
  // entra niente la differenza non esiste, e resta `null` -- cioe' ignoto, non
  // zero: uno zero direbbe che la 220 l'abbiamo esclusa, e non l'abbiamo
  // esclusa. Un caricatore da 50 W mentre i consumi ne prendono 100 non si
  // vede da qui.
  const dalla220 = entraEctive == null || entraEctive <= 0 ? null
    : Math.max(0, entraEctive - (dalSole || 0) - (dalMotore || 0));

  // Quanto stanno prendendo i carichi del camper. Dedotto: nessuno li misura,
  // e quando il sole copre tutto dalle batterie non esce niente -- la figura
  // diceva «niente» e si leggeva come «non consuma nulla». La regola sta in
  // `consumiDedotti`, qui sopra, dove girano le prove.
  out.consumi_camper = consumiDedotti({
    entra: entraEctive, esce: u.watt, sole: dalSole, motore: dalMotore });

  out.fonti_ective = entraEctive == null
    ? manca('W', ['letture delle Ective'], 'Arriva con la scatoletta: oggi nessuno misura la loro corrente.')
    : entraEctive > 0
      ? conto(entraEctive, 'W', {
          base: 'misurato',
          perche: `${Math.round(dalSole || 0)} W dal sole, ${Math.round(dalMotore || 0)} W dall\u2019alternatore, `
            + `${Math.round(dalla220)} W dalla 220 \u2014 l\u2019ultimo per differenza`,
          detto: `${Math.round(entraEctive)} W in ingresso`,
        })
      // Uno **zero misurato**, non un \u00abnon so\u00bb. Fino al 21/11/2026 questo
      // caso finiva nel `manca` di sopra, e la pagina diceva \u00aboggi nessuno
      // misura la loro corrente\u00bb mentre la corrente la misuravamo benissimo:
      // era negativa. Il proprietario l'ha trovato con le Ective al 95 e 98 %.
      : conto(0, 'W', {
          base: 'misurato',
          perche: `dal pacco esce corrente invece di entrarne: ${Math.round(u.netto)} W in uscita`,
          detto: 'niente entra',
        });
  out.fonti_ective.sole_w = dalSole;
  out.fonti_ective.motore_w = dalMotore;
  out.fonti_ective.rete_w = dalla220;
  // Nasce dallo stesso netto dell'uscita, quindi eredita la stessa fragilita':
  // mezzo pacco, o due letture lontane, falsano questo numero come falsano
  // quello. L'avviso stava solo sull'uscita.
  out.fonti_ective.avviso = avviso;

  const esceAc = b?.uscita_ac_w ?? null;
  const nonConfrontabile = bluettiNonConfrontabile(bluetti);
  out.catena = nonConfrontabile
    ? manca('%', ['una lettura fresca della Bluetti'], nonConfrontabile)
    : esceAc == null
    ? manca('%', ['letture della Bluetti'], 'Serve il collegamento al cloud.')
    : dalla220 == null
      ? manca('%', ['letture delle Ective'],
          `Dalla Bluetti escono ${Math.round(esceAc)} W in alternata. Quanti ne arrivino alle Ective si sapr\u00e0 con la scatoletta.`)
      : esceAc <= 0
        ? conto(null, '%', { base: 'incompleto', perche: 'la Bluetti non sta erogando in alternata', detto: 'ferma' })
        : conto(dalla220 / esceAc * 100, '%', {
            // Non «misurato»: i watt lo sono, l'**attribuzione** no. Che quei
            // 335 W vengano dal caricabatterie e non da una terza fonte che
            // non vediamo e' una deduzione, e va detto.
            base: 'stima',
            perche: `${Math.round(esceAc)} W escono dalla Bluetti, ${Math.round(dalla220)} W arrivano alle Ective`,
            detto: `${Math.round(dalla220 / esceAc * 100)} % arriva alle batterie`,
          });
  // Con una lettura di ripiego anche questo numero va taciuto: messo accanto
  // ai watt freschi delle Ective, uno zero di sei minuti fa non e' un dato,
  // e' una contraddizione.
  out.catena.esce_w = nonConfrontabile ? null : esceAc;
  out.catena.entra_w = dalla220;

  // ---- quanta Bluetti serve per le Ective ----
  // Questo conto si puo' fare anche senza sapere come stanno le Ective: il
  // numero utile e' il cambio, «un punto di Ective quanti punti di Bluetti
  // costa». Quando la scatoletta leggera' le batterie, diventera' una cifra
  // sola invece di un cambio.
  const ectiveWh = ectiveAh != null && ectiveV != null ? ectiveAh * ectiveV : null;
  out.cambio_ective = ectiveWh == null || rendimento == null || capacita == null
    ? manca('%', ['ective_ah', 'ective_v', 'rendimento_bluetti_ective'].filter(k => val(m, k) == null),
        'Servono la capacita’ delle Ective e il rendimento della catena.')
    : conto((ectiveWh / 100) / rendimento / capacita * 100, '% di Bluetti per 1 % di Ective', {
        base: misurato(m, 'ective_ah', 'ective_v', 'rendimento_bluetti_ective') ? 'misurato' : 'stima',
        perche: `le Ective tengono ${Math.round(ectiveWh)} Wh; con un rendimento di ${rendimento} ogni loro punto costa ${Math.round(ectiveWh / 100 / rendimento)} Wh alla Bluetti`,
        detto: `1 % di Ective ≈ ${((ectiveWh / 100) / rendimento / capacita * 100).toFixed(2)} % di Bluetti`,
      });
  out.ective_piene_da_vuote = ectiveWh == null || rendimento == null || capacita == null
    ? manca('%', [], 'Come sopra.')
    : conto(ectiveWh / rendimento / capacita * 100, '%', {
        base: misurato(m, 'ective_ah', 'ective_v', 'rendimento_bluetti_ective') ? 'misurato' : 'stima',
        perche: `riempire le Ective da zero chiede ${Math.round(ectiveWh / rendimento)} Wh alla Bluetti`,
        detto: `${Math.round(ectiveWh / rendimento / capacita * 100)} % di Bluetti` +
          (ectiveWh / rendimento > capacita ? ' — piu’ di quanto la Bluetti contenga: non ce la fa in un colpo' : ''),
      });

  // ---- quanto manca allo scarico, col consumo di adesso ----
  //
  // Non e' la stessa cosa dell'autonomia che dichiara la Bluetti: quella la
  // calcola lei, sui propri consumi. Questa si fa su quel che **sta uscendo
  // adesso**, al netto di quel che entra. Quando i due numeri non coincidono,
  // la differenza e' informazione: vuol dire che sta contando qualcosa che noi
  // non vediamo (il suo autoconsumo) o che il carico e' appena cambiato.
  const netto = dentro == null && fuori == null ? null : (dentro || 0) - (fuori || 0);
  const residuo = out.carica_residua.valore;
  if (residuo == null || netto == null) {
    out.tempo_residuo_bluetti = manca('h', ['letture della Bluetti'], 'Servono la carica e i watt in uscita.');
  } else if (netto >= 0) {
    out.tempo_residuo_bluetti = conto(null, 'h', {
      base: 'misurato',
      perche: (fuori || 0) === 0
        ? 'non sta erogando niente: finche\u2019 resta cosi\u2019 non si scarica'
        : `entra piu\u2019 di quanto esce (${num(dentro)} W contro ${num(fuori)} W): si sta caricando`,
      detto: (fuori || 0) === 0 ? 'non si scarica' : 'si sta caricando',
    });
  } else {
    const ore = residuo / -netto;
    const suo = b?.autonomia_minuti ? b.autonomia_minuti / 60 : null;
    out.tempo_residuo_bluetti = conto(ore, 'h', {
      base: misurato(m, 'bluetti_wh') ? 'misurato' : 'stima',
      perche: `${residuo} Wh a ${num(-netto)} W netti`
        + (suo ? ` \u00b7 lei ne dichiara ${dilloInOre(suo)}${Math.abs(suo - ore) / Math.max(suo, ore) > 0.25 ? ', e la differenza vuol dire che conta qualcosa che non vedo' : ''}` : ''),
      detto: dilloInOre(ore),
    });
  }

  // ---- quanto esce dalle Ective, e per quanto ----
  //
  // Fino al 20/11/2026 queste due righe erano la frase \u00abil numero arriva
  // quando la scatoletta sara' a bordo\u00bb -- vera quando l'ho scritta, falsa da
  // quando la scatoletta c'e'. E' la stessa bugia involontaria che il 19/11
  // avevamo tolto dalla riga degli apparecchi attesi, sopravvissuta qui.
  //
  // Il consumo e' gia' al netto del sole e dell'alternatore: la corrente che
  // si legge sulle batterie e' quel che resta dopo di loro.
  //
  // `u`, `avviso` e compagnia si calcolano piu' sopra, prima di
  // `fonti_ective`: dal 21/11/2026 i **due versi** nascono dallo stesso netto,
  // e quindi dallo stesso `u`.
  out.consumo_ective = u.watt == null
    ? manca('W', ['letture delle Ective'],
        'Le batterie parlano solo via Bluetooth: serve la scatoletta accesa in camper.')
    : conto(u.watt, 'W', {
        base: 'misurato',
        perche: (u.per_batteria
          .map(b => `${b.nome}: ${virgola(b.volt, 2)} V, ${b.ampere > 0 ? '+' : ''}${virgola(b.ampere, 2)} A`)
          .join(' \u00b7 ')),
        // Zero non e' \u00abnon so\u00bb: le batterie sono in carica, o non consuma
        // niente. Il null di sopra e' l'unico \u00abnon so\u00bb.
        detto: u.watt === 0 ? 'niente esce' : `${Math.round(u.watt)} W in uscita`,
      });
  out.consumo_ective.ampere = u.ampere;
  out.consumo_ective.per_batteria = u.per_batteria;
  out.consumo_ective.lette = u.lette;
  out.consumo_ective.totali = u.totali;
  out.consumo_ective.avviso = avviso;
  out.consumo_ective.eta_minuti = etaEctive;
  out.consumo_ective.vecchia = vecchie;
  // La carica del pacco viaggia qui, accanto agli altri fatti del pacco
  // (`lette`, `totali`, `per_batteria`), e non in un conto suo: non e' un
  // conto, e' una lettura. Serve alla figura per poter dire «piene» soltanto
  // quando lo sono davvero -- e riusarla da qui evita di ricalcolare
  // `uscitaEctive` nella rotta, cioe' di avere due fonti per lo stesso numero.
  out.consumo_ective.carica_pacco = u.carica_pacco;

  // **La durata si calcola sulla media recente, non sull'istante.**
  //
  // Disegno: docs/superpowers/specs/2026-11-21-durata-consumo-vivo-design.md
  //
  // Fino al 21/11/2026 questo conto divideva i Wh residui per i watt letti in
  // quel momento. Aperta la pagina mentre parte il compressore del frigo,
  // l'autonomia crollava a poche ore; un minuto dopo, a frigo spento, diceva
  // quaranta. Nessuno dei due e' sbagliato come misura, e tutti e due sono
  // inutili come durata.
  //
  // Quando la media non c'e' -- archivio corto, scatoletta appena accesa,
  // finestra scoperta -- si ricade sull'istante **e si dice**: una durata su
  // un istante dichiarato e' onesta, su un istante taciuto no.
  const daMedia = recente.watt != null;
  const consumoPerLaDurata = daMedia ? recente.watt : u.watt;
  const ore = u.residuo_wh == null || !(consumoPerLaDurata > 0)
    ? null : u.residuo_wh / consumoPerLaDurata;
  // La finestra si scrive accanto al numero, e con lei quanta parte se n'e'
  // stata in carica: a mezzogiorno col sole la media e' quasi nulla e
  // l'autonomia sembra di settimane -- vero come media, ingannevole come
  // promessa. Il numero non si cambia, si dice da dove viene.
  // La spiegazione deve dire **su cosa** e' fatta la media, e da quando il
  // divisore sono i soli intervalli di scarica non si puo' piu' dire «media
  // delle ultime due ore» se la scarica e' durata dieci minuti: sarebbe una
  // spiegazione che non corrisponde al conto. Quando la finestra e' stata
  // tutta di scarica -- il caso normale di notte -- la forma corta e' giusta
  // e si usa quella, perche' la lunga direbbe due volte la stessa cosa.
  const tuttaScarica = recente.in_carica_minuti === 0;
  const comeCalcolato = daMedia
    ? `${Math.round(consumoPerLaDurata)} W di consumo medio `
      + (tuttaScarica
        ? `delle ultime ${dilloInOre(recente.finestra_minuti / 60)}`
        : `nei ${dilloInOre(recente.in_scarica_minuti / 60)} di scarica `
          + `delle ultime ${dilloInOre(recente.finestra_minuti / 60)}`)
    : `${Math.round(consumoPerLaDurata)} W di consumo in questo momento `
      + '\u2014 non ho abbastanza letture recenti per una media';

  out.tempo_residuo_ective = u.watt == null
    ? manca('h', ['letture delle Ective'],
        'Le batterie parlano solo via Bluetooth: serve la scatoletta accesa in camper.')
    : !(consumoPerLaDurata > 0)
      ? conto(null, 'h', {
          base: 'incompleto',
          perche: daMedia
            ? 'nella media delle ultime ore dalle batterie non \u00e8 uscito niente: non c\u2019\u00e8 un consumo da cui partire'
            : 'dalle batterie non esce niente: non c\u2019e\u2019 un consumo da cui partire',
          detto: 'niente esce',
        })
      : u.residuo_wh == null
        ? manca('h', ['capacit\u00e0 e carica delle Ective'],
            'Le batterie dicono volt e ampere ma non quanto hanno dentro in questo giro.')
        : conto(ore, 'h', {
            // Misurato per intero: i watt, i Wh residui e i volt vengono tutti
            // e tre dalle batterie. Nessun numero di catalogo.
            base: 'misurato',
            perche: `${Math.round(u.residuo_wh)} Wh nelle batterie, a ${comeCalcolato}`,
            detto: dilloInOre(ore),
          });
  out.tempo_residuo_ective.avviso = avviso;
  out.tempo_residuo_ective.eta_minuti = etaEctive;
  out.tempo_residuo_ective.vecchia = vecchie;
  out.tempo_residuo_ective.finestra_minuti = daMedia ? recente.finestra_minuti : null;
  out.tempo_residuo_ective.in_carica_minuti = daMedia ? recente.in_carica_minuti : null;

  // ---- tempo delle Ective dalla colonnina ----
  //
  // Non c'era affatto, e il proprietario lo ha chiesto per primo: «era per il
  // calcolo dei tempi di ricarica stimati **sia di bluetti che di ective** da
  // colonnina».
  //
  // La potenza di carica delle Ective sono gli ampere del loro caricabatterie
  // alla tensione del pacco. **Semplificazione dichiarata**: si trascurano le
  // perdite del caricabatterie, quindi quel che prende dalla 220 e' un po' di
  // piu' e il limite della presa morde un po' prima di cosi'. L'errore e' nel
  // verso prudente -- il tempo vero e' uguale o piu' lungo -- e il giorno che
  // misuriamo quel rendimento il conto si stringe.
  const ectiveCaricaA = val(m, 'ective_carica_a');
  const ectiveCaricaW = ectiveCaricaA == null || ectiveV == null
    ? null : ectiveCaricaA * ectiveV;
  const presaEctive = limiteDellaPresa(ectiveCaricaW, colonninaA);
  out.ore_colonnina_ective = u.manca_wh == null
    ? manca('h', ['capacità e carica delle Ective'],
        'Le batterie dicono volt e ampere ma non quanto hanno dentro in questo giro.')
    : u.manca_wh <= 0
      ? conto(null, 'h', {
          base: 'incompleto',
          perche: 'le Ective sono piene: non c’è niente da rimettere',
          detto: 'piene',
        })
      : presaEctive.watt == null
        ? manca('h', ['ective_carica_a'],
            'Non so a quanti ampere carica il caricabatterie delle Ective dalla 220. '
            + 'Mettilo in Impianto e il conto compare.')
        : conto(u.manca_wh / presaEctive.watt, 'h', {
            // Mai `misurato`: la potenza del caricabatterie e' un dato di
            // targa e le perdite sono trascurate. I Wh invece sono misurati.
            base: 'stima',
            perche: `${Math.round(u.manca_wh)} Wh da rimettere nelle Ective, `
              + comeDallaPresa(presaEctive),
            detto: dilloInOre(u.manca_wh / presaEctive.watt),
          });
  out.ore_colonnina_ective.chi = presaEctive.chi;
  out.ore_colonnina_ective.presa_w = presaEctive.presa_w;
  out.ore_colonnina_ective.avviso = avviso;

  // ---- quanto dura il camper fermo ----
  // ---- quanto dura il camper fermo ----
  //
  // Disegno: docs/superpowers/specs/2026-11-21-durata-consumo-vivo-design.md
  //
  // Due difetti nello stesso conto, e il secondo era nascosto dal primo.
  //
  // Il consumo era `consumo_fermo_w`, **battuto in tabella** il 16/11/2026 e
  // col bollino «misurato». Adesso si misura da se' dalle notti; quello in
  // tabella resta come ripiego **dichiarato**, con la sua data.
  //
  // E il conto divideva i Wh della **sola Bluetti** per un consumo misurato
  // sul 12 V delle Ective, come se la Bluetti servisse quel consumo senza
  // perdite. Il proprietario ha scelto, fra quattro possibilita': **tutta
  // l'energia di bordo** -- i Wh delle Ective, che adesso si misurano, piu'
  // quelli della Bluetti scontati del rendimento della catena, perche' per
  // arrivare al 12 V quella corrente passa da inverter e caricatore.
  const daNotti = riposo.watt != null;
  const consumoFermo = daNotti ? riposo.watt : fermoW;
  const notaFermo = m.consumo_fermo_w?.nota || null;
  const comeFermo = daNotti
    ? `${Math.round(consumoFermo)} W di consumo a riposo, misurato su `
      + `${riposo.notti} ${riposo.notti === 1 ? 'notte' : 'notti'} senza sole`
    : `${consumoFermo} W di consumo a riposo dalla tabella`
      + (notaFermo ? ` (${notaFermo})` : '');

  const mancaFermo = [];
  const pezzi = [];
  let whBordo = 0;
  if (u.residuo_wh == null) mancaFermo.push('capacità e carica delle Ective');
  else {
    whBordo += u.residuo_wh;
    pezzi.push(`${Math.round(u.residuo_wh)} Wh nelle Ective`);
  }
  if (out.carica_residua.valore == null) mancaFermo.push('carica della Bluetti');
  else if (rendimento == null) mancaFermo.push('rendimento_bluetti_ective');
  else {
    whBordo += out.carica_residua.valore * rendimento;
    pezzi.push(`${Math.round(out.carica_residua.valore * rendimento)} Wh dalla Bluetti `
      + `(${out.carica_residua.valore} Wh scontati del rendimento stimato ${virgola(rendimento, 2)})`);
  }

  // La guardia e' `> 0`, non `!= null`: uno **zero** non e' un consumo, e
  // dividere per zero mandava in pagina la stringa «Infinity giorni» sulla
  // riga di una durata -- l'errore ottimista nella sua forma piu' pura. Via
  // JSON quel valore diventa `null`, quindi nemmeno il ripiego `—` salvava la
  // riga: `rigaConto` stampa `detto`, e `detto` diceva «Infinity giorni».
  // Trovato in revisione il 21/11/2026.
  out.giorni_fermo_bluetti = !pezzi.length || !(consumoFermo > 0)
    ? manca('giorni', [...mancaFermo, ...(consumoFermo > 0 ? [] : ['consumo_fermo_w'])],
        'Serve il consumo a riposo e almeno una delle due energie di bordo.')
    : conto(whBordo / consumoFermo / 24, 'giorni', {
        // **Stima, non misurato**, e vale la pena dire perche'. Dentro c'e'
        // il rendimento della catena, che in tabella e' dichiarato una stima:
        // un bollino «misurato» su un conto che contiene un numero di stima e'
        // esattamente il difetto che questo lavoro sta togliendo. E quando il
        // rendimento non c'e', il conto e' incompleto -- manca mezza energia
        // di bordo -- che non e' «misurato» nemmeno allora.
        base: 'stima',
        perche: `${pezzi.join(' + ')}, a ${comeFermo}`,
        detto: dilloInOre(whBordo / consumoFermo),
        mancano: mancaFermo,
      });

  // ---- quanto costa la scatoletta ----
  out.costo_scatoletta = scatolettaW == null || ectiveV == null
    ? manca('Ah/giorno', ['scatoletta_w'], 'Serve il consumo del Raspberry.')
    : conto(scatolettaW * 24 / ectiveV, 'Ah al giorno', {
        base: misurato(m, 'scatoletta_w') ? 'misurato' : 'stima',
        perche: `${scatolettaW} W per 24 ore, a ${ectiveV} V`,
        detto: `${(scatolettaW * 24 / ectiveV).toFixed(1)} Ah al giorno` +
          (ectiveAh ? ` — in un mese ${Math.round(scatolettaW * 24 / ectiveV * 30)} Ah, cioe’ il ${Math.round(scatolettaW * 24 / ectiveV * 30 / ectiveAh * 100)} % del pacco` : ''),
      });

  return out;
}
