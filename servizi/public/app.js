// Camper Servizi, la pagina.
//
// Una regola sopra tutte: **un valore che non c'e' si scrive «—»**. Mai zero.
// Su una carica, zero vuol dire scarica, e un cruscotto che mente su quello
// non serve a niente. Per la stessa ragione ogni conto porta la sua bandierina:
// misurato, stima, incompleto.

const $ = (s, d = document) => d.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => (v == null || !Number.isFinite(+v) ? '—' : (+v).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }));
const forse = (v, suffisso = '', d = 0) => (v == null ? '<span class="vuoto">—</span>' : `${num(v, d)}${suffisso}`);
const ora = s => (s ? new Date(s).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '');

let io = null;
let dati = null;

async function api(percorso, opz = {}) {
  const r = await fetch('/api' + percorso, {
    method: opz.method || 'GET',
    headers: opz.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opz.body ? JSON.stringify(opz.body) : undefined,
  });
  const t = await r.text();
  let d = null;
  try { d = JSON.parse(t); } catch { /* risposta non JSON */ }
  if (!r.ok) { const e = new Error(d?.error || `Errore ${r.status}`); e.stato = r.status; e.dato = d; throw e; }
  return d;
}

function brindello(testo) {
  const b = document.createElement('div');
  b.className = 'brindello';
  b.textContent = testo;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 3200);
}

const sicuro = f => async (...a) => { try { await f(...a); } catch (e) { brindello(e.message || 'Qualcosa non ha funzionato'); } };

// ---------- pezzi ----------

// I nomi veri delle voci dell'impianto. In archivio hanno chiavi tecniche
// perche' le usa il codice; qui si leggono come le direbbe una persona.
const ETICHETTE = {
  bluetti_wh: 'Capacità della Bluetti',
  bluetti_carica_ac_w: 'Carica dalla 220',
  charger_w: 'Potenza del Charger 2',
  ective_ah: 'Capacità delle Ective',
  ective_v: 'Tensione del pacco',
  ective_carica_a: 'Caricabatterie delle Ective',
  rendimento_bluetti_ective: 'Rendimento Bluetti → Ective',
  consumo_fermo_w: 'Consumo a camper fermo',
  starlink_w: 'Consumo di Starlink',
  scatoletta_w: 'Consumo della scatoletta',
};
const etichetta = c => ETICHETTE[c] || c;

const BOLLI = { misurato: 'misurato', stima: 'stima', incompleto: 'incompleto' };
const bollo = base => `<span class="bollo ${base}">${BOLLI[base] || base}</span>`;

// La ciambella della carica. Non e' decorazione: una percentuale si capisce
// prima con un arco che con un numero, e di sera si guarda di sfuggita.
function ciambella(pct) {
  const r = 50, c = 2 * Math.PI * r;
  const q = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const colore = pct == null ? 'var(--fioco)' : q <= 20 ? 'var(--rosso)' : q <= 45 ? 'var(--ambra)' : 'var(--verde)';
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--bordo)" stroke-width="11"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${colore}" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c - c * q / 100}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" font-size="28" font-weight="650" fill="var(--testo)">${pct == null ? '—' : Math.round(pct)}</text>
    <text x="60" y="78" text-anchor="middle" font-size="12" fill="var(--fioco)">${pct == null ? '' : 'per cento'}</text>
  </svg>`;
}

function rigaConto(nome, c) {
  if (!c) return '';
  // Una frase lunga non sta nella colonna del numero: la si mette sotto, dove
  // c'e' spazio per leggerla. Nella colonna resta la cifra, che e' quella che
  // si cerca con l'occhio.
  const breve = c.detto && c.detto.length <= 24 ? c.detto : null;
  const lunga = c.detto && !breve ? c.detto : null;
  const valore = breve
    || (c.valore == null ? '<span class="vuoto">—</span>'
      : `${num(c.valore, Math.abs(c.valore) < 10 ? 2 : 0)}${c.unita && c.unita.length <= 3 ? ' ' + esc(c.unita) : ''}`);
  return `<div class="riga">
    <div class="cresci">
      <div>${esc(nome)} ${bollo(c.base)}</div>
      ${lunga ? `<div style="margin-top:4px;font-weight:600">${esc(lunga)}</div>` : ''}
      <div class="perche">${esc(c.perche || '')}${c.mancano?.length ? ` · manca: <b>${c.mancano.map(x => esc(etichetta(x))).join(', ')}</b>` : ''}</div>
    </div>
    <div class="valore">${valore}</div>
  </div>`;
}

// ---------- le stanze ----------

const STANZE = [
  ['#/adesso', '🔆', 'Adesso'],
  ['#/energia', '🧮', 'Energia'],
  ['#/storia', '📈', 'Storia'],
  ['#/comandi', '🎛️', 'Comandi'],
  ['#/impianto', '🔧', 'Impianto'],
];

function guscio(dentro) {
  const h = location.hash || '#/adesso';
  const voci = STANZE.map(([v, i, n]) =>
    `<a href="${v}" class="${h.startsWith(v) ? 'qui' : ''}"><b>${i}</b>${n}</a>`).join('');
  return `<div class="guscio">
    <nav class="barra">${voci}</nav>
    <div>
      <header class="testata">
        <img src="icona.svg" alt="">
        <h1>Camper Servizi</h1>
        <div class="quando">${dati?.letto_il ? 'letto alle ' + ora(dati.letto_il) : ''}<br>
          <button class="btn piccolo" id="rileggi" style="margin-top:4px">↻ rileggi</button></div>
      </header>
      <main id="vista">${dentro}</main>
    </div>
  </div>`;
}

function vistaAdesso() {
  const b = (dati.bluetti?.apparecchi || [])[0];
  const err = dati.bluetti?.errore;
  const c = dati.conti || {};

  const dentro = b ? (b.fotovoltaico_w || 0) + (b.rete_w || 0) : null;
  const fuori = b ? (b.uscita_ac_w || 0) + (b.uscita_dc_w || 0) : null;

  const capo = !dati.bluetti?.collegato
    ? `<div class="scheda"><div class="nota">La Bluetti non è ancora collegata. Serve una volta sola: si apre la pagina di Bluetti, si entra col tuo account e si preme <b>Agree</b>.</div>
        <a class="btn primario largo" style="display:block;text-align:center;text-decoration:none;margin-top:12px" href="${esc(dati.collegamento?.indirizzo || '#')}">Collega la Bluetti</a></div>`
    : err
      ? `<div class="scheda"><div class="avviso">Bluetti: ${esc(err)}</div></div>`
      : !b
        ? `<div class="scheda"><div class="nota">Nessun apparecchio sul conto Bluetti.</div></div>`
        : `<div class="scheda">
            <div class="ciambella">
              ${ciambella(b.carica)}
              <div class="dentro">
                <div class="eti">${esc(b.nome)}${b.in_linea === false ? ' · <b>spenta</b>' : ''}</div>
                <div class="cifra" style="margin-top:2px">${b.autonomia_minuti ? esc(dilloInOre(b.autonomia_minuti / 60)) : '<span class="vuoto">—</span>'}</div>
                <div class="sotto">di autonomia, secondo lei</div>
                <div class="sotto" style="margin-top:8px">${esc(b.modalita || '—')}</div>
              </div>
            </div>
            ${b.errore ? `<div class="avviso" style="margin-top:14px">${esc(b.errore)}</div>` : ''}
          </div>
          <div class="griglia">
            <div class="scheda"><div class="eti">Entra</div><div class="cifra">${forse(dentro, ' W')}</div>
              <div class="sotto">☀️ ${forse(b.fotovoltaico_w, ' W')} · 🔌 ${forse(b.rete_w, ' W')}</div></div>
            <div class="scheda"><div class="eti">Esce</div><div class="cifra">${forse(fuori, ' W')}</div>
              <div class="sotto">220 V ${forse(b.uscita_ac_w, ' W')} · 12 V ${forse(b.uscita_dc_w, ' W')}</div></div>
            <div class="scheda"><div class="eti">Carica residua</div>
              <div class="cifra">${c.carica_residua?.detto ? esc(c.carica_residua.detto) : '<span class="vuoto">—</span>'}</div>
              <div class="sotto">${bollo(c.carica_residua?.base || 'incompleto')}</div></div>
          </div>`;

  const attesi = (dati.attesi || []).map(a => `<div class="scheda atteso">
      <div class="riga" style="border:0;padding:0">
        <div class="cresci"><div class="cifra">${a.icona} ${esc(a.nome)}</div>
          <div class="perche">${esc(a.perche)}</div>
          <div class="perche">Dirà: ${esc(a.cosa)}</div></div>
      </div></div>`).join('');

  return `${capo}
    <div class="titolo">Non ancora collegati</div>
    <div class="nota" style="margin-bottom:12px">Questi apparecchi esistono e sono già stati letti una volta, il 16 novembre, col computer dentro al camper. Parlano solo da vicino: arriveranno qui quando la scatoletta sarà a bordo. Finché non ci sono, <b>non mostro numeri</b>: sarebbero vecchi di settimane.</div>
    ${attesi}`;
}

function dilloInOre(ore) {
  if (ore == null) return '—';
  if (ore < 1) return `${Math.round(ore * 60)} min`;
  if (ore < 10) { const h = Math.floor(ore), m = Math.round((ore - h) * 60); return m ? `${h} h ${m} min` : `${h} h`; }
  if (ore < 48) return `${Math.round(ore)} ore`;
  return `${Math.round(ore / 24)} giorni`;
}

function vistaEnergia() {
  const c = dati.conti || {};
  return `<div class="nota">Ogni riga dice <b>su cosa si basa</b>. <span class="bollo misurato">misurato</span> vuol dire che i numeri vengono dal tuo impianto; <span class="bollo stima">stima</span> che almeno uno viene da un catalogo. Quando un dato manca, il conto non si fa: si dice quale manca.</div>
    <div class="titolo">Quanta corrente c'è</div>
    <div class="scheda">
      ${rigaConto('Carica residua', c.carica_residua)}
      ${rigaConto('Manca alla piena', c.manca_alla_piena)}
      ${rigaConto('Saldo adesso', c.saldo_adesso)}
    </div>
    <div class="titolo">Quanto ci vuole a ricaricarla</div>
    <div class="scheda">
      ${rigaConto('Ore di motore col Charger', c.ore_motore)}
      ${rigaConto('Tempo da colonnina', c.ore_colonnina)}
    </div>
    <div class="titolo">Bluetti e batterie di servizio</div>
    <div class="scheda">
      ${rigaConto('Il cambio', c.cambio_ective)}
      ${rigaConto('Riempirle da vuote', c.ective_piene_da_vuote)}
    </div>
    <div class="titolo">Quanto dura fermo</div>
    <div class="scheda">
      ${rigaConto('Il camper sulla Bluetti', c.giorni_fermo_bluetti)}
      ${rigaConto('Quanto costa la scatoletta', c.costo_scatoletta)}
    </div>`;
}

async function vistaStoria() {
  const g = +(localStorage.getItem('giorni') || 7);
  const s = await api(`/storia?giorni=${g}&grandezza=carica`);
  const p = s.punti || [];
  let grafico = '<div class="vuoto" style="padding:30px 0;text-align:center">Nessuna misura ancora. Le letture si accumulano da sole, una ogni quarto d\'ora.</div>';
  if (p.length > 1) {
    const t0 = new Date(p[0].quando).getTime(), t1 = new Date(p[p.length - 1].quando).getTime();
    const W = 600, H = 160, span = Math.max(1, t1 - t0);
    const px = v => 10 + (new Date(v).getTime() - t0) / span * (W - 20);
    const py = v => H - 14 - (Math.max(0, Math.min(100, v)) / 100) * (H - 30);
    const d = p.map((x, i) => `${i ? 'L' : 'M'}${px(x.quando).toFixed(1)},${py(x.valore).toFixed(1)}`).join('');
    grafico = `<svg class="grafico" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="sfuma" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--ambra)" stop-opacity=".35"/><stop offset="1" stop-color="var(--ambra)" stop-opacity="0"/>
      </linearGradient></defs>
      <line class="asse" x1="10" y1="${py(100)}" x2="${W - 10}" y2="${py(100)}"/>
      <line class="asse" x1="10" y1="${py(50)}" x2="${W - 10}" y2="${py(50)}"/>
      <line class="asse" x1="10" y1="${py(0)}" x2="${W - 10}" y2="${py(0)}"/>
      <path class="area" d="${d}L${px(p[p.length - 1].quando).toFixed(1)},${py(0)}L${px(p[0].quando).toFixed(1)},${py(0)}Z"/>
      <path class="linea" d="${d}"/>
    </svg>
    <div class="sotto">dal ${new Date(t0).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} a ${new Date(t1).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${p.length} letture</div>`;
  }
  const ev = await api('/eventi');
  return `<div class="titolo">Carica della Bluetti</div>
    <div class="scheda">
      <div class="riga" style="padding-top:0">
        <div class="cresci"><div class="eti">Ultimi giorni</div></div>
        <select id="giorni" style="width:auto">
          ${[1, 3, 7, 30, 90].map(x => `<option value="${x}" ${x === g ? 'selected' : ''}>${x} giorn${x === 1 ? 'o' : 'i'}</option>`).join('')}
        </select>
      </div>
      ${grafico}
    </div>
    <div class="titolo">Registro</div>
    <div class="scheda">${(ev.eventi || []).length
      ? ev.eventi.slice(0, 30).map(e => `<div class="riga">
          <div class="cresci"><div>${esc(e.testo)}</div>
            <div class="perche">${new Date(e.quando).toLocaleString('it-IT')}${e.chi ? ' · ' + esc(e.chi) : ''}</div></div>
        </div>`).join('')
      : '<div class="vuoto">Ancora niente da raccontare.</div>'}</div>`;
}

async function vistaImpianto() {
  const d = await api('/impianto');
  const righe = (d.righe || []).map(r => `<div class="riga">
      <div class="cresci">
        <div>${esc(etichetta(r.chiave))} ${bollo(r.misurato ? 'misurato' : r.valore == null ? 'incompleto' : 'stima')}</div>
        <div class="perche">${esc(r.nota || '')}</div>
      </div>
      <div style="width:132px;flex:none">
        <input type="number" step="any" data-chiave="${esc(r.chiave)}" value="${r.valore ?? ''}" placeholder="—">
        <div class="perche" style="text-align:right">${esc(r.unita || '')}</div>
      </div>
    </div>`).join('');
  return `<div class="nota">Questi sono i dati fissi del <b>tuo</b> camper: non stanno nel codice perché cambiano quando cambi un pezzo. Un valore che scrivi qui diventa <span class="bollo misurato">misurato</span>, e i conti che lo usano smettono di chiamarsi stime.</div>
    <div class="scheda">${righe}</div>
    <button class="btn primario largo" id="salva">Salva</button>
    <div class="titolo">Collegamenti</div>
    <div class="scheda">
      <div class="riga" style="padding-top:0">
        <div class="cresci"><div>Cloud Bluetti ${bollo(dati.collegamento?.collegato ? 'misurato' : 'incompleto')}</div>
          <div class="perche">${dati.collegamento?.collegato
            ? 'Collegato. Il permesso dura un mese e si rinnova da sé; se un giorno scade, ricollega da qui.'
            : 'Non collegato. Si apre la pagina di Bluetti, si entra col tuo account e si preme Agree.'}</div>
          <div class="perche">La pagina dirà <b>HomeAssistant</b> e parlerà di controllo a voce: è la porta pubblica che Bluetti tiene aperta per quell’integrazione, l’unica che esiste. Il permesso comprende anche il comando, non solo la lettura.</div>
        </div>
      </div>
      <a class="btn largo" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="${esc(dati.collegamento?.indirizzo || '#')}">${dati.collegamento?.collegato ? 'Ricollega' : 'Collega la Bluetti'}</a>
    </div>`;
}

function vistaComandi() {
  const b = (dati.bluetti?.apparecchi || [])[0];
  const com = dati.comandi || {};
  if (!b) return `<div class="scheda"><div class="nota">Nessun apparecchio da comandare.</div></div>`;
  const righe = Object.entries(com).map(([k, def]) => `<div class="riga">
      <div class="cresci"><div>${esc(def.nome)}</div><div class="perche">${esc(def.avviso)}</div></div>
      <label class="levetta"><input type="checkbox" data-comando="${esc(k)}" ${b[k] ? 'checked' : ''} ${b[k] == null ? 'disabled' : ''}><i></i></label>
    </div>`).join('');
  return `<div class="nota">I comandi arrivano alla Bluetti vera, in camper. Ogni interruttore chiede conferma prima di partire: <b>un tocco per sbaglio in tasca non deve spegnere la 220 col frigo acceso</b>.</div>
    <div class="scheda">${righe}</div>
    <div class="titolo">Modalità di lavoro</div>
    <div class="scheda"><div class="riga" style="padding:0">
      <div class="cresci"><div>${esc(b.modalita || '—')}</div><div class="perche">Si cambia dall'app Bluetti: da qui non la tocco, perché cambia il comportamento dell'apparecchio in modi che non posso verificare da remoto.</div></div>
    </div></div>`;
}

// ---------- conferma ----------

function conferma(titolo, testo, etichetta = 'Procedi') {
  return new Promise(risolvi => {
    const v = document.createElement('div');
    v.className = 'velo';
    v.innerHTML = `<div class="finestra">
      <h3 style="margin:0 0 8px">${esc(titolo)}</h3>
      <p style="color:var(--fioco);font-size:14px;margin:0 0 18px">${esc(testo)}</p>
      <div style="display:flex;gap:10px">
        <button class="btn" style="flex:1" data-no>Annulla</button>
        <button class="btn primario" style="flex:1" data-si>${esc(etichetta)}</button>
      </div></div>`;
    v.querySelector('[data-no]').onclick = () => { v.remove(); risolvi(false); };
    v.querySelector('[data-si]').onclick = () => { v.remove(); risolvi(true); };
    v.onclick = e => { if (e.target === v) { v.remove(); risolvi(false); } };
    document.body.appendChild(v);
  });
}

// ---------- accesso ----------

function vistaAccesso(primoAvvio) {
  $('#app').className = '';
  $('#app').innerHTML = `<main style="max-width:420px;margin:0 auto;padding-top:48px">
    <div style="text-align:center;margin-bottom:22px">
      <img src="icona.svg" alt="" style="width:76px;height:76px;border-radius:19px">
      <h1 style="font-size:23px;margin:12px 0 4px">Camper Servizi</h1>
      <div class="eti">${primoAvvio ? 'Primo avvio: crea il tuo accesso' : 'Gli impianti del camper, da remoto'}</div>
    </div>
    <div class="scheda">
      <form id="f">
        ${primoAvvio ? '<label class="campo"><span>Nome</span><input name="nome" required autocomplete="name"></label>' : ''}
        <label class="campo"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
        <label class="campo"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="${primoAvvio ? 'new-password' : 'current-password'}"></label>
        <button class="btn primario largo">${primoAvvio ? 'Crea l\'accesso' : 'Entra'}</button>
      </form>
    </div></main>`;
  $('#f').onsubmit = sicuro(async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const r = await api(primoAvvio ? '/registra' : '/entra', { method: 'POST', body: d });
    io = r.utente;
    await disegna();
  });
}

// ---------- il giro ----------

async function disegna() {
  const h = location.hash || '#/adesso';
  if (!location.hash) location.hash = '#/adesso';
  dati = await api('/stato');
  $('#app').className = '';
  let dentro = '<div class="caricamento">…</div>';
  if (h.startsWith('#/energia')) dentro = vistaEnergia();
  else if (h.startsWith('#/comandi')) dentro = vistaComandi();
  else if (h.startsWith('#/storia')) dentro = await vistaStoria();
  else if (h.startsWith('#/impianto')) dentro = await vistaImpianto();
  else dentro = vistaAdesso();
  $('#app').innerHTML = guscio(dentro);
  aggancia();
  // Di ritorno dalla pagina di Bluetti: si dice com'è andata e si pulisce
  // l'indirizzo, che quel segnale non deve restare appeso a un ricaricamento.
  const esito = (location.hash.match(/[?&]bluetti=([a-z]+)/) || [])[1];
  if (esito) {
    history.replaceState(null, '', location.hash.replace(/[?&]bluetti=[a-z]+/, ''));
    brindello(esito === 'fatto' ? 'Bluetti collegata'
      : esito === 'annullato' ? 'Collegamento annullato'
      : 'Il collegamento non è riuscito: riprova');
  }
}

function aggancia() {
  const r = $('#rileggi');
  if (r) r.onclick = sicuro(async () => { r.textContent = '…'; await api('/stato?fresco=1'); await disegna(); brindello('Riletto'); });

  const g = $('#giorni');
  if (g) g.onchange = sicuro(async () => { localStorage.setItem('giorni', g.value); await disegna(); });

  const s = $('#salva');
  if (s) s.onclick = sicuro(async () => {
    const campi = [...document.querySelectorAll('[data-chiave]')];
    for (const c of campi) await api('/impianto/' + encodeURIComponent(c.dataset.chiave), { method: 'PUT', body: { valore: c.value } });
    brindello('Impianto aggiornato');
    await disegna();
  });

  for (const l of document.querySelectorAll('[data-comando]')) {
    l.onchange = sicuro(async () => {
      const quale = l.dataset.comando;
      const acceso = l.checked;
      const def = (dati.comandi || {})[quale] || {};
      l.checked = !acceso;                                  // si muove solo dopo il sì
      const ok = await conferma(`${def.nome}: ${acceso ? 'accendere' : 'spegnere'}?`, def.avviso || '', acceso ? 'Accendi' : 'Spegni');
      if (!ok) return;
      await api('/comandi/' + encodeURIComponent(quale), { method: 'POST', body: { conferma: true, acceso } });
      brindello(`${def.nome}: ${acceso ? 'acceso' : 'spento'}`);
      await disegna();
    });
  }
}

async function avvia() {
  try {
    const r = await api('/io');
    io = r.utente;
    if (!io) return vistaAccesso(r.primoAvvio);
    await disegna();
  } catch (e) {
    $('#app').className = '';
    $('#app').innerHTML = `<main style="padding-top:60px;text-align:center">
      <div class="avviso" style="display:inline-block;text-align:left">${esc(e.message)}</div>
      <div style="margin-top:16px"><button class="btn" onclick="location.reload()">Riprova</button></div></main>`;
  }
}

window.addEventListener('hashchange', () => { if (io) disegna().catch(e => brindello(e.message)); });
avvia();
