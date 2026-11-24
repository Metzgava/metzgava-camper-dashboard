// Le tipologie di spesa che se le aggiunge lui.
//
// Chiesto il 24/11/2026: «e lasciami inserire nuove tipologie di spesa».
// L'elenco veniva dalle impostazioni ma non c'era **nessun posto** dove
// modificarlo: aggiungerne una voleva dire chiedermela.
//
// Due cose stanno insieme, e separarle sarebbe il difetto:
//
//   - **la chiave** (`lavanderia`) finisce nel database su ogni spesa
//     scritta, e non deve piu' cambiare;
//   - **come si mostra** (simbolo e nome) sta nella mappa del programma. Se
//     arrivasse solo la chiave, la sua categoria comparirebbe come
//     `gas_e_bombole` in ogni grafico e in ogni filtro.
//
// Quindi le sue vanno in un'impostazione a parte, `categorie_mie`, che la
// pagina assorbe dentro la mappa: simbolo, nome e colore funzionano da se'
// dappertutto, senza toccare un grafico alla volta.

// Il simbolo di scorta, quando non ne mette uno. Un buco in un elenco a
// tendina si legge peggio di un'etichetta generica.
const SIMBOLO_DI_SCORTA = '🏷️';

/**
 * La chiave di una categoria, dal nome che ha scritto.
 *
 * Minuscola, senza accenti, con gli spazi diventati trattini bassi: finisce
 * nel database, e deve restare la stessa se domani riscrive «Citta'» con
 * l'accento giusto.
 *
 * `null` quando dal nome non esce niente di utilizzabile: una spesa con la
 * categoria vuota non si ritrova piu', ed e' meglio un rifiuto.
 */
export function chiaveCategoria(nome) {
  const k = String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // via gli accenti
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return k || null;
}

/**
 * Una tipologia nuova: `{ chiave, elenco, mie, gia }`.
 *
 * `elenco` e `mie` sono le due impostazioni aggiornate; `gia` dice che non
 * c'era niente da aggiungere.
 *
 * **Una chiave che esiste non si tocca**, e la ragione e' diversa nei due
 * casi: se e' una sua, riscriverla cancellerebbe il nome che aveva scelto; se
 * e' del programma (`gasolio`, `pedaggi`) ha un significato nel codice -- la
 * stima automatica la cerca per nome -- e lasciargliela ribattezzare da qui
 * le darebbe un doppio senso.
 */
export function categoriaNuova(nome, simbolo, impostazioni = {}) {
  const chiave = chiaveCategoria(nome);
  const elenco = Array.isArray(impostazioni.categories) ? [...impostazioni.categories] : [];
  const mie = { ...(impostazioni.categorie_mie || {}) };
  if (!chiave) return { chiave: null, elenco, mie, gia: false };
  if (elenco.includes(chiave) || mie[chiave]) return { chiave, elenco, mie, gia: true };

  // Il simbolo si tiene a un carattere (due unita', che una emoji con il
  // modificatore le usa): e' un'icona in una tendina, non una frase. Chi ci
  // scrive una descrizione si ritroverebbe l'elenco sfasato.
  const ico = [...String(simbolo ?? '').trim()].slice(0, 2).join('') || SIMBOLO_DI_SCORTA;
  mie[chiave] = [ico, String(nome).trim().slice(0, 40)];
  // **In coda**, come le categorie nuove del programma: il colore viene dalla
  // posizione nell'elenco, e infilarla in mezzo cambierebbe colore a tutte
  // quelle dopo, in ogni grafico gia' visto.
  elenco.push(chiave);
  return { chiave, elenco, mie, gia: false };
}

export { SIMBOLO_DI_SCORTA };
