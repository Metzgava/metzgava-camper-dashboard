// Le uscite nel tempo: quanto e' uscito dalla Bluetti e dalle batterie.
//
// Disegno: docs/superpowers/specs/2026-11-21-storia-uscite-design.md
//
// Il conto sta qui e non in `public/app.js` per la ragione di sempre: li' non
// girano prove, e questa e' aritmetica che sbaglia in silenzio.
//
// **Il fatto che decide la forma di tutto: le righe non hanno mai lo stesso
// istante.** Si scrivono una per volta, quindi `uscita_ac_w` e `uscita_dc_w`
// della stessa lettura distano millisecondi, e le due Ective distano secondi.
// Sommare per istante esatto non darebbe niente, e aspettare che coincidano
// sarebbe aspettare per sempre. Si raggruppa per intervalli.

// I passi ammessi, in minuti. Valori tondi perche' un grafico il cui righello
// e' 37 minuti non si legge: si sceglie fra questi il primo che basta.
export const PASSI = [5, 15, 30, 60, 120, 240, 360, 720, 1440];

// Quanti punti si vuole su un grafico largo come un telefono. Di piu' non e'
// piu' preciso: e' piu' lento, e due punti nello stesso pixel sono un punto.
const PUNTI_VOLUTI = 300;

export function passoDelGrafico(giorni) {
  const voluto = (giorni * 24 * 60) / PUNTI_VOLUTI;
  return PASSI.find(p => p >= voluto) ?? PASSI[PASSI.length - 1];
}

// Quel che conta come uscita, per ciascun lato.
const BLUETTI_USCITE = { uscita_ac_w: 'ac', uscita_dc_w: 'dc' };

// Il righello **corto**, in minuti, quello su cui si guarda il verso della
// corrente prima di mediare qualsiasi cosa.
//
// Serve per un guasto trovato guardando i numeri veri il 21/11/2026: a novanta
// giorni l'uscita delle Ective crollava a un quindicesimo di quella di trenta.
// Con un intervallo da dodici ore, mediare il **netto** del pacco mette
// insieme la notte che scarica e il giorno che carica: i due si annullano, e
// `max(0, -netto)` di quasi zero e' quasi zero. Il consumo della notte
// spariva.
//
// Quindi il taglio si fa **prima** della media: si guarda il verso su
// intervalli corti, e poi si mediano i risultati. Non si media il verso.
//
// Un quarto d'ora e' il compromesso: abbastanza corto da tenere separati il
// giorno e la notte e la maggior parte dei cicli del frigo, abbastanza lungo
// da non portarsi dietro mezzo milione di righe su tre mesi.
export const FINE_MAX = 15;

const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// La media di un apparecchio dentro un intervallo, poi la **somma** fra
// apparecchi diversi. L'ordine conta: mediare due apparecchi fra loro darebbe
// meta' dell'uscita vera, che e' l'errore ottimista -- lo stesso gia' scansato
// nel vivo.
function sommaDelleMedie(perApparecchio) {
  let somma = 0;
  for (const { tot, n } of perApparecchio.values()) somma += tot / n;
  return somma;
}

function metti(mappa, chi, v) {
  const m = mappa.get(chi) || { tot: 0, n: 0 };
  m.tot += v; m.n++;
  mappa.set(chi, m);
}

// La media dei valori noti, `null` se non ce n'e' nessuno. Un intervallo senza
// letture resta un buco: non e' tempo a zero watt, e' tempo di cui non
// sappiamo niente.
const media = valori => {
  const v = valori.filter(x => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function serieUscite(righe, { da, a, passo, fine = null, batterie = [] } = {}) {
  const t0 = new Date(da).getTime();
  const t1 = new Date(a).getTime();
  // Il righello corto divide sempre quello lungo: altrimenti un intervallo
  // corto cadrebbe a cavallo di due lunghi e finirebbe contato male.
  const f = Math.max(1, Math.min(passo, fine || FINE_MAX));
  const dentro = Math.max(1, Math.round(passo / f));
  const lf = f * 60000;
  const quantiF = Math.max(0, Math.ceil((t1 - t0) / lf));
  const quanti = Math.max(0, Math.ceil((t1 - t0) / (passo * 60000)));

  const cestini = Array.from({ length: quantiF }, () => ({
    ac: new Map(), dc: new Map(), ba: new Map(),
  }));
  let letteBl = 0, letteBa = 0;
  const pacco = new Set(batterie);

  for (const r of (righe || [])) {
    const v = num(r.valore);
    if (v == null) continue;
    const t = new Date(r.quando).getTime();
    if (!Number.isFinite(t)) continue;
    const i = Math.floor((t - t0) / lf);
    if (i < 0 || i >= quantiF) continue;
    const dove = BLUETTI_USCITE[r.grandezza];
    if (dove) {
      metti(cestini[i][dove], r.apparecchio, v);
      letteBl++;
    } else if (r.grandezza === 'watt' && pacco.has(r.apparecchio)) {
      // Il filtro non e' per bellezza: `watt` e' una grandezza di tutti, e il
      // solare dentro il pacco sarebbe un numero falso.
      metti(cestini[i].ba, r.apparecchio, v);
      letteBa++;
    }
  }

  // --- primo livello: il righello corto ---
  const finiAc = cestini.map(c => (c.ac.size ? sommaDelleMedie(c.ac) : null));
  const finiDc = cestini.map(c => (c.dc.size ? sommaDelleMedie(c.dc) : null));
  // Se in un intervallo ha parlato una batteria sola, quell'intervallo e' un
  // **buco**, non meta' del consumo: meta' pacco spacciato per il pacco intero
  // e' un'autonomia doppia, ed e' il solo errore che fa restare fermi una
  // notte in piu' contando su ore che non ci sono.
  const finiEc = pacco.size === 0 ? null : cestini.map(c =>
    ([...pacco].every(b => c.ba.has(b)) ? Math.max(0, -sommaDelleMedie(c.ba)) : null));

  // --- secondo livello: quel che si disegna ---
  const fetta = (fini, k) => fini.slice(k * dentro, (k + 1) * dentro);
  const istante = k => new Date(t0 + k * passo * 60000).toISOString();

  const bluetti = Array.from({ length: quanti }, (_, k) => {
    const ac = media(fetta(finiAc, k));
    const dc = media(fetta(finiDc, k));
    return { t: istante(k), ac, dc, tot: ac == null && dc == null ? null : (ac || 0) + (dc || 0) };
  });

  const ective = finiEc && Array.from({ length: quanti }, (_, k) =>
    ({ t: istante(k), watt: media(fetta(finiEc, k)) }));

  return {
    passo_minuti: passo,
    fine_minuti: f,
    da: new Date(t0).toISOString(),
    a: new Date(t1).toISOString(),
    bluetti: riassunto(bluetti, p => p.tot,
      finiAc.map((v, i) => (v == null && finiDc[i] == null ? null : (v || 0) + (finiDc[i] || 0))),
      letteBl, f),
    ective: ective && riassunto(ective, p => p.watt, finiEc, letteBa, f),
  };
}

// I kWh si contano sugli intervalli **corti**, che sono la verita' piu' fine
// che abbiamo: su quelli lunghi si perderebbe quel che il taglio del verso ha
// appena salvato. Il tempo senza letture non conta: non e' tempo a zero watt,
// e' tempo di cui non sappiamo niente.
//
// Il picco, invece, e' il massimo di un intervallo **disegnato**: e' il numero
// che sta sotto il grafico, e deve corrispondere al punto piu' alto che si
// vede. La pagina dice di che larghezza e' quell'intervallo, cosi' il numero
// si sa leggere.
function riassunto(punti, valore, fini, letture, fineMinuti) {
  const ore = fineMinuti / 60;
  let wh = 0;
  for (const v of fini) if (v != null) wh += v * ore;
  let picco = null;
  for (const p of punti) {
    const v = valore(p);
    if (v != null && (picco == null || v > picco)) picco = v;
  }
  return { punti, letture, kwh: wh / 1000, picco_w: picco };
}
