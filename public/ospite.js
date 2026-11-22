/* La pagina di chi guarda da fuori.
 *
 * Non e' l'app di casa con i tasti nascosti: e' una pagina sua, che sa solo
 * leggere. Mappa, legenda, tasti per rivedere e lente delle foto sono pero'
 * gli stessi di sempre - li presta app.js - cosi' quello che si aggiusta di
 * la' si aggiusta anche qui, e un viaggio guardato da un link si vede come lo
 * vede chi l'ha fatto.
 *
 * Quello che l'ospite non deve vedere non gli arriva: lo toglie il server. Qui
 * i permessi servono solo a non disegnare scatole vuote.
 */
(() => {
const C = window.Camper;
if (!C || !window.OSPITE) return;
const { $, $$, esc, num, eur, dur, fdate, fdt, notti, legendaViaggio, mappaDelViaggio, rottaSvg,
  sportIco, MEZZI, mezzoDi, inCamper, stradaDedotta, nomeViaggio, facciaMedia, datiLente, giorniViaggio,
  stileRitaglio, itinerario, nomeStato, atletiDi, trattoFra } = C;

const chiama = async percorso => {
  const r = await fetch(`/api/pubblico/${encodeURIComponent(window.OSPITE)}${percorso}`, { headers: { Accept: 'application/json' } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Non sono riuscito a leggere i dati');
  return d;
};

const periodo = t => [t.start_date && fdate(t.start_date), t.end_date && t.end_date !== t.start_date ? fdate(t.end_date) : null]
  .filter(Boolean).join(' → ');

// Una cornice sola per tutte e due le pagine: il titolo, e in fondo la riga
// che dice da dove arriva quello che si sta guardando.
const cornice = (titolo, corpo, sopra = '') => `
  <header class="ospite-testa"><div class="wrap">${sopra}<h1>${titolo}</h1></div></header>
  <main class="wrap">${corpo}</main>
  <footer class="ospite-piede"><div class="wrap small muted">Pagina di sola lettura, condivisa da chi ha fatto questi viaggi.
    Nessuna registrazione, niente da installare: finche' il link resta acceso, basta riaprirlo.</div></footer>`;

function erroreGrosso(messaggio) {
  $('#app').innerHTML = cornice('Questo link non apre niente',
    `<div class="card"><div class="empty">${esc(messaggio)}<br><br>Chiedi a chi te l’ha mandato di generarne uno nuovo.</div></div>`);
}

// ---- l'elenco dei viaggi ----
async function viewViaggi() {
  const d = await chiama('/viaggi');
  const { viaggi, permessi } = d;
  const open = viaggi.filter(t => t.status === 'open');
  const altri = viaggi.filter(t => t.status !== 'open');
  const card = t => {
    const g = giorniViaggio(t);
    return `<a class="viaggio${t.status === 'open' ? ' in-corso' : ''}" href="#/trip/${t.id}">
      <div class="copertina">${t.cover ? `<img src="/uploads/${esc(t.cover)}" loading="lazy" alt="" style="${stileRitaglio(t.cover_crop)}">` : rottaSvg(t.rotta) || '<span class="senza">🚐</span>'}
        <span class="badge ${t.status}">${nomeStato(t)}</span></div>
      <div class="corpo">
        <div class="title">${esc(nomeViaggio(t))}</div>
        <div class="meta">${esc(periodo(t))}${g ? ` · ${g} giorn${g === 1 ? 'o' : 'i'}` : ''}</div>
        ${itinerario(t.mete)}
        <div class="numeri">
          <span title="Km in camper">🛣️ ${num(t.km, 0)}</span>
          <span title="${t.n_legs === 1 ? 'Una tappa' : t.n_legs + ' tappe'}">📍 ${t.n_legs}</span>
          ${t.n_photos ? `<span title="Foto">📷 ${t.n_photos}</span>` : ''}
          ${t.n_workouts ? `<span title="Allenamenti">🥾 ${t.n_workouts}</span>` : ''}
          ${permessi.spese && t.total ? `<b>${eur(t.total)}</b>` : ''}</div></div></a>`;
  };
  const perAnno = new Map();
  altri.forEach(t => {
    const anno = (t.start_date || '').slice(0, 4) || '—';
    if (!perAnno.has(anno)) perAnno.set(anno, []);
    perAnno.get(anno).push(t);
  });
  const km = viaggi.reduce((a, t) => a + (t.km || 0), 0);
  const giorni = viaggi.reduce((a, t) => a + giorniViaggio(t), 0);
  $('#app').innerHTML = cornice(esc(d.nome || 'I viaggi in camper'), `
    ${viaggi.length ? `<div class="tiles" style="margin-bottom:18px">
      <div class="tile accent"><div class="label">Viaggi</div><div class="value">${viaggi.length}</div><div class="sub">${open.length ? open.length + ' in corso' : ''}</div></div>
      <div class="tile"><div class="label">Giorni in viaggio</div><div class="value">${num(giorni, 0)}</div></div>
      <div class="tile"><div class="label">Km in camper</div><div class="value">${num(km, 0)}</div></div>
      ${permessi.tracciati ? '<div class="tile"><div class="label">Da guardare</div><div class="value">▶</div><div class="sub">apri un viaggio e ripercorrilo sulla mappa</div></div>' : ''}
    </div>` : ''}
    ${open.length ? `<div class="section"><div class="anno">In corso</div><div class="viaggi">${open.map(card).join('')}</div></div>` : ''}
    ${[...perAnno.entries()].map(([anno, lista]) => `<div class="section"><div class="anno">${esc(anno)} · <span>${lista.length} viagg${lista.length === 1 ? 'io' : 'i'}</span></div><div class="viaggi">${lista.map(card).join('')}</div></div>`).join('')}
    ${viaggi.length ? '' : '<div class="card"><div class="empty">Qui non c’e’ ancora niente da vedere.</div></div>'}`);
}

// ---- un viaggio ----
async function viewViaggio(id) {
  const d = await chiama('/trips/' + id);
  const { trip, legs, photos, workouts, totals, permessi } = d;
  const soste = d.soste || [];
  const atleti = atletiDi(workouts);
  const trattoDi = nome => trattoFra(nome, atleti);
  const pernotti = soste.reduce((a, s) => a + (notti(s.from_date, s.to_date) || 0), 0);
  const g = giorniViaggio(trip);
  const ore = (totals.minutes || 0) / 60;

  // Una foto sta in un posto solo: quelle di una sosta stanno sotto la sosta
  const fotoSosta = new Map();
  soste.forEach(x => fotoSosta.set(x.id, []));
  photos.forEach(p => { if (p.stop_id && fotoSosta.has(p.stop_id)) fotoSosta.get(p.stop_id).push(p); });
  const fotoViaggio = photos.filter(p => !p.stop_id || !fotoSosta.has(p.stop_id));

  const rigaTappa = (l, i) => `<div class="step"><div class="ordine"><div class="n">${i + 1}</div></div><div class="grow">
      <div class="row between"><div>${inCamper(l) ? '' : `<span title="${esc(MEZZI[mezzoDi(l)][1])}">${MEZZI[mezzoDi(l)][0]}</span> `}<b>${esc(l.from_name.split(',')[0])}</b> → <b>${esc(l.to_name.split(',')[0])}</b></div>
        <div class="nowrap"><b>${num(l.distance_km)} km</b> <span class="muted small">· ${dur(l.duration_min * 60)}</span></div></div>
      <div class="small muted">${l.compagnia || l.codice ? `<b>${esc([l.compagnia, l.codice].filter(Boolean).join(' '))}</b> · ` : ''}${fdate(l.date)}${l.start_time ? ' ' + esc(l.start_time) + '–' + esc(l.end_time || '') : ''}</div>
      ${stradaDedotta(l) ? `<div class="small muted">\u2022 \u2022 \u2022 Chilometri e orari <b>veri</b>, strada <b>ricostruita</b>: chi ha guidato ha registrato quanto, non per dove.</div>` : ''}</div></div>`;

  const rigaSosta = s => {
    const n = notti(s.from_date, s.to_date);
    const sue = fotoSosta.get(s.id) || [];
    return `<div class="item"><div class="item-main" style="cursor:default"><div class="sport-ico">${s.kind === 'campeggio' ? '⛺' : s.kind === 'area_sosta' ? '🅿️' : '🌙'}</div>
      <div class="grow"><div class="title">${esc(s.name)}${s.stars ? ` <span class="muted small">${'★'.repeat(s.stars)}</span>` : ''}</div>
        <div class="meta">${[s.from_date ? fdate(s.from_date) : '', n ? `${n} nott${n === 1 ? 'e' : 'i'}` : '', s.notes ? esc(s.notes) : ''].filter(Boolean).join(' · ')}</div>
        ${sue.length ? `<div class="foto-sosta">${sue.map(p => facciaMedia(p, ` ${datiLente(p)} title="Tocca per ingrandire"`)).join('')}</div>` : ''}</div></div></div>`;
  };

  const elencoAtleta = nome => {
    const suoi = workouts.filter(w => w.athlete === nome);
    const km = suoi.reduce((a, w) => a + (w.distance_m || 0), 0) / 1000;
    return `<div class="card pad-0"><div class="row between" style="padding:14px 16px 6px"><h2>👟 ${esc(nome)}</h2>
      <div class="small muted"><i class="segno-atleta" style="border-top-style:${trattoDi(nome)[1]}"></i> ${suoi.length} ${suoi.length === 1 ? 'uscita' : 'uscite'}${km >= 0.1 ? ` · ${num(km)} km` : ''}</div></div>
      <div class="list">${suoi.map(w => `<div class="item"><div class="item-main" style="cursor:default"><div class="sport-ico">${sportIco(w.sport)}</div>
        <div class="grow"><div class="title">${esc(w.name || w.sport || 'Allenamento')}</div>
          <div class="meta">${fdt(w.started_at)} · ${num((w.distance_m || 0) / 1000)} km · ${dur(w.duration_s)}${w.elevation_up_m ? ' · ⛰️ ' + w.elevation_up_m + ' m' : ''}${w.calories ? ' · 🔥 ' + w.calories : ''}</div></div></div>
        ${permessi.tracciati && w.track?.length > 1 ? `<div class="item-actions"><button class="btn ghost icon rivedi-uno" data-rivedi-uno="${w.id}" title="Rivedi questo percorso sulla mappa">▶</button></div>` : ''}</div>`).join('')}</div></div>`;
  };

  $('#app').innerHTML = cornice(`${esc(nomeViaggio(trip))} <span class="badge ${trip.status}">${nomeStato(trip)}</span>`, `
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile accent"><div class="label">Km in camper</div><div class="value">${num(totals.km, 0)}</div><div class="sub">${totals.altri_mezzi ? num(totals.altri_mezzi.km, 0) + ' km con altri mezzi' : ''}</div></div>
      <div class="tile"><div class="label">Giorni</div><div class="value">${g || '—'}</div><div class="sub">${pernotti ? pernotti + (pernotti === 1 ? ' pernotto' : ' pernotti') : ''}</div></div>
      <div class="tile"><div class="label">Ore di viaggio</div><div class="value">${dur((totals.minutes || 0) * 60)}</div><div class="sub">${ore > 0.2 && totals.km ? num(totals.km / ore, 0) + ' km/h di media' : ''}</div></div>
      ${workouts.length ? `<div class="tile"><div class="label">Allenamenti</div><div class="value">${workouts.length}</div><div class="sub">${num(workouts.reduce((a, w) => a + (w.distance_m || 0), 0) / 1000)} km di attività</div></div>` : ''}
      ${permessi.spese ? `<div class="tile"><div class="label">Totale speso</div><div class="value">${eur(totals.total)}</div>
        <div class="sub">${g ? eur(totals.total / g) + ' al giorno' : ''}${totals.cost_per_km ? `<br>${eur(totals.cost_per_km)} al km di strada` : ''}</div></div>` : ''}
    </div>
    <div class="card pad-0"><div id="map" class="map tall"></div>
      ${legendaViaggio(d, { tracciati: permessi.tracciati })}</div>
    ${legs.length ? `<div class="card pad-0" style="margin-top:14px"><div style="padding:14px 16px 6px"><h2>Tappe</h2></div>
      <div>${legs.map(rigaTappa).join('')}</div></div>` : ''}
    ${soste.length ? `<div class="card pad-0" style="margin-top:14px"><div style="padding:14px 16px 6px"><h2>🌙 Dove hanno dormito</h2></div>
      <div class="list">${soste.map(rigaSosta).join('')}</div></div>` : ''}
    ${fotoViaggio.length ? `<div class="card" style="margin-top:14px"><h2>Foto</h2>
      <div class="photos" style="margin-top:12px">${fotoViaggio.map(p => `<figure${/^video\//.test(p.mime || '') ? ' class="e-video"' : ''}>${facciaMedia(p, ` ${datiLente(p)} title="Tocca per ingrandire"`)}${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div></div>` : ''}
    ${atleti.length ? `<div class="grid cols-2" style="margin-top:14px">${atleti.map(elencoAtleta).join('')}</div>` : ''}
  `, '<a class="small" href="#/">← Tutti i viaggi</a>');

  // La mappa va per ultima: i tasti ▶ delle singole uscite esistono gia', e
  // si attaccano mentre la mappa si monta
  mappaDelViaggio($('#map'), d, { ospite: true, spese: permessi.spese, tracciati: permessi.tracciati });
}

async function disegna() {
  try {
    const m = (location.hash || '').match(/^#\/trip\/(\d+)/);
    if (m) await viewViaggio(m[1]); else await viewViaggi();
    window.scrollTo(0, 0);
  } catch (e) {
    erroreGrosso(e.message);
  }
}
window.addEventListener('hashchange', disegna);
disegna();
})();
