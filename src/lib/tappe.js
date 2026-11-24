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

// Quali numeri prende una tappa quando le si applica una strada.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// **CarLock misura i chilometri e il tempo; la strada no.** Manda solo
// partenza e arrivo, e la riga sulla mappa e' sempre una ricostruzione: fra le
// strade possibili si prende quella che misura quanto i chilometri veri.
//
// Fino al 21/11/2026 non era cosi' nel salvataggio di una tappa: aprendo
// «Modifica» la pagina mostra le strade possibili, e toccarne una scriveva i
// chilometri e la durata **della variante** al posto di quelli del tracker.
// Due tocchi, e la misura era persa -- con lei il gasolio, i totali del
// viaggio e il costo al km. Non e' una cosa che si nota: i numeri restano
// plausibili, solo non sono piu' quelli veri.
//
// Il pedaggio invece **segue la strada**, perche' dipende da lei e CarLock non
// lo misura. E' la distinzione che conta: si protegge quel che e' misurato,
// non tutto quel che e' scritto.
// `capiSpostati`: quando partenza o arrivo si sono mossi, i chilometri del
// tracker descrivono **un'altra tappa** e tenerli sarebbe peggio che rifarli.
// In tutti gli altri casi -- un cambio di mezzo, una strada scelta a mano --
// i capi sono gli stessi e la misura vale ancora. Di suo protegge: il verso
// prudente e' quello che non butta una misura per distrazione.
// `scrittoAMano`: un chilometraggio battuto nel riquadro **comanda**, anche su
// una tappa del tracker. La protezione difende dagli effetti collaterali, non
// dalle correzioni volute: togliere anche questa gli leverebbe l'unico modo di
// rimediare a un import sbagliato, e lui lo fa vedendolo.
//
// **Il bollino della traccia vera segue la riga**, e non i chilometri. Si
// spegne appena una strada calcolata prende il posto del tracciato, perche'
// `tracciato_vero` e' un'affermazione sulla riga -- «questa e' la traccia
// registrata» -- e su una riga sostituita e' falsa. Lo scarto se ne va con
// lui: era la distanza misurata contro una riga che non esiste piu'.
//
// `rigaRifatta` dice se la riga e' stata **davvero** ricalcolata, e deve
// arrivare da chi lo sa, cioe' la rotta. Guardare se `strada` c'e' non
// basta: il salvataggio chiama **sempre** con un oggetto, anche quando
// nessun ramo ha calcolato niente -- li' dentro c'e' la riga di prima,
// rimessa a posto. La prima versione di questa regola guardava `strada`, e
// spegneva la traccia appena caricata a ogni correzione di una nota. Le prove
// non se ne accorgevano perche' chiamavano con `null`, una forma che la rotta
// non usa mai; l'ha fatto vedere la pagina.
//
// Di suo vale `false`, cioe' «la riga potrebbe essere stata rifatta»: fra
// affermare che una riga e' misurata e non affermarlo, il verso prudente e' il
// secondo.
export function numeriDellaTappa(tappa, strada,
                                 { capiSpostati = false, scrittoAMano = false,
                                   rigaRifatta = true } = {}) {
  if (!strada) {
    return { distance_km: tappa?.distance_km ?? null, duration_min: tappa?.duration_min ?? null,
             geometry: tappa?.geometry ?? null, pedaggio_km: tappa?.pedaggio_km ?? null,
             tracciato_vero: !!tappa?.tracciato_vero,
             scarto_ricostruzione_km: tappa?.scarto_ricostruzione_km ?? null };
  }
  const dalTracker = tappa?.source === 'carlock' && !capiSpostati && !scrittoAMano;
  return {
    distance_km: dalTracker ? tappa.distance_km : strada.distance_km,
    duration_min: dalTracker ? tappa.duration_min : strada.duration_min,
    geometry: strada.geometry,
    // `null` e non `0`: un percorso che non dice niente sui pedaggi non sta
    // dicendo che non ce ne sono.
    pedaggio_km: strada.pedaggio_km ?? null,
    tracciato_vero: rigaRifatta ? false : !!tappa?.tracciato_vero,
    scarto_ricostruzione_km: rigaRifatta ? null : (tappa?.scarto_ricostruzione_km ?? null),
  };
}

// I punti dichiarati che si possono davvero usare per disegnare questa tappa.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// Due filtri, e tutti e due dicono qualcosa:
//
//   - **solo in camper.** Una rotta e un volo le statali non le seguono, e
//     disegnare l'autostrada sotto un aereo sarebbe un racconto falso. Se il
//     mezzo e' cambiato dopo che i punti erano stati scritti, i punti restano
//     salvati e si ignorano: butterebbero via un'informazione che tornera'
//     utile se il mezzo torna quello di prima.
//   - **solo quelli trovati.** Un nome che il geocoder non ha riconosciuto
//     resta scritto -- cosi' chi l'ha scritto lo vede e lo corregge -- ma
//     senza coordinate non si puo' passare da nessuna parte.
//
// Il mezzo mancante vale «camper», come dappertutto nel programma.
export function puntiDaUsare(tappa) {
  const mezzo = String(tappa?.mezzo || 'camper');
  if (mezzo !== 'camper') return [];
  return (tappa?.via || []).filter(p => p?.lat != null && p?.lon != null);
}

// ---------------------------------------------------------------------------
// L'autostrada dichiarata
// ---------------------------------------------------------------------------
//
// Disegno: docs/superpowers/specs/2026-11-22-pedaggi-dichiarati-design.md
//
// L'altra meta' di quel che sa chi c'era. I luoghi dicono **per dove**, questa
// dice **se si e' pagato un casello** -- e cambia il disegno insieme ai
// chilometri a pedaggio, da cui esce la spesa stimata del pedaggio.
//
// Tre stati, e il terzo non e' un ripiego: `null` vuol dire «non lo so», ed e'
// quel che hanno tutte le tappe scritte prima di oggi. Se «non lo so»
// scivolasse su «no», ogni tappa vecchia dichiarerebbe da sola che l'autostrada
// non si e' fatta -- e il programma le disegnerebbe tutte di conseguenza.

// Quel che arriva da fuori: dalla pagina, o da una richiesta scritta a mano.
// Il verso prudente e' il vuoto. Una stringa che non si riconosce **non** puo'
// diventare «no», perche' «no» e' una dichiarazione e nessuno l'ha fatta.
export function pedaggiDichiarati(valore) {
  const v = String(valore ?? '').trim().toLowerCase();
  return v === 'si' || v === 's\u00ec' ? 'si' : v === 'no' ? 'no' : null;
}

// La dichiarazione **da applicare** a una tappa, con lo stesso filtro dei
// luoghi: fuori dal camper si ignora, perche' una rotta e un volo le statali
// non le seguono. Si ignora, non si cancella: resta salvata per quando il
// mezzo torna quello di prima.
//
// Il mezzo mancante vale «camper», come dappertutto nel programma.
export function pedaggiDaUsare(tappa) {
  if (String(tappa?.mezzo || 'camper') !== 'camper') return null;
  return pedaggiDichiarati(tappa?.pedaggi_dichiarati);
}

// Il controllo di quel che e' tornato contro quel che era stato dichiarato.
// Disegnare un'autostrada dopo un «niente autostrada» senza dirlo e' la
// direzione rassicurante dell'errore, cioe' quella che questo lavoro chiude.
//
//   'non_chiedibile'  -> dichiarato «no», ma la strada che evita i pedaggi non
//                        si puo' nemmeno chiedere (manca la chiave del
//                        servizio): non e' stata onorata, e si dice.
//   'ne_fa_comunque'  -> dichiarato «no» e la strada fa chilometri a pedaggio.
//   'non_ne_fa'       -> dichiarato «si» e di autostrada non ce n'e'.
//
// **Pedaggi sconosciuti non contraddicono niente**: `null` vuol dire «non so»,
// `0` vuol dire «uno zero che conosco». Una strada che non dice niente sui
// pedaggi non sta dicendo che non ce ne sono -- ed e' quel che torna quando
// risponde OSRM invece di OpenRouteService.
export function pedaggiNonTornano(dichiarato, pedaggioKm, { sannoEvitare = true } = {}) {
  if (dichiarato !== 'si' && dichiarato !== 'no') return null;
  if (dichiarato === 'no' && !sannoEvitare) return 'non_chiedibile';
  const km = pedaggioKm == null ? null : Number(pedaggioKm);
  if (km == null || !Number.isFinite(km)) return null;
  if (dichiarato === 'no') return km > 0 ? 'ne_fa_comunque' : null;
  return km > 0 ? null : 'non_ne_fa';
}

// ---------------------------------------------------------------------------
// Quel che la tappa ha detto, e quando vale la pena rifare la riga
// ---------------------------------------------------------------------------
//
// Due condizioni che vivevano dentro la rotta e che la revisione del
// 22/11/2026 ha trovato storte tutte e due. Stavano dentro la finestra che le
// prove leggevano, e sono passate sotto centocinquantasette prove verdi: una
// prova che cerca delle parole non vede una condizione sbagliata. Qui sono
// funzioni, e si provano per quello che fanno.

// **La tappa ha detto qualcosa sulla sua strada**: dei luoghi, o l'autostrada,
// o tutti e due. Serve a chi sta per applicarle una strada calcolata altrove:
// una strada scelta nel riquadro di modifica e' calcolata fra i due soli capi
// e della dichiarazione non sa niente, quindi applicarla sopra un «niente
// autostrada» rimetterebbe l'autostrada disegnata in silenzio.
export function laTappaHaDetto(tappa) {
  return puntiDaUsare(tappa).length > 0 || pedaggiDaUsare(tappa) != null;
}

// **Quando rifare la riga.** Senza niente di nuovo da applicare si tiene
// quella che c'e': una riga costruita a mano, passata per i posti giusti, vale
// piu' di una ricalcolata al volo.
//
// `prima` e `adesso` sono la dichiarazione sull'autostrada com'era e com'e'.
// Guardare se il campo e' **arrivato** non basta: il riquadro lo manda
// sempre, quindi bastava un nome battuto male per rifare da zero una riga
// passata per Vidor e Pieve di Soligo. Quel che conta e' che sia **cambiata**.
export function daRidisegnare({ buoni = 0, puliti = 0, prima = null, adesso = null } = {}) {
  if (buoni > 0) return true;            // dei luoghi nuovi da attraversare
  if (puliti === 0) return true;         // il campo svuotato: si tolgono i luoghi
  return (prima ?? null) !== (adesso ?? null);   // la risposta sull'autostrada e' cambiata
}

// ---------------------------------------------------------------------------
// L'ordine delle tappe dentro un viaggio
// ---------------------------------------------------------------------------
//
// L'ordine e' un numero a parte (`position`) e **non** si ricalcola quando si
// corregge una data: per questo una tappa puo' avere la data giusta e stare lo
// stesso nel posto sbagliato dentro «Rivedi il percorso».
//
// La regola c'era gia', ma viveva dentro l'import di CarLock come una
// `ORDER BY` in mezzo a una rotta: si poteva subire, non chiedere, e nessuna
// prova la eseguiva. Qui e' una funzione, e si prova per quel che fa.
//
// Torna gli id nell'ordine giusto. Due scelte che dicono qualcosa:
//
//   - **una data che manca va in fondo**, non in cima: non e' «il primo
//     gennaio», e' «non so quando»;
//   - **a parita' di data e ora non si tocca niente**: due tratti nello stesso
//     momento li ha messi in fila una persona, e rimescolarli butterebbe via
//     l'unica informazione che c'e'.
export function ordineDelleTappe(tappe) {
  const giorno = d => {
    if (d == null || d === '') return null;
    // `pg` da' una colonna DATE come Date: letta come stringa diventa «Thu Oct
    // 01 2026 ...», e l'ordine alfabetico di quei nomi non e' l'ordine dei
    // giorni.
    if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
  };
  const chiave = t => {
    const g = giorno(t?.date), o = t?.start_time == null || t.start_time === '' ? null : String(t.start_time);
    return [g == null ? 1 : 0, g ?? '', o == null ? 1 : 0, o ?? '',
            Number(t?.position ?? 0), Number(t?.id ?? 0)];
  };
  return [...(tappe || [])].sort((a, b) => {
    const ka = chiave(a), kb = chiave(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  }).map(t => t.id);
}

