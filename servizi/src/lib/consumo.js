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
  // Un intervallo in cui il pacco stava caricando vale **zero**, non niente:
  // e' uno zero conosciuto, ed e' il modo in cui la media resta quella della
  // finestra intera invece di diventare quella dei soli momenti di scarica --
  // che sarebbe lo stesso numero raddoppiato.
  const pieni = fini.filter(v => v != null);
  const copertura = pieni.length / fini.length;
  // In carica vuol dire netto negativo, non «niente in uscita»: il taglio a
  // zero rende identici un pacco che carica e un pacco in equilibrio, e la
  // frase in pagina dice «di cui un'ora in carica».
  const in_carica_minuti = netti.filter(v => v != null && v < 0).length * fine_minuti;

  const abbastanza = letture >= CAMPIONI_MINIMI && copertura >= COPERTURA_MINIMA;
  return {
    watt: abbastanza && pieni.length
      ? pieni.reduce((s, v) => s + v, 0) / pieni.length
      : null,
    campioni: letture,
    copertura,
    in_carica_minuti,
    finestra_minuti,
  };
}
