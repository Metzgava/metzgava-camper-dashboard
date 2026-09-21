/* Camper dashboard – SPA senza framework */
(() => {
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(+n || 0);
const num = (n, d = 1) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(+n || 0);
const fdate = d => d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fdt = d => d ? new Date(d).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const iso = d => { if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10); const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const dur = s => { if (!s) return '—'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m} min`; };
const today = () => iso(new Date());
const CAT = { gasolio: ['⛽', 'Gasolio'], traghetto: ['⛴️', 'Traghetti'], area_sosta: ['🅿️', 'Aree sosta'], campeggio: ['⛺', 'Campeggi'], pedaggi: ['🛣️', 'Pedaggi'], vitto: ['🍝', 'Vitto'], spesa: ['🛒', 'Spesa'], visite: ['🏛️', 'Visite'], manutenzione: ['🔧', 'Manutenzione'], altro: ['💶', 'Altro'] };
const catLabel = c => CAT[c] ? `${CAT[c][0]} ${CAT[c][1]}` : c;
const catColor = c => `var(--c${(Object.keys(CAT).indexOf(c) + 10) % 10 + 1})`;
// Nessuna emoji rappresenta un tapis roulant: lo disegniamo (nastro, montante, console)
const ICO_TAPIS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="15" width="14" height="5" rx="2.5"/><path d="M16.5 17.2 19.6 7.4"/><path d="M17.6 7.4h4.2"/></svg>';
// Salute manda i nomi nella lingua del telefono, Komoot in inglese: qui stanno entrambi
const SPORT = { hike: '🥾', hiking: '🥾', escursion: '🥾', trekking: '🥾', alpinis: '🧗',
  walking: '🚶', walk: '🚶', camminat: '🚶', passeggiat: '🚶',
  running: '🏃', jogging: '🏃', cors: '🏃', esegui: '🏃', run: '🏃',
  touringbicycle: '🚴', mtb: '🚵', racebike: '🚴', cycling: '🚴', bike: '🚴', ride: '🚴',
  ciclism: '🚴', bicicl: '🚴', gravel: '🚵',
  swimming: '🏊', swim: '🏊', nuoto: '🏊', nuot: '🏊',
  skitour: '🎿', sci: '🎿', mountaineering: '🧗',
  forza: '🏋️', strength: '🏋️', yoga: '🧘', riscaldamento: '🧘', raffreddamento: '🧘' };
// Il tapis roulant va riconosciuto prima della camminata: "Interno Camminata" e' entrambe
const RE_TAPIS = /(interno|indoor|coperto)[\s\S]*(camminat|esegui|cors|walk|run)|(camminat|esegui|cors|walk|run)[\s\S]*(interno|indoor|coperto)|tapis|treadmill/;
const sportIco = s => {
  const testo = String(s || '').toLowerCase();
  if (RE_TAPIS.test(testo)) return ICO_TAPIS;
  const secco = testo.replace(/[^a-z]/g, '');
  for (const k in SPORT) if (secco.includes(k)) return SPORT[k];
  return '🏅';
};

let user = null, settings = {}, atleti = [];

// ---------- API ----------
async function api(path, opts = {}) {
  const o = { headers: {}, ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch('/api' + path, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && user) { user = null; render(); } throw new Error(data.error || `Errore ${r.status}`); }
  return data;
}
const toast = (msg, err = false) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 4500 : 2500); };
const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  onMount?.(bg, () => bg.remove());
  return bg;
}
// Il pannello di una tendina si apre verso destra; se cosi' uscirebbe dallo schermo
// lo si ancora al bordo destro del pulsante. Serve soprattutto sui telefoni.
function sistemaTendina(dettaglio) {
  const corpo = $('.tendina-corpo', dettaglio);
  if (!corpo) return;
  corpo.classList.remove('a-destra');
  if (corpo.getBoundingClientRect().right > document.documentElement.clientWidth - 8) corpo.classList.add('a-destra');
}

const confirmDlg = msg => new Promise(res => modal(`<h2>${esc(msg)}</h2><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-x>Annulla</button><button class="btn danger" data-ok>Conferma</button></div>`,
  (el, close) => { $('[data-x]', el).onclick = () => { close(); res(false); }; $('[data-ok]', el).onclick = () => { close(); res(true); }; }));

// ---------- Mappe ----------
function makeMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: !opts.simple, attributionControl: true, ...opts });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  map.setView([45.9, 12.3], 7);
  return map;
}
const pin = (color, label) => L.divIcon({ className: '', html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center"><span style="transform:rotate(45deg);font-size:12px;color:#fff;font-weight:700">${label || ''}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24] });
const dotIcon = (color, emoji) => L.divIcon({ className: '', html: `<div style="width:24px;height:24px;border-radius:50%;background:#fff;border:2px solid ${color};display:grid;place-items:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.3)">${emoji}</div>`, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });

// ---------- Geocoder autocomplete ----------
function geoInput(input, onPick) {
  let box, timer;
  const wrap = input.parentElement; wrap.classList.add('rel');
  const close = () => { box?.remove(); box = null; };
  input.addEventListener('input', () => {
    clearTimeout(timer); input.dataset.lat = ''; onPick(null);
    const v = input.value.trim(); if (v.length < 3) return close();
    timer = setTimeout(async () => {
      let res = []; try { res = await api('/geocode?q=' + encodeURIComponent(v)); } catch { }
      close(); if (!res.length) return;
      box = document.createElement('div'); box.className = 'suggest';
      box.innerHTML = res.map((r, i) => `<div data-i="${i}">📍 ${esc(r.name)}</div>`).join('');
      box.onclick = e => { const i = e.target.closest('[data-i]')?.dataset.i; if (i == null) return; const r = res[i]; input.value = r.name; onPick(r); close(); };
      wrap.appendChild(box);
    }, 350);
  });
  input.addEventListener('blur', () => setTimeout(close, 200));
}

// ---------- Layout ----------
// Il menu ha una voce di allenamenti per atleta: con due persone in casa servono
// due elenchi distinti, e le copie di uno stesso giro non devono mescolarsi
const nav = () => [
  ['#/', '🚐', 'Viaggi'],
  ...atleti.map(a => [`#/allenamenti/${a.id}`, '👟', `Allenamenti ${a.name}`]),
  ['#/cruscotto', '🎛️', 'Cruscotto'],
  ['#/riepiloghi', '📊', 'Riepiloghi'],
  ['#/impostazioni', '⚙️', 'Impostazioni'],
];
function layout(content) {
  const h = location.hash || '#/';
  const active = x => (x === '#/' ? (h === '#/' || h.startsWith('#/trip')) : h.startsWith(x)) ? 'active' : '';
  const links = nav().map(([href, ico, l]) => `<a href="${href}" class="${active(href)}"><span class="ico">${ico}</span>${l}</a>`).join('');
  return `<aside class="sidebar"><div class="brand"><img src="icon.svg" alt="">Camper</div><nav class="nav">${links}</nav><div class="user">${esc(user.name)}<br><a href="#" data-logout>Esci</a></div></aside>
  <main>${content}</main><nav class="tabbar">${links}</nav>`;
}

// ---------- Auth ----------
function viewAuth(setup) {
  const app = $('#app');
  let mode = setup ? 'register' : 'login';
  const draw = () => {
    app.innerHTML = `<div class="auth stack"><div class="brand" style="justify-content:center;font-size:22px"><img src="icon.svg" alt="" style="width:44px;height:44px">Camper · Viaggi</div>
    <div class="card stack">
      <h2>${mode === 'login' ? 'Accedi' : setup ? 'Crea l\'amministratore' : 'Registrati con invito'}</h2>
      ${setup ? '<p class="muted small">Primo avvio: questo account sarà l\'amministratore che autorizza gli altri.</p>' : ''}
      <form id="f" class="stack">
        ${mode === 'register' ? '<div><label class="f">Nome</label><input name="name" required autocomplete="name"></div>' : ''}
        <div><label class="f">Email</label><input name="email" type="email" required autocomplete="email"></div>
        <div><label class="f">Password</label><input name="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
        ${mode === 'register' && !setup ? '<div><label class="f">Codice invito</label><input name="invite" required style="text-transform:uppercase" autocomplete="off"></div>' : ''}
        <button class="btn primary" style="width:100%">${mode === 'login' ? 'Entra' : 'Crea account'}</button>
      </form>
      ${setup ? '' : `<a href="#" id="sw" class="small">${mode === 'login' ? 'Hai un codice invito? Registrati' : 'Hai già un account? Accedi'}</a>`}
    </div></div>`;
    $('#sw')?.addEventListener('click', e => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); });
    $('#f').onsubmit = safe(async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      const r = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      if (r.pending) { app.innerHTML = `<div class="auth"><div class="card stack"><h2>In attesa di autorizzazione</h2><p>L'amministratore deve approvare il tuo account. Riprova più tardi.</p><button class="btn" onclick="location.reload()">Ricarica</button></div></div>`; return; }
      user = r.user; settings = await api('/settings'); render();
    });
  };
  draw();
}

// ---------- Viaggi ----------
async function viewTrips() {
  const trips = await api('/trips');
  const open = trips.filter(t => t.status === 'open'), closed = trips.filter(t => t.status !== 'open');
  const card = t => `<a class="item" href="#/trip/${t.id}"><span class="dot" style="background:${t.status === 'open' ? 'var(--accent)' : 'var(--muted)'}"></span>
    <div class="grow"><div class="title">${esc(t.title)}</div><div class="meta">${fdate(t.start_date)}${t.end_date ? ' → ' + fdate(t.end_date) : ''} · ${t.n_legs} tappe · ${num(t.km)} km${t.n_workouts ? ' · 👟 ' + t.n_workouts + ' allenament' + (t.n_workouts === 1 ? 'o' : 'i') : ''}${t.n_photos ? ' · 📷 ' + t.n_photos : ''}</div></div>
    <div class="right"><div style="font-weight:700">${eur(t.total)}</div><span class="badge ${t.status}">${t.status === 'open' ? 'in corso' : 'concluso'}</span></div></a>`;
  const totKm = trips.reduce((a, t) => a + t.km, 0), totSp = trips.reduce((a, t) => a + t.total, 0);
  $('#app').innerHTML = layout(`
    <div class="row between" style="margin-bottom:16px"><h1>I tuoi viaggi</h1><div class="row"><button class="btn" id="carlock">📡 Importa CarLock</button><button class="btn primary" id="new">＋ Nuovo viaggio</button></div></div>
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile accent"><div class="label">Viaggi</div><div class="value">${trips.length}</div><div class="sub">${open.length} in corso</div></div>
      <div class="tile"><div class="label">Km in camper</div><div class="value">${num(totKm, 0)}</div><div class="sub">~${num(totKm / (settings.vehicle?.km_per_liter || 10), 0)} litri</div></div>
      <div class="tile"><div class="label">Spesa totale</div><div class="value">${eur(totSp)}</div><div class="sub">${totKm ? eur(totSp / totKm) + '/km' : ''}</div></div>
    </div>
    ${open.length ? `<div class="section"><h2 style="margin-bottom:8px">In corso</h2><div class="card pad-0 list">${open.map(card).join('')}</div></div>` : ''}
    <div class="section"><h2 style="margin-bottom:8px">Conclusi</h2><div class="card pad-0 list">${closed.length ? closed.map(card).join('') : '<div class="empty">Nessun viaggio concluso.<br>Crea il primo viaggio e aggiungi le tappe: distanze e gasolio si calcolano da soli.</div>'}</div></div>`);
  $('#new').onclick = () => tripForm();
  $('#carlock').onclick = () => carlockImport(null, open);
}

function tripForm(t = null) {
  const v = settings.vehicle || {};
  modal(`<h2>${t ? 'Modifica viaggio' : 'Nuovo viaggio'}</h2><form id="f" class="stack" style="margin-top:14px">
    <div><label class="f">Titolo</label><input name="title" required value="${esc(t?.title || '')}" placeholder="Es. Giro della Puglia"></div>
    <div class="form-grid"><div><label class="f">Inizio</label><input type="date" name="start_date" value="${t?.start_date ? iso(t.start_date) : today()}"></div><div><label class="f">Fine</label><input type="date" name="end_date" value="${t?.end_date ? iso(t.end_date) : ''}"></div></div>
    <div class="form-grid"><div><label class="f">Prezzo gasolio €/l</label><input type="number" step="0.001" name="fuel_price" value="${t?.fuel_price ?? v.fuel_price ?? 1.75}"></div><div><label class="f">Consumo km/l</label><input type="number" step="0.1" name="km_per_liter" value="${t?.km_per_liter ?? v.km_per_liter ?? 10}"></div></div>
    <div><label class="f">Note</label><textarea name="notes" rows="2">${esc(t?.notes || '')}</textarea></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">${t ? 'Salva' : 'Crea'}</button></div></form>`,
    (el, close) => { $('[data-x]', el).onclick = close; $('#f', el).onsubmit = safe(async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
      const r = t ? await api('/trips/' + t.id, { method: 'PUT', body }) : await api('/trips', { method: 'POST', body }); close(); location.hash = '#/trip/' + r.id; if (t) render(); }); });
}

async function viewTrip(id) {
  const d = await api('/trips/' + id);
  const { trip, legs, expenses, photos, workouts, totals } = d;
  const closed = trip.status === 'closed';
  const catRows = totals.by_category.map(c => `<span><i class="dot" style="display:inline-block;background:${catColor(c.category)}"></i>${catLabel(c.category)} <b>${eur(c.total)}</b></span>`).join('');
  const legRow = (l, i) => `<div class="step"><div class="n">${i + 1}</div><div class="grow">
      <div class="row between"><div><b>${esc(l.from_name.split(',')[0])}</b> → <b>${esc(l.to_name.split(',')[0])}</b></div><div class="nowrap"><b>${num(l.distance_km)} km</b> <span class="muted small">· ${dur(l.duration_min * 60)}</span></div></div>
      <div class="small muted">${fdate(l.date)}${l.start_time ? ' ' + l.start_time + '–' + l.end_time : ''}${l.source === 'carlock' ? ' <span class="badge ok" title="Km reali dal tracker CarLock">CarLock</span>' : ''}${l.fuel_price ? ' · gasolio ' + l.fuel_price + ' €/l' : ''}${l.notes ? ' · ' + esc(l.notes) : ''}${l.pois ? ` · 🅿️ ${l.pois.stops?.length || 0} soste · 🏘️ ${l.pois.villages?.length || 0} borghi` : ' · <i>cerco aree sosta e borghi…</i>'}</div>
      <div class="row" style="margin-top:6px"><button class="btn sm" data-poi="${l.id}">Soste & borghi</button>${closed ? '' : `<button class="btn sm ghost" data-edit-leg="${l.id}">Modifica</button><button class="btn sm ghost danger" data-del-leg="${l.id}">Elimina</button>`}</div></div></div>`;
  const exRow = e => `<tr data-ex="${e.id}"><td class="nowrap">${fdate(e.date)}</td><td>${catLabel(e.category)}</td><td>${esc(e.description || '')}${e.auto ? ` <span class="badge ${e.edited ? 'warn' : 'ok'}" title="${e.edited ? 'Calcolo automatico sostituito da te' : 'Calcolata automaticamente'}">${e.edited ? 'modificata' : 'auto'}</span>` : ''}</td><td class="num"><b>${eur(e.amount)}</b></td>
    <td class="num">${closed ? '' : `<button class="btn sm ghost" data-edit-ex="${e.id}">✏️</button>${e.auto && e.edited ? `<button class="btn sm ghost" title="Ripristina calcolo automatico" data-reset-ex="${e.id}">↺</button>` : ''}${e.auto ? '' : `<button class="btn sm ghost danger" data-del-ex="${e.id}">🗑</button>`}`}</td></tr>`;
  $('#app').innerHTML = layout(`
    <div class="row between" style="margin-bottom:14px"><div><a href="#/" class="small">← Viaggi</a><h1><span id="ttl" title="Tocca per rinominare" style="cursor:pointer">${esc(trip.title)}</span> <span class="badge ${trip.status}">${closed ? 'concluso' : 'in corso'}</span></h1>
      <div class="muted small">${fdate(trip.start_date)}${trip.end_date ? ' → ' + fdate(trip.end_date) : ''} · creato da ${esc(trip.owner)} · gasolio ${trip.fuel_price ?? settings.vehicle?.fuel_price} €/l · ${trip.km_per_liter} km/l</div></div>
      <div class="row"><button class="btn" id="edit">✏️ Modifica</button>${closed ? '<button class="btn" id="reopen">Riapri</button>' : '<button class="btn primary" id="close">Concludi viaggio</button>'}${legs.length > 1 ? '<button class="btn icon" id="split" title="Dividi in viaggi casa → casa">✂️</button>' : ''}<button class="btn ghost danger icon" id="del" title="Elimina viaggio">🗑</button></div></div>
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile accent"><div class="label">Totale speso</div><div class="value">${eur(totals.total)}</div><div class="sub">${totals.cost_per_km ? eur(totals.cost_per_km) + ' al km' : ''}</div></div>
      <div class="tile"><div class="label">Distanza in camper</div><div class="value">${num(totals.km)} km</div><div class="sub">${totals.legs} tappe · ${dur(totals.minutes * 60)} guida</div></div>
      <div class="tile"><div class="label">Gasolio</div><div class="value">${num(totals.liters)} l</div><div class="sub">${eur(totals.by_category.find(c => c.category === 'gasolio')?.total || 0)}</div></div>
      <div class="tile"><div class="label">Allenamenti</div><div class="value">${workouts.length}</div><div class="sub">${num(workouts.reduce((a, w) => a + (w.distance_m || 0), 0) / 1000)} km di attività · ${num(workouts.reduce((a, w) => a + (w.calories || 0), 0), 0)} kcal</div></div>
    </div>
    <div class="card pad-0"><div id="map" class="map tall"></div></div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card pad-0"><div class="row between" style="padding:14px 16px 6px"><h2>Tappe</h2>${closed ? '' : '<div class="row"><button class="btn sm" id="carlock">📡 Importa CarLock</button><button class="btn primary sm" id="addleg">＋ Tappa</button></div>'}</div>
        <div id="legs">${legs.length ? legs.map(legRow).join('') : '<div class="empty">Aggiungi la prima tappa: la distanza stradale e il costo del gasolio vengono calcolati automaticamente.</div>'}</div></div>
      <div class="card pad-0"><div class="row between" style="padding:14px 16px 6px"><h2>Spese</h2>${closed ? '' : '<button class="btn primary sm" id="addex">＋ Spesa</button>'}</div>
        ${catRows ? `<div class="legend" style="padding:0 16px 10px">${catRows}</div>` : ''}
        <div class="table-wrap"><table class="ex-table"><thead><tr><th>Data</th><th>Categoria</th><th>Descrizione</th><th class="num">Importo</th><th></th></tr></thead><tbody>${expenses.length ? expenses.map(exRow).join('') : '<tr><td colspan="5" class="empty">Nessuna spesa</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><div class="row between"><h2>Foto</h2><label class="btn sm">📷 Carica<input type="file" id="ph" accept="image/*" multiple hidden></label></div>
        <div class="photos${photos.length ? '' : ' empty-grid'}" style="margin-top:12px" id="photos">${photos.map(p => `<figure><img src="/uploads/${p.filename}" loading="lazy" alt="">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}<button class="del" data-del-ph="${p.id}">✕</button></figure>`).join('') || '<div class="muted small">Nessuna foto. Le foto con GPS vengono posizionate sulla mappa.</div>'}</div></div>
      <div class="card pad-0"><div style="padding:14px 16px 6px"><h2>Allenamenti del viaggio</h2></div><div class="list">${workouts.map(w => `<a class="item" href="#/allenamento/${w.id}"><div class="sport-ico">${sportIco(w.sport)}</div><div class="grow"><div class="title">${esc(w.name || w.sport || 'Allenamento')}</div><div class="meta">${fdt(w.started_at)} · ${esc(w.athlete)} · ${num((w.distance_m || 0) / 1000)} km · ${dur(w.duration_s)}${w.hr_avg ? ' · ❤️ ' + w.hr_avg : ''}${w.calories ? ' · 🔥 ' + w.calories : ''}</div></div></a>`).join('') || '<div class="empty">Gli allenamenti nelle date del viaggio compaiono qui automaticamente.</div>'}</div></div>
    </div>`);

  // Mappa
  const map = makeMap($('#map'));
  const bounds = [];
  legs.forEach((l, i) => {
    const g = l.geometry || [[l.from_lat, l.from_lon], [l.to_lat, l.to_lon]];
    L.polyline(g, { color: '#0f766e', weight: 5, opacity: .85 }).addTo(map).bindPopup(`<b>Tappa ${i + 1}</b><br>${esc(l.from_name.split(',')[0])} → ${esc(l.to_name.split(',')[0])}<br>${num(l.distance_km)} km · ${dur(l.duration_min * 60)}`);
    L.marker([l.from_lat, l.from_lon], { icon: pin('#0f766e', i + 1) }).addTo(map).bindPopup(esc(l.from_name));
    if (i === legs.length - 1) L.marker([l.to_lat, l.to_lon], { icon: pin('#dc2626', '🏁') }).addTo(map).bindPopup(esc(l.to_name));
    g.forEach(p => bounds.push(p));
    (l.pois?.stops || []).forEach(s => L.marker([s.lat, s.lon], { icon: dotIcon('#f59e0b', s.kind === 'area_sosta' ? '🅿️' : s.kind === 'campeggio' ? '⛺' : '🚰') }).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${s.kind.replace('_', ' ')}${s.fee ? '<br>Tariffa: ' + esc(s.fee) : ''}${s.website ? `<br><a href="${esc(s.website)}" target="_blank">sito</a>` : ''}`));
    (l.pois?.villages || []).slice(0, 12).forEach(v => L.marker([v.lat, v.lon], { icon: dotIcon('#6366f1', '🏘️') }).addTo(map).bindPopup(`<b>${esc(v.name)}</b><br>${v.place}${v.population ? ' · ' + num(v.population, 0) + ' ab.' : ''}${v.wikipedia ? `<br><a href="https://it.wikipedia.org/wiki/${encodeURIComponent(v.wikipedia.replace(/^\w+:/, ''))}" target="_blank">Wikipedia</a>` : ''}`));
  });
  workouts.filter(w => w.track).forEach(w => { L.polyline(w.track.map(p => [p[0], p[1]]), { color: '#ec4899', weight: 3, dashArray: '4 6' }).addTo(map).bindPopup(`${sportIco(w.sport)} ${esc(w.name || '')}`); });
  photos.filter(p => p.lat).forEach(p => { L.marker([p.lat, p.lon], { icon: dotIcon('#0ea5e9', '📷') }).addTo(map).bindPopup(`<img src="/uploads/${p.filename}" style="width:180px;border-radius:8px"><br>${esc(p.caption || '')}`); bounds.push([p.lat, p.lon]); });
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });

  // Azioni
  $('#edit')?.addEventListener('click', () => tripForm(trip));
  $('#ttl').onclick = () => modal(`<h2>Rinomina viaggio</h2><form id="f" class="stack" style="margin-top:12px"><input name="title" value="${esc(trip.title)}" required maxlength="120"><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => { $('[data-x]', el).onclick = close; $('[name=title]', el).select(); $('#f', el).onsubmit = safe(async e => { e.preventDefault(); await api('/trips/' + id, { method: 'PUT', body: { title: $('[name=title]', el).value.trim(), start_date: trip.start_date, end_date: trip.end_date, fuel_price: trip.fuel_price, km_per_liter: trip.km_per_liter, notes: trip.notes } }); close(); render(); }); });
  $('#split')?.addEventListener('click', () => modal(`<h2>✂️ Dividi in viaggi</h2><p class="small muted">Ogni partenza da casa fino al rientro a casa diventa un viaggio separato, con le sue tappe, spese e foto. Il titolo prende date e mete.</p><form id="f" class="stack"><div><label class="f">Nome di casa (come compare nelle tappe)</label><input name="home" value="Susegana" required></div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Dividi</button></div></form>`,
    (el, close) => { $('[data-x]', el).onclick = close; $('#f', el).onsubmit = safe(async e => { e.preventDefault(); const r = await api(`/trips/${id}/split`, { method: 'POST', body: { home: $('[name=home]', el).value } }); close();
      if (!r.created.length) return toast('Nessuna divisione possibile: ' + (r.reason || 'serve almeno un rientro a casa'), true);
      toast(`Creati ${r.created.length} viaggi`); location.hash = '#/'; render(); }); }));
  $('#del').onclick = safe(async () => { if (await confirmDlg('Eliminare il viaggio con tappe, spese e foto?')) { await api('/trips/' + id, { method: 'DELETE' }); location.hash = '#/'; } });
  $('#close')?.addEventListener('click', safe(async () => {
    if (!await confirmDlg('Concludere il viaggio? Verranno mostrati i totali finali.')) return;
    const r = await api(`/trips/${id}/close`, { method: 'POST', body: {} });
    const t = r.totals;
    modal(`<h2>🏁 Viaggio concluso</h2><div class="tiles" style="margin:14px 0"><div class="tile accent"><div class="label">Totale</div><div class="value">${eur(t.total)}</div></div><div class="tile"><div class="label">Km</div><div class="value">${num(t.km)}</div></div><div class="tile"><div class="label">Gasolio</div><div class="value">${num(t.liters)} l</div></div><div class="tile"><div class="label">Costo/km</div><div class="value">${t.cost_per_km ? eur(t.cost_per_km) : '—'}</div></div></div>
      <table>${t.by_category.map(c => `<tr><td>${catLabel(c.category)}</td><td class="num">${eur(c.total)}</td></tr>`).join('')}</table><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-x>Ok</button></div>`, (el, close) => $('[data-x]', el).onclick = () => { close(); render(); });
  }));
  $('#reopen')?.addEventListener('click', safe(async () => { await api(`/trips/${id}/close`, { method: 'POST', body: { reopen: true } }); render(); }));
  $('#addleg')?.addEventListener('click', () => legForm(trip, legs));
  $('#carlock')?.addEventListener('click', () => carlockImport(trip));
  $('#addex')?.addEventListener('click', () => expenseForm(trip, legs));
  $('#legs').onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.poi) { let l = legs.find(x => x.id == b.dataset.poi); if (!l.pois) { toast('Cerco aree sosta e borghi…'); l.pois = await api(`/legs/${l.id}/pois`, { method: 'POST' }); } poiModal(l); }
    if (b.dataset.editLeg) legForm(trip, legs, legs.find(x => x.id == b.dataset.editLeg));
    if (b.dataset.delLeg && await confirmDlg('Eliminare la tappa e la sua spesa gasolio?')) { await api('/legs/' + b.dataset.delLeg, { method: 'DELETE' }); render(); }
  });
  $('tbody').onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.editEx) expenseForm(trip, legs, expenses.find(x => x.id == b.dataset.editEx));
    if (b.dataset.resetEx) { await api(`/expenses/${b.dataset.resetEx}/reset`, { method: 'POST' }); toast('Calcolo automatico ripristinato'); render(); }
    if (b.dataset.delEx && await confirmDlg('Eliminare la spesa?')) { await api('/expenses/' + b.dataset.delEx, { method: 'DELETE' }); render(); }
  });
  $('#ph').onchange = safe(async e => {
    const fd = new FormData(); [...e.target.files].forEach(f => fd.append('photos', f));
    const caption = prompt('Didascalia (opzionale)'); if (caption) fd.append('caption', caption);
    toast('Caricamento foto…'); await api(`/trips/${id}/photos`, { method: 'POST', body: fd }); toast('Foto caricate'); render();
  });
  $('#photos').onclick = safe(async e => { const b = e.target.closest('[data-del-ph]'); if (b && await confirmDlg('Eliminare la foto?')) { await api('/photos/' + b.dataset.delPh, { method: 'DELETE' }); render(); } });
  // aggiorna quando i POI arrivano in background
  if (legs.some(l => !l.pois)) setTimeout(() => { if (location.hash === '#/trip/' + id) render(); }, 12000);
}

function legForm(trip, legs, leg = null) {
  const last = legs[legs.length - 1];
  let from = leg ? { name: leg.from_name, lat: leg.from_lat, lon: leg.from_lon } : last ? { name: last.to_name, lat: last.to_lat, lon: last.to_lon } : null;
  let to = leg ? { name: leg.to_name, lat: leg.to_lat, lon: leg.to_lon } : null;
  modal(`<h2>${leg ? 'Modifica tappa' : 'Nuova tappa'}</h2><form id="f" class="stack" style="margin-top:14px">
    <div><label class="f">Partenza</label><input id="from" required value="${esc(from?.name || '')}" placeholder="Cerca città o luogo…" autocomplete="off"></div>
    <div><label class="f">Arrivo</label><input id="to" required value="${esc(to?.name || '')}" placeholder="Cerca città o luogo…" autocomplete="off"></div>
    <div class="form-grid"><div><label class="f">Data</label><input type="date" name="date" value="${leg?.date ? iso(leg.date) : (last?.date ? iso(last.date) : (trip.start_date ? iso(trip.start_date) : today()))}"></div>
      <div><label class="f">Gasolio €/l (vuoto = ${trip.fuel_price ?? settings.vehicle?.fuel_price})</label><input type="number" step="0.001" name="fuel_price" value="${leg?.fuel_price ?? ''}" placeholder="${trip.fuel_price ?? settings.vehicle?.fuel_price}"></div></div>
    <div><label class="f">Note</label><input name="notes" value="${esc(leg?.notes || '')}"></div>
    <div id="prev" class="muted small"></div><div id="pmap" class="map sm" style="display:none"></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button type="button" class="btn" id="pv">Anteprima</button><button class="btn primary">${leg ? 'Salva' : 'Aggiungi'}</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      geoInput($('#from', el), r => from = r); geoInput($('#to', el), r => to = r);
      let pmap;
      const preview = safe(async () => {
        if (!from?.lat || !to?.lat) return toast('Seleziona partenza e arrivo dai suggerimenti', true);
        const r = await api('/route/preview', { method: 'POST', body: { from, to } });
        const price = +($('[name=fuel_price]', el).value || trip.fuel_price || settings.vehicle?.fuel_price || 0);
        const lt = r.distance_km / (trip.km_per_liter || 10);
        $('#prev', el).innerHTML = `<b>${num(r.distance_km)} km</b> · ${dur(r.duration_min * 60)} · ${num(lt)} l ≈ <b>${eur(lt * price)}</b> di gasolio${r.warning ? ' · ⚠️ ' + r.warning : ''}`;
        const m = $('#pmap', el); m.style.display = 'block'; if (!pmap) pmap = makeMap(m, { simple: true }); else pmap.eachLayer(l => l instanceof L.Polyline && pmap.removeLayer(l));
        pmap.invalidateSize(); pmap.fitBounds(L.polyline(r.geometry, { color: '#0f766e', weight: 4 }).addTo(pmap).getBounds(), { padding: [10, 10] });
      });
      $('#pv', el).onclick = preview;
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        if (!from?.lat || !to?.lat) return toast('Seleziona partenza e arrivo dai suggerimenti', true);
        const fd = Object.fromEntries(new FormData(e.target));
        const body = { from, to, date: fd.date || null, fuel_price: fd.fuel_price || null, notes: fd.notes };
        const r = leg ? await api('/legs/' + leg.id, { method: 'PUT', body }) : await api(`/trips/${trip.id}/legs`, { method: 'POST', body });
        if (r.routing_warning) toast(r.routing_warning, true);
        close(); render();
      });
    });
}

function carlockImport(trip, openTrips = []) {
  modal(`<h2>📡 Importa da CarLock</h2>
    <p class="small muted">Su <b>my.carlock.co</b> → Trips → scegli le date → icona <b>CSV</b> (va bene anche l'XLS). Ogni tragitto diventa una tappa con i km reali percorsi; il gasolio viene calcolato su quelli.</p>
    <form id="f" class="stack">
      <input type="file" name="file" accept=".csv,.xls,.xlsx,text/csv" required>
      ${trip ? '' : `<div><label class="f">In quale viaggio</label><select id="dest"><option value="new">➕ Nuovo viaggio (date prese dal file)</option>${openTrips.map(t => `<option value="${t.id}">${esc(t.title)} (${fdate(t.start_date)}${t.end_date ? ' → ' + fdate(t.end_date) : ''})</option>`).join('')}</select></div>`}
      <div class="form-grid"><div><label class="f">Ignora tratte sotto (km)</label><input type="number" step="0.5" name="min_km" value="3"></div><div><label class="f">Unisci soste più brevi di (min)</label><input type="number" name="merge_gap_min" value="30"></div></div>
      <label class="row small" id="datesRow" ${trip ? '' : 'style="display:none"'}><input type="checkbox" name="only_trip_dates" checked style="width:auto"> Solo le date del viaggio${trip ? ` (${trip.start_date ? fdate(trip.start_date) : '…'} → ${trip.end_date ? fdate(trip.end_date) : 'oggi'})` : ''}</label>
      <div class="row"><label class="row small" style="flex:0 0 auto"><input type="checkbox" id="splitChk" ${trip ? '' : 'checked'} style="width:auto"> Dividi in viaggi separati (casa → casa)</label><div class="grow"><input name="split_home" value="Susegana" placeholder="Nome di casa (es. Susegana)"></div></div>
      <div id="prev"></div>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button type="button" class="btn" id="pv">Anteprima</button><button class="btn primary" id="go" disabled>Importa</button></div>
    </form>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    const dest = () => trip ? String(trip.id) : $('#dest', el).value;
    $('#dest', el)?.addEventListener('change', () => { $('#datesRow', el).style.display = dest() === 'new' ? 'none' : ''; $('#go', el).disabled = true; });
    const fd = () => { const f = new FormData($('#f', el)); f.set('only_trip_dates', dest() !== 'new' && $('[name=only_trip_dates]', el).checked ? 'true' : 'false'); if (!$('#splitChk', el).checked) f.delete('split_home'); return f; };
    let last = null;
    // per "nuovo viaggio" l'anteprima usa un viaggio aperto qualsiasi solo per leggere il file (nessun filtro date)
    const previewTrip = () => dest() === 'new' ? 'new' : dest();
    $('#pv', el).onclick = safe(async () => {
      if (!$('[name=file]', el).files[0]) return toast('Scegli il file esportato da CarLock', true);
      $('#prev', el).innerHTML = '<div class="muted small">Analizzo il file…</div>';
      const r = last = await api(`/trips/${previewTrip()}/import/carlock?preview=1`, { method: 'POST', body: fd() });
      $('#prev', el).innerHTML = `<div class="small" style="margin-bottom:6px"><b>${r.to_import} tappe</b> per <b>${num(r.km)} km</b> · ${r.total} tragitti nel file${r.out_of_range ? `, ${r.out_of_range} fuori dalle date` : ''}${r.short ? `, ${r.short} troppo brevi` : ''}${r.duplicates ? `, ${r.duplicates} già importati` : ''}</div>
        <div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:10px"><table><tbody>${r.legs.map(l => `<tr><td class="small nowrap">${fdate(l.date)} ${l.start}</td><td class="small">${esc(l.from)} → ${esc(l.to)}${l.merged > 1 ? ` <span class="muted">(${l.merged} tratte)</span>` : ''}</td><td class="num small">${num(l.km)} km</td></tr>`).join('') || '<tr><td class="empty">Niente da importare</td></tr>'}</tbody></table></div>`;
      $('#go', el).disabled = !r.to_import;
    });
    $('#f', el).onsubmit = safe(async e => {
      e.preventDefault(); $('#go', el).disabled = true; $('#go', el).textContent = 'Importo… (geocodifica in corso)';
      let target = dest();
      if (target === 'new') {
        const t = await api('/trips', { method: 'POST', body: { title: `Viaggio CarLock ${last?.first_date ? fdate(last.first_date) : ''}`.trim(), start_date: last?.first_date || null, end_date: last?.last_date || null } });
        target = t.id;
      }
      const r = await api(`/trips/${target}/import/carlock`, { method: 'POST', body: fd() });
      close();
      if (r.split?.created?.length) { toast(`Importate ${r.imported} tappe, divise in ${r.split.created.length} viaggi`); location.hash = '#/'; render(); return; }
      if (!trip) location.hash = '#/trip/' + target;
      if (!r.imported && r.geocode_failed.length) modal(`<h2>Import non riuscito</h2><p>Nessun indirizzo è stato geocodificato (${r.geocode_failed.length} indirizzi).</p>${r.geocode_errors?.length ? `<p class="small muted">Motivo: ${esc(r.geocode_errors.join(' · '))}</p>` : ''}<p class="small">Riprova tra qualche minuto: i servizi di geocodifica gratuiti limitano le richieste.</p><div class="row" style="justify-content:flex-end"><button class="btn primary" data-x>Ok</button></div>`, (el2, close2) => $('[data-x]', el2).onclick = close2);
      else toast(`Importate ${r.imported} tappe (${num(r.km)} km)` + (r.geocode_failed.length ? ` · ${r.geocode_failed.length} indirizzi non trovati` : ''), !!r.geocode_failed.length);
      render();
    });
  });
}

function expenseForm(trip, legs, ex = null) {
  const cats = settings.categories || Object.keys(CAT);
  modal(`<h2>${ex ? 'Modifica spesa' : 'Nuova spesa'}</h2>${ex?.auto ? '<p class="small muted">Spesa calcolata automaticamente: se la modifichi non verrà più ricalcolata (potrai ripristinarla con ↺).</p>' : ''}<form id="f" class="stack" style="margin-top:14px">
    <div class="form-grid"><div><label class="f">Categoria</label><select name="category">${cats.map(c => `<option value="${c}" ${ex?.category === c ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}</select></div>
      <div><label class="f">Importo €</label><input type="number" step="0.01" name="amount" required inputmode="decimal" value="${ex?.amount ?? ''}"></div></div>
    <div class="form-grid"><div><label class="f">Data</label><input type="date" name="date" value="${ex?.date ? iso(ex.date) : today()}"></div>
      <div><label class="f">Tappa (opz.)</label><select name="leg_id"><option value="">—</option>${legs.map((l, i) => `<option value="${l.id}" ${ex?.leg_id === l.id ? 'selected' : ''}>${i + 1}. ${esc(l.to_name.split(',')[0])}</option>`).join('')}</select></div></div>
    <div><label class="f">Descrizione</label><input name="description" value="${esc(ex?.description || '')}" placeholder="Es. Traghetto Piombino–Portoferraio"></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => { $('[data-x]', el).onclick = close; $('#f', el).onsubmit = safe(async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
      if (ex) await api('/expenses/' + ex.id, { method: 'PUT', body }); else await api(`/trips/${trip.id}/expenses`, { method: 'POST', body }); close(); render(); }); });
}

function poiModal(l) {
  const p = l.pois || {};
  const gm = (lat, lon) => `https://maps.apple.com/?daddr=${lat},${lon}`;
  modal(`<h2>Lungo la tappa</h2><div class="muted small">${esc(l.from_name.split(',')[0])} → ${esc(l.to_name.split(',')[0])}${p.warning ? ' · ⚠️ ' + p.warning : ''}</div>
    <h3 style="margin:14px 0 4px">🅿️ Aree sosta e campeggi (${(p.stops || []).length})</h3>
    ${(p.stops || []).map(s => `<div class="poi"><div class="k">${s.kind === 'area_sosta' ? '🅿️' : s.kind === 'campeggio' ? '⛺' : '🚰'}</div><div class="grow"><b>${esc(s.name)}</b> <span class="muted small">${s.kind.replace('_', ' ')}</span><div class="small muted">${[s.fee && 'tariffa: ' + s.fee, s.capacity && s.capacity + ' posti', s.power && 'corrente', s.drinking_water && 'acqua', s.opening_hours].filter(Boolean).map(esc).join(' · ')}</div>${s.website ? `<a class="small" href="${esc(s.website)}" target="_blank">sito web</a> · ` : ''}<a class="small" href="${gm(s.lat, s.lon)}" target="_blank">naviga</a></div></div>`).join('') || '<div class="muted small">Nessuna area censita su OpenStreetMap nel raggio di 4 km.</div>'}
    <h3 style="margin:14px 0 4px">🏘️ Borghi e paesi attraversati (${(p.villages || []).length})</h3>
    ${(p.villages || []).map(v => `<div class="poi"><div class="k">${v.historic ? '🏰' : '🏘️'}</div><div class="grow"><b>${esc(v.name)}</b> <span class="muted small">${v.place}${v.population ? ' · ' + num(v.population, 0) + ' ab.' : ''}</span>${v.wikipedia ? ` · <a class="small" href="https://it.wikipedia.org/wiki/${encodeURIComponent(v.wikipedia.replace(/^\w+:/, ''))}" target="_blank">Wikipedia</a>` : ''}</div></div>`).join('') || '<div class="muted small">Nessun borgo trovato.</div>'}
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Chiudi</button><button class="btn ghost" data-r>Aggiorna ricerca</button></div>`,
    (el, close) => { $('[data-x]', el).onclick = close; $('[data-r]', el).onclick = safe(async () => { l.pois = await api(`/legs/${l.id}/pois`, { method: 'POST' }); close(); poiModal(l); }); });
}

// ---------- Allenamenti ----------
// Filtri dell'elenco allenamenti: periodo e viaggio, ricordati fra una schermata e l'altra
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DISCIPLINE = [['tapis', '🏃 Tapis roulant'], ['camminata', '🚶 Camminata'], ['corsa', '🏃 Corsa'], ['trekking', '🥾 Trekking'],
  ['nuoto', '🏊 Nuoto'], ['ciclismo', '🚴 Ciclismo'], ['altro', '🏅 Altro']];
const elenco = {
  discipline: [],               // elenco vuoto = tutte
  tendinaDiscipline: false,
  tapis: '',                    // '' tutti, '1' solo tapis roulant, '0' escludilo
  periodo: 'mese',              // scorciatoia attiva, oppure 'scelta'
  trips: [],                    // elenco vuoto = tutti i viaggi
  scelta: { tipo: 'giorno', giorno: today(), mese: new Date().getMonth(), anno: new Date().getFullYear(), from: null, to: null },
  tendinaAperta: false,
};
const ultimoGiorno = (anno, mese) => iso(new Date(anno, mese + 1, 0));

function intervallo(periodo) {
  const oggi = new Date();
  if (periodo === 'giorno') return [today(), today()];
  if (periodo === 'settimana') return [iso(oggi - 6 * 864e5), today()];
  if (periodo === 'mese') return [iso(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), today()];
  if (periodo === 'anno') return [`${oggi.getFullYear()}-01-01`, today()];
  if (periodo === 'scelta') {
    const c = elenco.scelta;
    if (c.tipo === 'giorno') return [c.giorno, c.giorno];
    if (c.tipo === 'mese') return [iso(new Date(c.anno, c.mese, 1)), ultimoGiorno(c.anno, c.mese)];
    if (c.tipo === 'anno') return [`${c.anno}-01-01`, `${c.anno}-12-31`];
    return [c.from, c.to];
  }
  return [null, null];
}

// Dal dettaglio si torna all'elenco dell'atleta a cui l'allenamento appartiene
const tornaAllenamenti = w => `#/allenamenti/${w.user_id || (user && user.id) || ''}`;

// Media oraria: se la sorgente non l'ha fornita la ricaviamo da distanza e durata,
// cosi' compare anche sugli allenamenti di Salute, che non la mandano mai
const mediaKmh = w => w.speed_avg_kmh ? +w.speed_avg_kmh
  : (w.distance_m && w.duration_s ? (w.distance_m / 1000) / (w.duration_s / 3600) : null);
// Metri di salita all'ora: ha senso solo dove c'e' dislivello, cioe' in bici e a piedi
// in montagna. Sul piano vale zero e il riquadro non compare.
const dislivelloOrario = w => (w.elevation_up_m > 0 && w.duration_s > 0)
  ? w.elevation_up_m / (w.duration_s / 3600) : null;

// Colonna destra della riga d'elenco: distanza, durata e le due medie, visibili
// senza dover aprire la scheda
const numeriRiga = w => `<b>${num((w.distance_m || 0) / 1000)} km</b> · ${dur(w.duration_s)}${mediaKmh(w) ? ' · ' + num(mediaKmh(w)) + ' km/h' : ''}<br>
  <span class="muted">${w.hr_avg ? '❤️ ' + w.hr_avg + ' bpm ' : ''}${w.calories ? '🔥 ' + w.calories + ' ' : ''}${w.elevation_up_m ? '⛰️ ' + w.elevation_up_m + ' m' + (dislivelloOrario(w) ? ' · ' + num(dislivelloOrario(w), 0) + ' m/h' : '') : ''}</span>`;

// Modifica dei dati di un allenamento, con la media che si aggiorna mentre scrivi
function modificaWorkout(w, dopo) {
  const campo = (id, etichetta, valore, passo, suffisso) =>
    `<div class="field"><label class="f">${etichetta}</label><input type="number" step="${passo}" min="0" id="${id}" value="${valore ?? ''}" placeholder="${suffisso}"></div>`;
  modal(`<h2>Dati dell\u2019allenamento</h2>
    <div class="row" style="margin-top:12px">
      ${campo('m-km', 'Distanza (km)', w.distance_m != null ? +(w.distance_m / 1000).toFixed(2) : '', '0.01', 'km')}
      ${campo('m-min', 'Durata (minuti)', w.duration_s != null ? Math.round(w.duration_s / 60) : '', '1', 'min')}
      ${campo('m-disl', 'Dislivello (m)', w.elevation_up_m, '1', 'm')}
    </div>
    <div class="row">
      ${campo('m-kcal', 'Calorie', w.calories, '1', 'kcal')}
      ${campo('m-hr', 'Battito medio', w.hr_avg, '1', 'bpm')}
      ${campo('m-hrmax', 'Battito massimo', w.hr_max, '1', 'bpm')}
    </div>
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="label">Media oraria</div><div class="value" id="m-media" style="font-size:22px">\u2014</div><div class="sub">da distanza e durata</div></div>
      <div class="tile"><div class="label">Dislivello orario</div><div class="value" id="m-vam" style="font-size:22px">\u2014</div><div class="sub">da dislivello e durata</div></div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Annulla</button><button class="btn primary" id="m-salva">Salva</button></div>`,
    (el, close) => {
      const aggiornaMedia = () => {
        const km = parseFloat($('#m-km', el).value), min = parseFloat($('#m-min', el).value), disl = parseFloat($('#m-disl', el).value);
        $('#m-media', el).textContent = (km > 0 && min > 0) ? num(km / (min / 60)) + ' km/h' : '\u2014';
        $('#m-vam', el).textContent = (disl > 0 && min > 0) ? num(disl / (min / 60), 0) + ' m/h' : '\u2014';
      };
      ['#m-km', '#m-min', '#m-disl'].forEach(sel => $(sel, el).addEventListener('input', aggiornaMedia));
      aggiornaMedia();
      $('[data-x]', el).onclick = close;
      $('#m-salva', el).onclick = safe(async () => {
        const v = sel => { const t = $(sel, el).value.trim(); return t === '' ? null : Number(t); };
        const km = v('#m-km'), min = v('#m-min');
        await api('/workouts/' + w.id, { method: 'PUT', body: {
          distance_m: km === null ? null : Math.round(km * 1000),
          duration_s: min === null ? null : Math.round(min * 60),
          elevation_up_m: v('#m-disl'), calories: v('#m-kcal'), hr_avg: v('#m-hr'), hr_max: v('#m-hrmax'),
        } });
        close(); toast('Dati aggiornati'); dopo?.();
      });
    });
}

// Rinomina un allenamento; usata sia dall'elenco sia dalla scheda di dettaglio
function renameWorkout(id, nome, dopo) {
  modal(`<h2>Rinomina allenamento</h2><form id="f" class="stack" style="margin-top:12px"><input name="name" value="${esc(nome || '')}" maxlength="120" required autofocus><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>Annulla</button><button class="btn primary">Salva</button></div></form>`,
    (el, close) => {
      $('[data-x]', el).onclick = close;
      $('#f', el).onsubmit = safe(async e => {
        e.preventDefault();
        const nuovo = String(new FormData(e.target).get('name') || '').trim();
        if (!nuovo) return;
        await api('/workouts/' + id, { method: 'PUT', body: { name: nuovo } });
        close(); toast('Rinominato'); dopo?.();
      });
    });
}

async function viewWorkouts(idAtleta) {
  const atleta = atleti.find(a => a.id === idAtleta) || { id: idAtleta, name: '' };
  const altri = atleti.filter(a => a.id !== idAtleta);
  const [da, a] = intervallo(elenco.periodo);
  const qs = new URLSearchParams();
  if (da) qs.set('from', da);
  if (a) qs.set('to', a);
  qs.set('user_id', String(idAtleta));
  if (elenco.trips.length) qs.set('trip_id', elenco.trips.join(','));
  if (elenco.tapis) qs.set('tapis', elenco.tapis);
  if (elenco.discipline.length) qs.set('disciplina', elenco.discipline.join(','));
  const [ws, trips, anni, quante] = await Promise.all([api('/workouts?' + qs), api('/trips'), api('/workouts/anni?user_id=' + idAtleta), api('/workouts/discipline?user_id=' + idAtleta)]);
  const k = await api('/komoot');
  const tot = { km: ws.reduce((a, w) => a + (w.distance_m || 0), 0) / 1000, kcal: ws.reduce((a, w) => a + (w.calories || 0), 0), s: ws.reduce((a, w) => a + (w.duration_s || 0), 0) };
  $('#app').innerHTML = layout(`
    <div class="row between" style="margin-bottom:16px"><h1>Allenamenti ${esc(atleta.name)}</h1><div class="row"><button class="btn" id="sync" ${k.connected ? '' : 'disabled title="Collega Komoot nelle impostazioni"'}>🔄 Sincronizza Komoot</button><button class="btn" id="dup">🔎 Doppioni</button><label class="btn">＋ JSON Salute<input type="file" id="hjson" accept=".json,application/json" hidden></label><label class="btn primary">＋ GPX<input type="file" id="gpx" accept=".gpx" hidden></label></div></div>
    <div class="card" style="margin-bottom:16px">
      <div class="chips">${[['giorno', 'Oggi'], ['settimana', '7 giorni'], ['mese', 'Questo mese'], ['anno', 'Quest\u2019anno'], ['tutto', 'Tutto'], ['scelta', 'Scegli\u2026']].map(([k2, l]) => `<span class="chip ${elenco.periodo === k2 ? 'active' : ''}" data-per="${k2}">${l}</span>`).join('')}</div>
      ${elenco.periodo === 'scelta' ? (() => { const c = elenco.scelta; return `<div class="row" style="margin-top:12px">
        <div class="field w-sm"><label class="f">Scegli per</label><select id="s-tipo">${[['giorno', 'Giorno'], ['mese', 'Mese'], ['anno', 'Anno'], ['intervallo', 'Intervallo']].map(([v, l]) => `<option value="${v}" ${c.tipo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${c.tipo === 'giorno' ? `<div class="field w-md"><label class="f">Giorno</label><input type="date" id="s-giorno" value="${c.giorno || today()}"></div>` : ''}
        ${c.tipo === 'mese' ? `<div class="field w-md"><label class="f">Mese</label><select id="s-mese">${MESI.map((m, i) => `<option value="${i}" ${c.mese === i ? 'selected' : ''}>${m}</option>`).join('')}</select></div>` : ''}
        ${c.tipo === 'mese' || c.tipo === 'anno' ? `<div class="field w-sm"><label class="f">Anno</label><select id="s-anno">${(anni.length ? anni : [new Date().getFullYear()]).map(y => `<option value="${y}" ${c.anno === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>` : ''}
        ${c.tipo === 'intervallo' ? `<div class="field w-md"><label class="f">Dal</label><input type="date" id="s-dal" value="${c.from || ''}"></div>
        <div class="field w-md"><label class="f">Al</label><input type="date" id="s-al" value="${c.to || ''}"></div>` : ''}
        <div class="field" style="align-self:flex-end"><button class="btn primary" id="s-applica">Applica</button></div>
      </div>`; })() : ''}
      <div style="margin-top:12px"><label class="f">Viaggi</label>
        <details class="tendina" id="f-viaggi" ${elenco.tendinaAperta ? 'open' : ''}>
          <summary>${(() => {
            if (!elenco.trips.length) return 'Tutti i viaggi';
            if (elenco.trips.length > 1) return `${elenco.trips.length} viaggi selezionati`;
            const v = elenco.trips[0];
            return v === 'none' ? 'Senza viaggio' : esc(trips.find(t => String(t.id) === v)?.title || 'Un viaggio');
          })()}</summary>
          <div class="tendina-corpo">
            <label><input type="checkbox" data-trip="none" ${elenco.trips.includes('none') ? 'checked' : ''}> Senza viaggio</label>
            ${trips.map(t => `<label><input type="checkbox" data-trip="${t.id}" ${elenco.trips.includes(String(t.id)) ? 'checked' : ''}> ${esc(t.title)}</label>`).join('')}
            <button class="btn" id="v-azzera" style="margin-top:6px" ${elenco.trips.length ? '' : 'disabled'}>Mostra tutti i viaggi</button>
          </div>
        </details>
        <div class="small muted" style="margin-top:6px">Puoi spuntarne pi\u00f9 di uno: l\u2019elenco somma i viaggi scelti.</div>
      </div>
      <div style="margin-top:12px"><label class="f">Disciplina</label>
        <details class="tendina" id="f-discipline" ${elenco.tendinaDiscipline ? 'open' : ''}>
          <summary>${!elenco.discipline.length ? 'Tutte le discipline'
            : elenco.discipline.length > 1 ? `${elenco.discipline.length} discipline`
            : (DISCIPLINE.find(([k]) => k === elenco.discipline[0]) || [null, 'Una disciplina'])[1]}</summary>
          <div class="tendina-corpo">
            ${DISCIPLINE.filter(([k]) => quante[k] > 0).map(([k, l]) =>
              `<label><input type="checkbox" data-disc="${k}" ${elenco.discipline.includes(k) ? 'checked' : ''}> ${l} <span class="muted">(${quante[k]})</span></label>`).join('')}
            <button class="btn" id="d-senza-tapis" style="margin-top:6px">Tutte tranne il tapis roulant</button>
            <button class="btn" id="d-azzera" ${elenco.discipline.length ? '' : 'disabled'}>Mostra tutte</button>
          </div>
        </details>
        <div class="small muted" style="margin-top:6px">Puoi spuntarne pi\u00f9 di una. Il numero fra parentesi \u00e8 quante ne hai in archivio.</div>
      </div>
    </div>
    <div class="tiles" style="margin-bottom:16px"><div class="tile accent"><div class="label">Attività</div><div class="value">${ws.length}</div><div class="sub">${!da && !a ? 'tutto l\u2019archivio' : da && a && da === a ? fdate(da) : (da ? 'dal ' + fdate(da) : 'fino al') + (a && da ? ' al ' + fdate(a) : a ? ' ' + fdate(a) : '')}</div></div><div class="tile"><div class="label">Distanza</div><div class="value">${num(tot.km)} km</div></div><div class="tile"><div class="label">Tempo</div><div class="value">${dur(tot.s)}</div></div><div class="tile"><div class="label">Calorie</div><div class="value">${num(tot.kcal, 0)}</div></div></div>
    ${!k.connected ? '<div class="card small" style="margin-bottom:14px">💡 Collega Komoot in <a href="#/impostazioni">Impostazioni</a> per scaricare i percorsi automaticamente, e aggiungi i tuoi iPhone per battito e calorie.</div>' : ''}
    ${altri.length ? `<div class="card" id="barra-scelta" hidden style="margin-bottom:12px">
      <div class="row between"><div><b id="quanti-scelti">0</b> selezionati</div>
      <div class="row">${altri.map(a => `<button class="btn primary" data-copia="${a.id}">Copia in Allenamenti ${esc(a.name)}</button>`).join('')}
      <button class="btn" id="scelta-annulla">Annulla</button></div></div></div>` : ''}
    <div class="card pad-0 list">${ws.map(w => `<div class="item">${altri.length ? `<input type="checkbox" class="scelta" value="${w.id}" title="Seleziona">` : ''}<a class="item-main" href="#/allenamento/${w.id}"><div class="sport-ico">${sportIco(w.sport)}</div><div class="grow"><div class="title">${esc(w.name || w.sport || 'Allenamento')}</div>
      <div class="meta">${fdt(w.started_at)} · ${esc(w.athlete)} · <span class="badge">${w.source}</span>${w.trip_title ? ` · <span class="badge link" title="Collegato al viaggio">🔗 ${esc(w.trip_title)}</span>` : ''}</div></div>
      <div class="right small nowrap">${numeriRiga(w)}</div></a>
      <div class="item-actions"><button class="btn ghost icon" data-ren="${w.id}" data-name="${esc(w.name || w.sport || 'Allenamento')}" title="Rinomina">✏️</button><button class="btn ghost danger icon" data-del="${w.id}" title="Elimina">🗑</button></div></div>`).join('') || (elenco.periodo === 'tutto' && !elenco.trips.length ? '<div class="empty">Nessun allenamento ancora. Collega Komoot o carica un file GPX.</div>' : '<div class="empty">Nessun allenamento con questi filtri.</div>')}</div>`);
  $('#sync').onclick = safe(async () => { toast('Sincronizzazione…'); const r = await api('/komoot/sync', { method: 'POST', body: {} }); toast(`Importati ${r.imported} nuovi tour`); render(); });
  $('#gpx').onchange = safe(async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); await api('/workouts/gpx', { method: 'POST', body: fd }); toast('GPX importato'); render(); });
  $('#hjson').onchange = safe(async e => {
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    toast('Importazione in corso\u2026');
    const r = await api('/workouts/health-json', { method: 'POST', body: fd });
    toast(`Letti ${r.letti}: ${r.saved} salvati, ${r.merged} uniti ad attivit\u00e0 esistenti`); render();
  });
  $$('[data-per]').forEach(c => c.onclick = () => { elenco.periodo = c.dataset.per; render(); });
  if ($('#s-tipo')) $('#s-tipo').onchange = e => { elenco.scelta.tipo = e.target.value; render(); };
  if ($('#s-applica')) $('#s-applica').onclick = () => {
    const c = elenco.scelta;
    if ($('#s-giorno')) c.giorno = $('#s-giorno').value || today();
    if ($('#s-mese')) c.mese = +$('#s-mese').value;
    if ($('#s-anno')) c.anno = +$('#s-anno').value;
    if ($('#s-dal')) c.from = $('#s-dal').value || null;
    if ($('#s-al')) c.to = $('#s-al').value || null;
    render();
  };
  $('#f-discipline').ontoggle = e => { elenco.tendinaDiscipline = e.target.open; if (e.target.open) sistemaTendina(e.target); };
  $$('[data-disc]').forEach(c => c.onchange = () => {
    const v = c.dataset.disc;
    elenco.discipline = c.checked ? [...elenco.discipline, v] : elenco.discipline.filter(x => x !== v);
    render();
  });
  $('#d-senza-tapis').onclick = () => { elenco.discipline = DISCIPLINE.map(([k]) => k).filter(k => k !== 'tapis' && quante[k] > 0); render(); };
  $('#d-azzera').onclick = () => { elenco.discipline = []; render(); };
  $('#f-viaggi').ontoggle = e => { elenco.tendinaAperta = e.target.open; if (e.target.open) sistemaTendina(e.target); };
  $$('[data-trip]').forEach(c => c.onchange = () => {
    const v = c.dataset.trip;
    elenco.trips = c.checked ? [...elenco.trips, v] : elenco.trips.filter(x => x !== v);
    render();
  });
  $('#v-azzera').onclick = () => { elenco.trips = []; render(); };
  $('#dup').onclick = safe(async () => {
    const { gruppi, totale_da_eliminare } = await api('/workouts/duplicates');
    if (!gruppi.length) return toast('Nessun doppione trovato');
    const riga = w => `<div class="small">${sportIco(w.sport)} <b>${esc(w.name || w.sport || 'Allenamento')}</b> · ${fdt(w.started_at)} · ${esc(w.athlete)}
      · <span class="badge">${w.source}</span> · ${num((w.distance_m || 0) / 1000)} km · ${dur(w.duration_s)}${w.has_track ? ' · 🗺️ traccia' : ''}${w.calories ? ' · 🔥 ' + w.calories : ''}${w.hr_avg ? ' · ❤️ ' + w.hr_avg : ''}</div>`;
    modal(`<h2>${gruppi.length} possibil${gruppi.length === 1 ? 'e doppione' : 'i doppioni'}</h2>
      <p class="small muted">Di ogni gruppo tengo il record pi\u00f9 completo e propongo di eliminare gli altri. Togli la spunta a quelli che vuoi conservare.</p>
      <div class="stack" style="margin-top:12px;max-height:50vh;overflow:auto">${gruppi.map((g, i) => `<div class="card" style="padding:12px">
        <div class="small muted" style="margin-bottom:6px">Gruppo ${i + 1} — tengo questo:</div>${riga(g.tieni)}
        <div class="small muted" style="margin:8px 0 6px">da eliminare:</div>
        ${g.elimina.map(w => `<label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" class="dupchk" value="${w.id}" checked>${riga(w)}</label>`).join('')}
      </div>`).join('')}</div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Annulla</button><button class="btn danger" id="godup">Elimina i selezionati (${totale_da_eliminare})</button></div>`,
      (el, close) => {
        $('[data-x]', el).onclick = close;
        $('#godup', el).onclick = safe(async () => {
          const ids = $$('.dupchk', el).filter(c => c.checked).map(c => +c.value);
          if (!ids.length) return toast('Nessun allenamento selezionato', true);
          if (!await confirmDlg(ids.length === 1 ? 'Eliminare questo allenamento? L\u2019operazione non si annulla.' : `Eliminare ${ids.length} allenamenti? L\u2019operazione non si annulla.`)) return;
          const r = await api('/workouts/duplicates/remove', { method: 'POST', body: { ids } });
          close(); toast(r.eliminati === 1 ? 'Eliminato 1 allenamento' : `Eliminati ${r.eliminati} allenamenti`); render();
        });
      });
  });
  const scelti = () => $$('.scelta').filter(c => c.checked).map(c => +c.value);
  const aggiornaBarra = () => {
    const n = scelti().length, barra = $('#barra-scelta');
    if (!barra) return;
    barra.hidden = n === 0;
    $('#quanti-scelti').textContent = n;
  };
  $$('.scelta').forEach(c => c.onchange = aggiornaBarra);
  if ($('#scelta-annulla')) $('#scelta-annulla').onclick = () => { $$('.scelta').forEach(c => { c.checked = false; }); aggiornaBarra(); };
  $$('[data-copia]').forEach(b => b.onclick = safe(async () => {
    const ids = scelti();
    if (!ids.length) return;
    const nome = b.textContent.replace('Copia in Allenamenti ', '');
    if (!await confirmDlg(`Copiare ${ids.length === 1 ? 'questo allenamento' : ids.length + ' allenamenti'} negli allenamenti di ${nome}?`)) return;
    const r = await api('/workouts/copy', { method: 'POST', body: { ids, to_user_id: +b.dataset.copia } });
    toast(`${r.copiati} copiat${r.copiati === 1 ? 'o' : 'i'} per ${r.atleta}` + (r.gia_presenti ? `, ${r.gia_presenti} gi\u00e0 presenti` : ''));
    render();
  }));
  $$('[data-ren]').forEach(b => b.onclick = () => renameWorkout(b.dataset.ren, b.dataset.name, render));
  $$('[data-del]').forEach(b => b.onclick = safe(async () => {
    if (!await confirmDlg('Eliminare l\'allenamento?')) return;
    await api('/workouts/' + b.dataset.del, { method: 'DELETE' });
    toast('Allenamento eliminato'); render();
  }));
}
async function viewWorkout(id) {
  const w = await api('/workouts/' + id);
  const trips = await api('/trips');
  const stat = (l, v) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div></div>`;
  $('#app').innerHTML = layout(`<a href="${tornaAllenamenti(w)}" class="small">← Allenamenti ${esc(w.athlete || '')}</a><div class="row between" style="margin:4px 0 14px"><h1>${sportIco(w.sport)} ${esc(w.name || w.sport || 'Allenamento')}</h1><div class="row nowrap" style="gap:6px"><button class="btn" id="mod">Modifica dati</button><button class="btn ghost icon" id="ren" title="Rinomina">✏️</button><button class="btn ghost danger icon" id="del" title="Elimina">🗑</button></div></div>
    <div class="muted small" style="margin-bottom:12px">${fdt(w.started_at)} · ${esc(w.athlete)} · fonte: ${w.source}${w.meta?.komoot_url ? ` · <a href="${esc(w.meta.komoot_url)}" target="_blank">apri su Komoot</a>` : ''}${w.meta?.merged_from_health ? ' · battito e calorie da iPhone' : ''}${w.trip_title ? ` · <span class="badge link" title="Collegato al viaggio">🔗 ${esc(w.trip_title)}</span>` : ''}</div>
    <div class="tiles" style="margin-bottom:14px">${stat('Distanza', num((w.distance_m || 0) / 1000) + ' km')}${stat('Durata', dur(w.duration_s))}${stat('Media oraria', mediaKmh(w) ? num(mediaKmh(w)) + ' km/h' : '—')}${stat('Dislivello', (w.elevation_up_m || 0) + ' m')}${dislivelloOrario(w) ? stat('Dislivello orario', num(dislivelloOrario(w), 0) + ' m/h') : ''}${stat('❤️ Medio', w.hr_avg ? w.hr_avg + ' bpm' : '—')}${stat('❤️ Max', w.hr_max ? w.hr_max + ' bpm' : '—')}${stat('Calorie', w.calories ? w.calories + ' kcal' : '—')}</div>
    ${w.track ? '<div class="card pad-0"><div id="map" class="map tall"></div></div>' : '<div class="card muted">Nessuna traccia GPS per questo allenamento.</div>'}
    <div class="card" style="margin-top:14px"><div class="row"><div class="grow"><label class="f">Associato al viaggio</label>
      <select id="trip">
        <option value="auto" ${w.trip_manual ? '' : 'selected'}>Automatico, in base alle date</option>
        <option value="" ${w.trip_manual && !w.trip_id ? 'selected' : ''}>Nessun viaggio</option>
        ${trips.map(t => `<option value="${t.id}" ${w.trip_manual && w.trip_id === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}
      </select>
      <div class="small muted" style="margin-top:6px">${w.trip_manual
        ? (w.trip_id ? 'Scelta tua: resta su questo viaggio anche se le date non coincidono.' : 'Scelta tua: resta senza viaggio, l\u2019abbinamento automatico non lo tocca.')
        : (w.trip_title ? `Abbinato da solo a «${esc(w.trip_title)}» perché la data ricade nel periodo.` : 'Nessun viaggio copre questa data.')}</div>
      </div></div></div>`);
  if (w.track) { const map = makeMap($('#map')); const pl = L.polyline(w.track.map(p => [p[0], p[1]]), { color: '#ec4899', weight: 4 }).addTo(map); map.fitBounds(pl.getBounds(), { padding: [20, 20] });
    L.marker(w.track[0], { icon: pin('#16a34a', '▶') }).addTo(map); L.marker(w.track[w.track.length - 1], { icon: pin('#dc2626', '■') }).addTo(map); }
  $('#trip').onchange = safe(async e => {
    const v = e.target.value;
    await api('/workouts/' + id, { method: 'PUT', body: v === 'auto' ? { trip_auto: true } : { trip_id: v || null } });
    toast(v === 'auto' ? 'Torna all\u2019abbinamento automatico' : 'Salvato'); render();
  });
  $('#mod').onclick = () => modificaWorkout(w, render);
  $('#ren').onclick = () => renameWorkout(id, w.name || w.sport || '', render);
  $('#del').onclick = safe(async () => { if (await confirmDlg('Eliminare l\'allenamento?')) { await api('/workouts/' + id, { method: 'DELETE' }); location.hash = tornaAllenamenti(w); } });
}

// ---------- Cruscotto ----------
// Ogni filtro e' un elenco: vuoto significa "nessun vincolo", piu' valori si sommano
const dash = { trips: [], stati: [], atleti: [], sport: [], fonti: [], anni: [], mesi: [], from: '', to: '', q: '', aperte: {} };
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// Menu a tendina con scelta multipla, riusato da tutti i filtri del Cruscotto
function tendinaMulti(id, etichetta, voci, scelti, vuoto) {
  const testo = !scelti.length ? vuoto
    : scelti.length > 1 ? `${scelti.length} selezionate`
    : (voci.find(v => v.valore === scelti[0]) || { nome: scelti[0] }).nome;
  return `<div class="field w-md"><label class="f">${etichetta}</label>
    <details class="tendina" data-tendina="${id}" ${dash.aperte[id] ? 'open' : ''}>
      <summary>${esc(String(testo))}</summary>
      <div class="tendina-corpo">
        ${voci.map(v => `<label><input type="checkbox" data-filtro="${id}" value="${esc(v.valore)}" ${scelti.includes(v.valore) ? 'checked' : ''}> ${esc(v.nome)}${v.quanti != null ? ` <span class="muted">(${v.quanti})</span>` : ''}</label>`).join('')}
        <button class="btn" data-azzera="${id}" ${scelti.length ? '' : 'disabled'}>Tutte</button>
      </div>
    </details></div>`;
}

async function viewDashboard() {
  const [ws, trips] = await Promise.all([api('/workouts'), api('/trips')]);
  // Con piu' atleti, e con le copie di uno stesso giro su entrambi, partire da
  // "tutti" raddoppierebbe i totali. Si parte da chi e' collegato.
  if (!dash.avviato) { dash.avviato = true; if (atleti.length > 1) dash.atleti = [user.name]; }
  // Le voci di ogni menu vengono dai dati, col numero di attivita' accanto
  const conteggio = (chiave, trasforma = v => v) => {
    const m = new Map();
    ws.forEach(w => { const v = trasforma(w[chiave] ?? w); if (v != null && v !== '') m.set(v, (m.get(v) || 0) + 1); });
    return m;
  };
  const daMappa = (m, nome = v => String(v)) => [...m.entries()].sort((a, b) => b[1] - a[1])
    .map(([valore, quanti]) => ({ valore: String(valore), nome: nome(valore), quanti }));

  const annoDi = w => String(new Date(w.started_at).getFullYear());
  const meseDi = w => String(new Date(w.started_at).getMonth());

  const vociAtleti = daMappa(conteggio('athlete'));
  const vociSport = daMappa(conteggio('sport'));
  const vociFonti = daMappa(conteggio('source'));
  const vociAnni = [...conteggio(null, annoDi).entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([valore, quanti]) => ({ valore, nome: valore, quanti }));
  const vociMesi = [...conteggio(null, meseDi).entries()].sort((a, b) => +a[0] - +b[0])
    .map(([valore, quanti]) => ({ valore, nome: MESI_BREVI[+valore], quanti }));
  const vociViaggi = [{ valore: 'none', nome: 'Senza viaggio' }, ...trips.map(t => ({ valore: String(t.id), nome: t.title }))];
  const vociStati = [{ valore: 'open', nome: 'Aperti' }, { valore: 'closed', nome: 'Chiusi' }];

  // Filtra gli allenamenti: un elenco vuoto non vincola, piu' valori si sommano
  const filtra = () => {
    const q = dash.q.trim().toLowerCase();
    const idsStato = new Set(trips.filter(t => dash.stati.includes(t.status)).map(t => t.id));
    return ws.filter(w => {
      if (dash.trips.length && !dash.trips.includes(w.trip_id ? String(w.trip_id) : 'none')) return false;
      if (dash.stati.length && !(w.trip_id && idsStato.has(w.trip_id))) return false;
      if (dash.atleti.length && !dash.atleti.includes(w.athlete)) return false;
      if (dash.sport.length && !dash.sport.includes(w.sport)) return false;
      if (dash.fonti.length && !dash.fonti.includes(w.source)) return false;
      if (dash.anni.length && !dash.anni.includes(annoDi(w))) return false;
      if (dash.mesi.length && !dash.mesi.includes(meseDi(w))) return false;
      const d = iso(w.started_at);
      if (dash.from && d < dash.from) return false;
      if (dash.to && d > dash.to) return false;
      if (q && !`${w.name || ''} ${w.sport || ''} ${w.trip_title || ''} ${w.athlete || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  };

  $('#app').innerHTML = layout(`<div class="row between" style="margin-bottom:12px"><h1>Cruscotto</h1><button class="btn" id="reset">Azzera filtri</button></div>
    <div class="card">
      <div class="row">
        ${tendinaMulti('trips', 'Viaggio', vociViaggi, dash.trips, 'Tutti i viaggi')}
        ${tendinaMulti('stati', 'Stato', vociStati, dash.stati, 'Tutti')}
        ${tendinaMulti('atleti', 'Atleta', vociAtleti, dash.atleti, 'Tutti')}
        ${tendinaMulti('sport', 'Sport', vociSport, dash.sport, 'Tutti')}
        ${tendinaMulti('anni', 'Anno', vociAnni, dash.anni, 'Tutti')}
        ${tendinaMulti('mesi', 'Mese', vociMesi, dash.mesi, 'Tutti')}
        ${tendinaMulti('fonti', 'Fonte', vociFonti, dash.fonti, 'Tutte')}
      </div>
      <div class="row" style="margin-top:4px">
        <div class="field w-md"><label class="f">Dal</label><input type="date" id="f-from" value="${dash.from}"></div>
        <div class="field w-md"><label class="f">Al</label><input type="date" id="f-to" value="${dash.to}"></div>
        <div class="field grow" style="min-width:180px"><label class="f">Cerca</label><input id="f-q" placeholder="Nome allenamento, sport o viaggio" value="${esc(dash.q)}"></div>
      </div>
      <div class="small muted" style="margin-top:8px">In ogni menu puoi spuntare piu' voci: i valori scelti si sommano.</div>
    </div>
    <div id="out"></div>`);

  const disegna = () => {
    const f = filtra();
    const t = f.reduce((a, w) => ({ n: a.n + 1, km: a.km + (w.distance_m || 0) / 1000, s: a.s + (w.duration_s || 0), kcal: a.kcal + (w.calories || 0), up: a.up + (w.elevation_up_m || 0), hr: a.hr + (w.hr_avg || 0), hrn: a.hrn + (w.hr_avg ? 1 : 0) }),
      { n: 0, km: 0, s: 0, kcal: 0, up: 0, hr: 0, hrn: 0 });

    const perSport = {};
    f.forEach(w => { const k = w.sport || 'altro'; perSport[k] = (perSport[k] || 0) + (w.distance_m || 0) / 1000; });
    const sportOrd = Object.entries(perSport).sort((a, b) => b[1] - a[1]);
    const maxKm = Math.max(1, ...sportOrd.map(x => x[1]));

    const perTrip = {};
    f.forEach(w => { const k = w.trip_id || 0; (perTrip[k] ||= { titolo: w.trip_title || 'Senza viaggio', n: 0, km: 0, kcal: 0, s: 0 }); const r = perTrip[k]; r.n++; r.km += (w.distance_m || 0) / 1000; r.kcal += w.calories || 0; r.s += w.duration_s || 0; });
    const tripOrd = Object.entries(perTrip).sort((a, b) => b[1].km - a[1].km);
    const datiViaggio = id => trips.find(x => x.id === +id);
    // I km del camper vengono dalle tappe del viaggio, non dagli allenamenti:
    // sono due grandezze diverse e vanno tenute separate.
    const kmCamper = tripOrd.reduce((a, [id]) => a + (datiViaggio(id)?.km || 0), 0);

    const MAX = 60;
    $('#out').innerHTML = `
      ${atleti.length > 1 && dash.atleti.length !== 1 ? `<div class="card small" style="margin:14px 0 0;border-left:3px solid var(--warn)">
        \u26a0\ufe0f Stai guardando ${dash.atleti.length ? 'pi\u00f9 atleti insieme' : 'tutti gli atleti insieme'}: un giro copiato su entrambi viene contato due volte.</div>` : ''}
      <div class="tiles" style="margin:14px 0">
        <div class="tile accent"><div class="label">Attività</div><div class="value">${t.n}</div><div class="sub">su ${ws.length} totali</div></div>
        <div class="tile"><div class="label">Km allenamento</div><div class="value">${num(t.km)} km</div></div>
        <div class="tile"><div class="label">Km in camper</div><div class="value">${num(kmCamper, 0)} km</div><div class="sub">dei viaggi in elenco</div></div>
        <div class="tile"><div class="label">Tempo</div><div class="value">${dur(t.s)}</div></div>
        <div class="tile"><div class="label">Calorie</div><div class="value">${num(t.kcal, 0)}</div></div>
        <div class="tile"><div class="label">Dislivello</div><div class="value">${num(t.up, 0)} m</div></div>
        <div class="tile"><div class="label">Battito medio</div><div class="value">${t.hrn ? Math.round(t.hr / t.hrn) + ' bpm' : '—'}</div></div>
      </div>
      <div class="grid cols-2">
        <div class="card"><h2>Km di allenamento per sport</h2><div class="small muted">i km in camper sono nella tabella accanto</div>
          <div class="barre-oriz">${sportOrd.map(([k, v]) => `<div class="barra-oriz">
            <div class="riga"><span class="etichetta">${sportIco(k)} ${esc(k)}</span><b class="valore">${num(v)} km</b></div>
            <span class="traccia"><i style="width:${Math.max(2, v / maxKm * 100)}%"></i></span></div>`).join('') || '<div class="empty">Nessun dato con questi filtri</div>'}</div></div>
        <div class="card pad-0"><div style="padding:14px 16px 6px"><h2>Per viaggio</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Viaggio</th><th class="num">Km camper</th><th class="num">Attività</th><th class="num">Km allenam.</th><th class="num">Tempo</th><th class="num">Spesa</th></tr></thead>
          <tbody>${tripOrd.map(([id, r]) => { const v = datiViaggio(id); return `<tr><td>${+id ? `<a href="#/trip/${id}">${esc(r.titolo)}</a>` : `<span class="muted">${esc(r.titolo)}</span>`}${v ? ` <span class="badge ${v.status === 'open' ? 'open' : 'closed'}">${v.status === 'open' ? 'aperto' : 'chiuso'}</span>` : ''}</td><td class="num">${v ? num(v.km, 0) : '—'}</td><td class="num">${r.n}</td><td class="num">${num(r.km)}</td><td class="num">${dur(r.s)}</td><td class="num">${v ? eur(v.total) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nessun dato con questi filtri</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="card pad-0" style="margin-top:14px"><div class="row between" style="padding:14px 16px 6px"><h2>Allenamenti (${f.length})</h2>${f.length > MAX ? `<span class="small muted">mostrati i primi ${MAX}</span>` : ''}</div>
        <div class="list">${f.slice(0, MAX).map(w => `<div class="item"><a class="item-main" href="#/allenamento/${w.id}"><div class="sport-ico">${sportIco(w.sport)}</div><div class="grow"><div class="title">${esc(w.name || w.sport || 'Allenamento')}</div>
          <div class="meta">${fdt(w.started_at)} · ${esc(w.athlete)} · <span class="badge">${w.source}</span>${w.trip_title ? ` · <span class="badge link">🔗 ${esc(w.trip_title)}</span>` : ''}</div></div>
          <div class="right small nowrap">${numeriRiga(w)}</div></a></div>`).join('') || '<div class="empty">Nessun allenamento corrisponde ai filtri.</div>'}</div></div>`;
  };

  const lega = (sel, chiave, evento = 'change') => { const el = $(sel); el.addEventListener(evento, () => { dash[chiave] = el.value; disegna(); }); };
  lega('#f-from', 'from'); lega('#f-to', 'to'); lega('#f-q', 'q', 'input');

  // Le tendine si aggiornano sul posto invece di ridisegnare tutta la pagina: cosi'
  // restano aperte e la ricerca testuale non perde il cursore
  const vociPer = { trips: vociViaggi, stati: vociStati, atleti: vociAtleti, sport: vociSport, anni: vociAnni, mesi: vociMesi, fonti: vociFonti };
  const vuotoPer = { trips: 'Tutti i viaggi', stati: 'Tutti', atleti: 'Tutti', sport: 'Tutti', anni: 'Tutti', mesi: 'Tutti', fonti: 'Tutte' };
  const aggiornaTendina = id => {
    const scelti = dash[id], voci = vociPer[id];
    const testo = !scelti.length ? vuotoPer[id]
      : scelti.length > 1 ? `${scelti.length} selezionate`
      : (voci.find(v => v.valore === scelti[0]) || { nome: scelti[0] }).nome;
    $(`[data-tendina="${id}"] summary`).textContent = testo;
    $(`[data-azzera="${id}"]`).disabled = !scelti.length;
  };
  $$('[data-tendina]').forEach(d => d.ontoggle = () => {
    dash.aperte[d.dataset.tendina] = d.open;
    if (d.open) sistemaTendina(d);
  });
  $$('[data-filtro]').forEach(c => c.onchange = () => {
    const id = c.dataset.filtro;
    dash[id] = c.checked ? [...dash[id], c.value] : dash[id].filter(x => x !== c.value);
    aggiornaTendina(id); disegna();
  });
  $$('[data-azzera]').forEach(b => b.onclick = () => {
    const id = b.dataset.azzera;
    dash[id] = [];
    $$(`[data-filtro="${id}"]`).forEach(x => { x.checked = false; });
    aggiornaTendina(id); disegna();
  });
  $('#reset').onclick = () => {
    ['trips', 'stati', 'atleti', 'sport', 'fonti', 'anni', 'mesi'].forEach(k => { dash[k] = []; });
    if (atleti.length > 1) dash.atleti = [user.name];   // azzerare non deve rimettere insieme gli atleti
    dash.from = ''; dash.to = ''; dash.q = ''; dash.aperte = {};
    render();
  };
  disegna();
}

// ---------- Riepiloghi ----------
const state = { period: 'month', from: null, to: null, group: 'month', atleta: null, avviato: false };
async function viewSummary() {
  const now = new Date();
  const presets = { week: [iso(now - 6 * 864e5), today(), 'day'], month: [iso(new Date(now.getFullYear(), now.getMonth(), 1)), today(), 'day'], year: [`${now.getFullYear()}-01-01`, today(), 'month'], all: ['2000-01-01', today(), 'year'], custom: null };
  if (state.period !== 'custom') [state.from, state.to, state.group] = presets[state.period];
  // Come nel Cruscotto: di partenza gli allenamenti sono quelli di chi e' collegato,
  // per non sommare le copie dello stesso giro presenti su piu' atleti
  if (!state.avviato) { state.avviato = true; if (atleti.length > 1) state.atleta = user.id; }
  const s = await api(`/summary?from=${state.from}&to=${state.to}&group=${state.group}${state.atleta ? '&user_id=' + state.atleta : ''}`);
  const periods = [...new Set([...s.periods.map(p => p.period), ...s.km.map(p => p.period), ...s.workouts.map(p => p.period)])].sort();
  const fmtP = p => state.group === 'year' ? p.slice(0, 4) : state.group === 'month' ? new Date(p).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }) : new Date(p).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const spentBy = Object.fromEntries(periods.map(p => [p, s.periods.filter(x => x.period === p).reduce((a, b) => a + b.total, 0)]));
  const max = Math.max(1, ...Object.values(spentBy));
  const kmBy = Object.fromEntries(s.km.map(k => [k.period, k.km]));
  const woBy = Object.fromEntries(s.workouts.map(k => [k.period, k]));
  // Scale separate: i km in camper sono di un ordine di grandezza piu' grandi
  const maxKmCamper = Math.max(1, ...Object.values(kmBy));
  const maxKmSport = Math.max(1, ...Object.values(woBy).map(x => x.km || 0));
  const total = s.totals.spent || 1;
  let acc = 0; const grad = s.by_category.map(c => { const a = acc; acc += c.total / total * 100; return `${catColor(c.category)} ${a}% ${acc}%`; }).join(', ');
  $('#app').innerHTML = layout(`<h1 style="margin-bottom:12px">Riepiloghi</h1>
    <div class="card"><div class="chips">${[['week', '7 giorni'], ['month', 'Questo mese'], ['year', 'Quest\'anno'], ['all', 'Tutto'], ['custom', 'Periodo…']].map(([k, l]) => `<span class="chip ${state.period === k ? 'active' : ''}" data-p="${k}">${l}</span>`).join('')}</div>
      <div class="row" style="margin-top:12px"><div class="field w-md"><label class="f">Dal</label><input type="date" id="from" value="${state.from}"></div><div class="field w-md"><label class="f">Al</label><input type="date" id="to" value="${state.to}"></div>
      ${atleti.length > 1 ? `<div class="field w-sm"><label class="f">Allenamenti di</label><select id="f-atleta">
        <option value="">Tutti insieme</option>${atleti.map(a => `<option value="${a.id}" ${state.atleta === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field w-sm"><label class="f">Raggruppa</label><select id="group">${[['day', 'Giorno'], ['week', 'Settimana'], ['month', 'Mese'], ['year', 'Anno']].map(([k, l]) => `<option value="${k}" ${state.group === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field" style="align-self:flex-end"><button class="btn primary" id="go">Applica</button></div></div></div>
    <div class="tiles" style="margin:14px 0"><div class="tile accent"><div class="label">Speso</div><div class="value">${eur(s.totals.spent)}</div><div class="sub">${s.totals.trips} viaggi</div></div><div class="tile"><div class="label">Km in camper</div><div class="value">${num(s.totals.km, 0)}</div><div class="sub">${s.totals.legs} tappe · ${s.totals.km ? eur(s.totals.spent / s.totals.km) + '/km' : ''}</div></div><div class="tile"><div class="label">Allenamenti</div><div class="value">${s.totals.workouts}</div><div class="sub">${num(s.totals.workout_km)} km</div></div><div class="tile"><div class="label">Calorie</div><div class="value">${num(s.totals.calories, 0)}</div></div></div>
    <div class="grid cols-2">
      <div class="card"><h2>Spese per ${({ day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' })[state.group]}</h2>
        <div class="bars">${periods.map(p => `<div class="bar" title="${fmtP(p)}: ${eur(spentBy[p])}"><i style="height:${(spentBy[p] || 0) / max * 100}%"></i><b>${fmtP(p)}</b></div>`).join('') || '<div class="empty grow">Nessun dato nel periodo</div>'}</div></div>
      <div class="card"><h2>Per categoria</h2><div class="donut" style="margin-top:10px"><div class="ring" style="background:conic-gradient(${grad || 'var(--surface-2) 0 100%'})"><b>${eur(s.totals.spent)}</b></div>
        <div class="legend" style="flex-direction:column;gap:6px">${s.by_category.map(c => `<span><i class="dot" style="display:inline-block;background:${catColor(c.category)}"></i>${catLabel(c.category)} <b>${eur(c.total)}</b> <span class="muted">${Math.round(c.total / total * 100)}%</span></span>`).join('') || '<span class="muted">—</span>'}</div></div></div>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card"><h2>Km in camper</h2><div class="small muted">dalle tappe del viaggio</div>
        <div class="bars">${periods.map(p => `<div class="bar" title="${fmtP(p)}: ${num(kmBy[p] || 0, 0)} km in camper"><i style="height:${(kmBy[p] || 0) / maxKmCamper * 100}%"></i><b>${fmtP(p)}</b></div>`).join('') || '<div class="empty grow">Nessun dato nel periodo</div>'}</div></div>
      <div class="card"><h2>Km di allenamento</h2><div class="small muted">a piedi, in bici e le altre attività</div>
        <div class="bars">${periods.map(p => `<div class="bar" title="${fmtP(p)}: ${num(woBy[p]?.km || 0)} km di attività"><i class="sport" style="height:${(woBy[p]?.km || 0) / maxKmSport * 100}%"></i><b>${fmtP(p)}</b></div>`).join('') || '<div class="empty grow">Nessun dato nel periodo</div>'}</div></div>
    </div>
    <div class="small muted" style="margin:6px 2px 0">I due grafici hanno scale indipendenti: le altezze non sono confrontabili fra loro.${atleti.length > 1 ? ` Gli allenamenti mostrati sono ${state.atleta ? 'di ' + esc((atleti.find(a => a.id === state.atleta) || {}).name || '') : 'di tutti gli atleti insieme'}; spese e chilometri in camper riguardano il viaggio e restano comuni.` : ''}</div>
    <div class="card pad-0" style="margin-top:14px"><div class="table-wrap"><table><thead><tr><th>Periodo</th><th class="num">Spese</th><th class="num">Km camper</th><th class="num">Allenamenti</th><th class="num">Km allenamento</th><th class="num">Calorie</th><th class="num">❤️ medio</th></tr></thead>
      <tbody>${periods.map(p => `<tr><td>${fmtP(p)}</td><td class="num"><b>${eur(spentBy[p])}</b></td><td class="num">${num(kmBy[p] || 0, 0)}</td><td class="num">${woBy[p]?.n || 0}</td><td class="num">${num(woBy[p]?.km || 0)}</td><td class="num">${num(woBy[p]?.calories || 0, 0)}</td><td class="num">${woBy[p]?.hr_avg || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nessun dato</td></tr>'}</tbody></table></div></div>`);
  $$('.chip').forEach(c => c.onclick = () => { state.period = c.dataset.p; render(); });
  $('#go').onclick = () => { state.period = 'custom'; state.from = $('#from').value; state.to = $('#to').value; state.group = $('#group').value; render(); };
  if ($('#f-atleta')) $('#f-atleta').onchange = e => { state.atleta = e.target.value ? +e.target.value : null; render(); };
}

// ---------- Impostazioni ----------
async function viewSettings() {
  const v = settings.vehicle || {};
  const devices = await api('/auth/devices');
  const k = await api('/komoot');
  const st = await api('/strava');
  // Messaggio di ritorno dal giro su Strava, poi ripuliamo l'indirizzo
  const esitoStrava = (location.hash.match(/[?&]strava=([^&]+)/) || [])[1];
  if (esitoStrava) {
    const messaggi = { collegato: ['Strava collegato', false], negato: ['Autorizzazione negata su Strava', true], 'stato-non-valido': ['Richiesta non valida, riprova', true], errore: ['Collegamento a Strava fallito', true] };
    const [testo, err] = messaggi[decodeURIComponent(esitoStrava)] || ['Esito sconosciuto', true];
    toast(testo, err);
    history.replaceState(null, '', '#/impostazioni');
  }
  const adm = user.role === 'admin' ? await api('/auth/users') : null;
  const endpoint = location.origin + '/api/ingest/health';
  $('#app').innerHTML = layout(`<h1 style="margin-bottom:12px">Impostazioni</h1>
    <div class="grid cols-2">
    <div class="card"><h2>🚐 Camper</h2><form id="veh" class="form-grid" style="margin-top:12px"><div><label class="f">Lunghezza (m)</label><input type="number" step="0.1" name="length_m" value="${v.length_m ?? 6}"></div><div><label class="f">Consumo (km/l)</label><input type="number" step="0.1" name="km_per_liter" value="${v.km_per_liter ?? 10}"></div><div><label class="f">Prezzo gasolio predefinito (€/l)</label><input type="number" step="0.001" name="fuel_price" value="${v.fuel_price ?? 1.75}"></div><div style="align-self:end"><button class="btn primary" style="width:100%">Salva</button></div></form>
      <p class="small muted" style="margin:10px 0 0">Il prezzo si può cambiare per ogni viaggio e per ogni singola tappa. Le spese gasolio si ricalcolano finché non le modifichi a mano.</p></div>
    <div class="card"><h2>🗺️ Komoot</h2>${k.connected ? `<p>Collegato (utente ${esc(k.external_user_id)})${k.last_sync_at ? ' · ultima sincronizzazione ' + fdt(k.last_sync_at) : ''}. I tour registrati vengono scaricati ogni 6 ore e quando premi «Sincronizza».</p><div class="row"><button class="btn" id="ksync">Sincronizza ora</button><button class="btn" id="kfull">Importa tutto lo storico</button><button class="btn ghost danger" id="kdel">Scollega</button></div>`
      : `<p class="small muted">Komoot non ha un'API pubblica: la dashboard usa lo stesso accesso del sito. La password serve solo una volta per ottenere un token, che viene salvato cifrato; la password non viene mai memorizzata.</p><form id="kf" class="stack"><input name="email" type="email" placeholder="Email Komoot" required autocomplete="off"><input name="password" type="password" placeholder="Password Komoot" required autocomplete="off"><button class="btn primary">Collega Komoot</button></form>`}</div>

    <div class="card" style="margin-top:14px"><h2>🟠 Strava</h2>${!st.configurato
      ? `<p class="small muted">Per collegare Strava servono le credenziali dell\u2019applicazione. Crea un\u2019applicazione su <span class="code">strava.com/settings/api</span>, indica come dominio di richiamo <span class="code">${location.host}</span>, poi imposta su Railway le variabili <span class="code">STRAVA_CLIENT_ID</span> e <span class="code">STRAVA_CLIENT_SECRET</span>. Al riavvio il pulsante di collegamento comparir\u00e0 qui.</p>`
      : st.connected
        ? `<p>Collegato (atleta ${esc(st.external_user_id)})${st.last_sync_at ? ' · ultima sincronizzazione ' + fdt(st.last_sync_at) : ''}. Le attivit\u00e0 vengono scaricate ogni 6 ore e quando premi «Sincronizza».</p>
           <div class="row"><button class="btn" id="ssync">Sincronizza ora</button><button class="btn" id="sfull">Importa tutto lo storico</button><button class="btn ghost danger" id="sdel">Scollega</button></div>`
        : `<p class="small muted">Verrai portato su Strava per autorizzare la dashboard in sola lettura. Non viene memorizzata alcuna password: solo i token, cifrati, rinnovati da soli.</p>
           <a class="btn primary" href="/api/strava/connect">Collega Strava</a>`}</div>
    </div>
    <div class="card" style="margin-top:14px"><div class="row between"><h2>📱 iPhone e Apple Watch</h2><button class="btn primary sm" id="adddev">＋ Aggiungi dispositivo</button></div>
      <p class="small muted">Ogni iPhone riceve un token personale con cui invia allenamenti (battito, calorie, distanza) a questa dashboard. I dati restano solo qui, sul tuo server. ${user.role === 'admin' ? 'I dispositivi degli altri utenti vanno approvati da te.' : 'Il dispositivo deve essere approvato dall\'amministratore.'}</p>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Utente</th><th>Token</th><th>Stato</th><th>Ultimo invio</th><th></th></tr></thead><tbody>${devices.map(d => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.owner)}</td><td class="small muted">${esc(d.token_hint)}</td><td>${d.approved ? '<span class="badge ok">autorizzato</span>' : '<span class="badge warn">in attesa</span>'}</td><td class="small">${d.last_seen_at ? fdt(d.last_seen_at) : '—'}</td>
        <td class="num">${user.role === 'admin' && !d.approved ? `<button class="btn sm" data-appr="${d.id}">Autorizza</button>` : ''}<button class="btn sm ghost danger" data-deldev="${d.id}">Revoca</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessun dispositivo</td></tr>'}</tbody></table></div>
      <details style="margin-top:12px"><summary>Come configurare l'iPhone</summary><div class="stack small" style="margin-top:8px">
        <div><b>Opzione A – Health Auto Export</b> (app App Store, la più completa): crea un'automazione «REST API», metodo POST, URL <span class="code">${endpoint}</span>, header <span class="code">Authorization: Bearer &lt;token&gt;</span>, tipo di dati «Workouts», formato JSON, e imposta la frequenza (es. ogni ora). Includi «Route» se vuoi anche il GPS.</div>
        <div><b>Opzione B – Comandi Rapidi</b> (gratis): un comando «Trova allenamenti» (ultimi 7 giorni) → per ogni allenamento «Ottieni contenuti di URL» POST a <span class="code">${endpoint}</span> con header Authorization e corpo JSON: <span class="code">{"start": "…", "type": "…", "duration_min": …, "distance_km": …, "calories": …, "hr_avg": …}</span>. Aggiungilo a un'automazione «Fine allenamento».</div>
        <div>Gli allenamenti senza GPS che iniziano entro 15 minuti da un tour Komoot vengono uniti a quel tour: così il percorso Komoot acquista battito e calorie.</div></div></details></div>
    ${adm ? `<div class="card" style="margin-top:14px"><div class="row between"><h2>👥 Utenti</h2><button class="btn primary sm" id="inv">＋ Codice invito</button></div>
      <p class="small muted">Chi si registra con un codice invito entra in attesa finché non lo autorizzi. Ogni utente vede i viaggi condivisi e i propri allenamenti.</p>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Stato</th><th></th></tr></thead><tbody>${adm.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td class="small">${esc(u.email)}</td><td>${u.role}</td><td>${u.approved ? '<span class="badge ok">autorizzato</span>' : '<span class="badge warn">in attesa</span>'}</td><td class="num">${u.id !== user.id ? `<button class="btn sm" data-uappr="${u.id}" data-v="${!u.approved}">${u.approved ? 'Sospendi' : 'Autorizza'}</button><button class="btn sm ghost danger" data-udel="${u.id}">Elimina</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${adm.invites.filter(i => !i.used_by && new Date(i.expires_at) > Date.now()).length ? `<div class="small" style="margin-top:10px">Inviti attivi: ${adm.invites.filter(i => !i.used_by && new Date(i.expires_at) > Date.now()).map(i => `<span class="code">${i.code}</span>`).join(' ')}</div>` : ''}</div>` : ''}
    <div class="card small muted" style="margin-top:14px">Dati mappa © OpenStreetMap · percorsi OSRM · aree sosta e borghi da OpenStreetMap (Overpass). <a href="#" data-logout>Esci</a></div>`);
  $('#veh').onsubmit = safe(async e => { e.preventDefault(); settings.vehicle = await api('/settings/vehicle', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Salvato'); });
  $('#ssync')?.addEventListener('click', safe(async () => { toast('Sincronizzazione\u2026'); const r = await api('/strava/sync', { method: 'POST', body: {} }); toast(`Importate ${r.imported} attivit\u00e0`); render(); }));
  $('#sfull')?.addEventListener('click', safe(async () => { toast('Importazione storico\u2026 pu\u00f2 richiedere un minuto'); const r = await api('/strava/sync', { method: 'POST', body: { full: true } }); toast(`Importate ${r.imported} attivit\u00e0`); render(); }));
  $('#sdel')?.addEventListener('click', safe(async () => { if (await confirmDlg('Scollegare Strava? Gli allenamenti gi\u00e0 importati restano.')) { await api('/strava', { method: 'DELETE' }); toast('Strava scollegato'); render(); } }));
  $('#kf')?.addEventListener('submit', safe(async e => { e.preventDefault(); toast('Collegamento…'); const r = await api('/komoot/connect', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Komoot collegato' + (r.displayName ? ' come ' + r.displayName : '')); render(); }));
  $('#ksync')?.addEventListener('click', safe(async () => { toast('Sincronizzazione…'); const r = await api('/komoot/sync', { method: 'POST', body: {} }); toast(`Importati ${r.imported} tour`); render(); }));
  $('#kfull')?.addEventListener('click', safe(async () => { toast('Importazione storico… può richiedere un minuto'); const r = await api('/komoot/sync', { method: 'POST', body: { full: true } }); toast(`Importati ${r.imported} tour`); render(); }));
  $('#kdel')?.addEventListener('click', safe(async () => { if (await confirmDlg('Scollegare Komoot?')) { await api('/komoot', { method: 'DELETE' }); render(); } }));
  $('#adddev').onclick = () => modal(`<h2>Nuovo dispositivo</h2><form id="f" class="stack" style="margin-top:12px"><input name="name" placeholder="Es. iPhone di Andrea" required><button class="btn primary">Genera token</button></form>`, (el, close) => $('#f', el).onsubmit = safe(async e => {
    e.preventDefault(); const r = await api('/auth/devices', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); close();
    modal(`<h2>Token per «${esc(r.name)}»</h2><p class="small">Copialo ora: non sarà più visibile.${r.approved ? '' : ' Deve ancora essere autorizzato dall\'amministratore.'}</p><div class="code">${r.token}</div><p class="small muted" style="margin-top:8px">Endpoint: <span class="code">${esc(r.endpoint)}</span></p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="cp">Copia</button><button class="btn primary" data-x>Fatto</button></div>`,
      (el2, close2) => { $('#cp', el2).onclick = () => { navigator.clipboard?.writeText(r.token); toast('Copiato'); }; $('[data-x]', el2).onclick = () => { close2(); render(); }; });
  }));
  document.body.onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.appr) { await api(`/auth/devices/${b.dataset.appr}/approve`, { method: 'POST', body: {} }); render(); }
    if (b.dataset.deldev && await confirmDlg('Revocare il dispositivo?')) { await api('/auth/devices/' + b.dataset.deldev, { method: 'DELETE' }); render(); }
    if (b.dataset.uappr) { await api(`/auth/users/${b.dataset.uappr}/approve`, { method: 'POST', body: { approved: b.dataset.v === 'true' } }); render(); }
    if (b.dataset.udel && await confirmDlg('Eliminare l\'utente e i suoi dati?')) { await api('/auth/users/' + b.dataset.udel, { method: 'DELETE' }); render(); }
    if (b.id === 'inv') { const r = await api('/auth/invites', { method: 'POST', body: {} }); modal(`<h2>Codice invito</h2><p class="small">Valido 7 giorni, monouso. Chi lo usa dovrà poi essere autorizzato.</p><div class="code" style="font-size:24px;text-align:center">${r.code}</div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-x>Ok</button></div>`, (el, close) => $('[data-x]', el).onclick = () => { close(); render(); }); }
  });
}

// ---------- Router ----------
async function render() {
  document.body.onclick = null;
  try {
    if (!user) { const me = await api('/auth/me'); if (me.user?.approved) { user = me.user; [settings, atleti] = await Promise.all([api('/settings'), api('/athletes')]); } else return viewAuth(me.setup); }
    const h = location.hash || '#/';
    const m = h.match(/^#\/(trip|allenamenti|allenamento)\/?(\d+)?/);
    if (m?.[1] === 'trip' && m[2]) await viewTrip(m[2]);
    else if (m?.[1] === 'allenamento' && m[2]) await viewWorkout(m[2]);
    else if (m?.[1] === 'allenamenti') await viewWorkouts(m[2] ? +m[2] : user.id);
    else if (h.startsWith('#/cruscotto')) await viewDashboard();
    else if (h.startsWith('#/riepiloghi')) await viewSummary();
    else if (h.startsWith('#/impostazioni')) await viewSettings();
    else await viewTrips();
    window.scrollTo(0, 0);
  } catch (e) { $('#app').innerHTML = `<div class="loading">⚠️ ${esc(e.message)}<br><button class="btn" onclick="location.reload()">Ricarica</button></div>`; }
}
document.addEventListener('click', e => { const a = e.target.closest('[data-logout]'); if (a) { e.preventDefault(); api('/auth/logout', { method: 'POST' }).then(() => { user = null; location.hash = '#/'; render(); }); } });
window.addEventListener('hashchange', render);
render();
})();
