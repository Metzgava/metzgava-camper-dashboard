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
  truma_el1_w: 'Truma elettrica, livello 1',
  truma_el2_w: 'Truma elettrica, livello 2',
  rendimento_inverter_bluetti: 'Rendimento dell’inverter',
  consumo_fermo_w: 'Consumo a camper fermo',
  starlink_w: 'Consumo di Starlink',
  scatoletta_w: 'Consumo della scatoletta',
};
// I carichi misurati in taratura non hanno un'etichetta scritta a mano: la
// chiave la genera la taratura stessa, e qui si rimette in italiano.
const etichetta = c => ETICHETTE[c]
  || (/^carico_.+_a$/.test(c)
    ? c.slice(7, -2).replace(/_/g, ' ').replace(/^./, s => s.toUpperCase()) + ' — consumo'
    : c);

const BOLLI = { misurato: 'misurato', stima: 'stima', incompleto: 'incompleto' };
const bollo = base => `<span class="bollo ${base}">${BOLLI[base] || base}</span>`;

// ---------- il manometro ----------
//
// Un quadrante con la lancetta, come quelli veri. Non mostra solo a che punto
// sta: mostra **dove stava** poco fa (la tacca chiara) e quindi se sta salendo
// o scendendo. Un numero da solo non lo dice, e il senso di un manometro e'
// proprio vedere la lancetta muoversi.
//
// E' scritto per essere riusato: le Ective useranno questo stesso pezzo
// quando la scatoletta sara' a bordo. Quelle che ancora non parlano si
// disegnano smorzate, senza lancetta: non fingono uno zero.
const ANG = p => 180 - 1.8 * Math.max(0, Math.min(100, p));          // gradi
const PT = (cx, cy, r, g) => [cx + r * Math.cos(g * Math.PI / 180), cy - r * Math.sin(g * Math.PI / 180)];

function manometro({ pct, nome, tendenza = null, atteso = false, perche = '', carica = null }) {
  const CX = 118, CY = 112, R = 86;
  const colore = atteso || pct == null ? 'var(--fioco)'
    : pct <= 20 ? 'var(--rosso)' : pct <= 45 ? 'var(--ambra)' : 'var(--verde)';
  const arco = (da, a, raggio) => {
    const [x1, y1] = PT(CX, CY, raggio, ANG(da));
    const [x2, y2] = PT(CX, CY, raggio, ANG(a));
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${raggio},${raggio} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  };
  const tacche = [0, 25, 50, 75, 100].map(v => {
    const [x1, y1] = PT(CX, CY, R + 4, ANG(v));
    const [x2, y2] = PT(CX, CY, R - 9, ANG(v));
    const [tx, ty] = PT(CX, CY, R + 17, ANG(v));
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--bordo)" stroke-width="2"/>
      <text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--fioco)">${v}</text>`;
  }).join('');

  // da dove veniva: la tacca chiara, che e' il «progresso»
  const partenza = tendenza && tendenza.da != null && Math.abs(tendenza.a - tendenza.da) >= 1 ? tendenza.da : null;
  const scia = partenza == null ? '' :
    `<path d="${arco(Math.min(partenza, pct), Math.max(partenza, pct), R - 26)}" stroke="${colore}" stroke-opacity=".32" stroke-width="9" fill="none" stroke-linecap="round"/>`;

  let lancetta = '';
  if (!atteso && pct != null) {
    const [nx, ny] = PT(CX, CY, R - 20, ANG(pct));
    const [bx1, by1] = PT(CX, CY, 9, ANG(pct) + 90);
    const [bx2, by2] = PT(CX, CY, 9, ANG(pct) - 90);
    lancetta = `<path d="M${bx1.toFixed(1)},${by1.toFixed(1)} L${nx.toFixed(1)},${ny.toFixed(1)} L${bx2.toFixed(1)},${by2.toFixed(1)} Z" fill="var(--testo)"/>
      <circle cx="${CX}" cy="${CY}" r="7" fill="var(--testo)"/><circle cx="${CX}" cy="${CY}" r="3" fill="var(--carta)"/>`;
  }

  const riga = atteso
    ? `<div class="perche">${esc(perche)}</div>`
    : !tendenza || tendenza.nota
      ? `<div class="perche">${esc(tendenza?.nota || '')}</div>`
      : tendenza.verso === 'fermo'
        ? `<div class="perche">\u2192 ferma, negli ultimi ${esc(dilloInOre(tendenza.finestra_ore))}</div>`
        : `<div class="sotto" style="font-weight:600;color:${tendenza.verso === 'sale' ? 'var(--verde)' : 'var(--ambra)'}">
             ${tendenza.verso === 'sale' ? '\u2191' : '\u2193'} ${tendenza.ritmo > 0 ? '+' : '\u2212'}${num(Math.abs(tendenza.ritmo), 1)} % all\u2019ora</div>
           <div class="perche">se continua cos\u00ec, ${tendenza.verso === 'sale' ? 'piena' : 'a zero'} fra <b>${esc(dilloInOre(tendenza.ore_alla_meta))}</b> \u00b7 misurato su ${esc(dilloInOre(tendenza.finestra_ore))}</div>`;

  return `<div style="text-align:center">
    <svg viewBox="0 0 236 152" style="width:100%;max-width:240px;height:auto" aria-label="${esc(nome)} ${pct == null ? 'sconosciuta' : Math.round(pct) + ' per cento'}">
      <path d="${arco(0, 100, R)}" stroke="var(--bordo)" stroke-width="13" fill="none" stroke-linecap="round"/>
      ${carica && !atteso ? `<path d="${arco(0, 100, R)}" stroke="var(--carica)" stroke-width="20" fill="none" stroke-linecap="round" class="alone"/>` : ''}
      ${pct != null && !atteso ? `<path d="${arco(0, pct, R)}" stroke="${colore}" stroke-width="13" fill="none" stroke-linecap="round"/>` : ''}
      ${tacche}${scia}${lancetta}
      <text x="${CX}" y="${CY + 34}" text-anchor="middle" font-size="34" font-weight="650" fill="var(--testo)">${pct == null ? '\u2014' : Math.round(pct)}</text>
      <text x="${CX}" y="${CY + 48}" text-anchor="middle" font-size="11" fill="var(--fioco)">${pct == null ? '' : 'per cento'}</text>
    </svg>
    <div style="font-weight:600;margin-top:2px">${esc(nome)}</div>
    ${carica ? '<div class="carica-chip">\u26a1 in carica</div>' : ''}
    ${riga}
  </div>`;
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

  // Anche quando non e' collegata, la Bluetti si disegna come quadrante: cosi'
  // la pagina ha sempre la stessa forma e si capisce a colpo d'occhio che cosa
  // manca. Un apparecchio che compare solo dopo essere stato collegato sembra
  // un apparecchio che non c'e'.
  const capo = !dati.bluetti?.collegato
    ? `<div class="scheda">
        ${manometro({ pct: null, nome: 'Bluetti Elite 300', atteso: true, perche: 'da collegare' })}
        <div class="nota" style="margin-top:10px">Serve una volta sola: si apre la pagina di Bluetti, si preme <b>Agree</b>, e a quel punto chiede l’accesso al tuo account. Si entra, e si torna qui da soli.</div>
        <a class="btn primario largo" style="display:block;text-align:center;text-decoration:none;margin-top:12px" href="${esc(dati.collegamento?.indirizzo || '#')}">Collega la Bluetti</a></div>`
    : err
      ? `<div class="scheda"><div class="avviso">Bluetti: ${esc(err)}</div></div>`
      : !b
        ? `<div class="scheda"><div class="nota">Nessun apparecchio sul conto Bluetti.</div></div>`
        : `<div class="scheda">
            ${manometro({ pct: b.carica, nome: b.nome + (b.in_linea === false ? ' · spenta' : ''), tendenza: b.tendenza,
              carica: (dati.conti?.ingresso?.valore || 0) > 0 })}
            <div class="riga" style="margin-top:14px">
              <div class="cresci"><div class="eti">Col consumo di adesso</div>
                <div class="cifra" style="font-size:22px">${c.tempo_residuo_bluetti?.detto ? esc(c.tempo_residuo_bluetti.detto) : '<span class="vuoto">—</span>'}</div>
                <div class="perche">${esc(c.tempo_residuo_bluetti?.perche || '')}</div></div>
            </div>
            <div class="riga">
              <div class="cresci"><div class="eti">Autonomia, secondo lei</div>
                <div class="cifra" style="font-size:22px">${b.autonomia_minuti ? esc(dilloInOre(b.autonomia_minuti / 60)) : '<span class="vuoto">—</span>'}</div></div>
              <div style="text-align:right"><div class="eti">Modalità</div>
                <div class="sotto" style="font-size:14px;color:var(--testo)">${esc(b.modalita || '—')}</div></div>
            </div>
            ${b.errore ? `<div class="avviso" style="margin-top:14px">${esc(b.errore)}</div>` : ''}
          </div>
          <div class="griglia stretta">
            <div class="scheda"><div class="eti">Entra</div><div class="cifra">${forse(dentro, ' W')}</div>
              <div class="sotto">☀️ ${forse(b.fotovoltaico_w, ' W')}<br>🔌 ${forse(b.rete_w, ' W')}</div></div>
            <div class="scheda"><div class="eti">Esce</div><div class="cifra">${forse(fuori, ' W')}</div>
              <div class="sotto">220 V ${forse(b.uscita_ac_w, ' W')}<br>12 V ${forse(b.uscita_dc_w, ' W')}</div></div>
            <div class="scheda"><div class="eti">Carica residua</div>
              <div class="cifra">${b.carica == null ? '<span class="vuoto">—</span>' : num(b.carica, 0) + ' %'}</div>
              <div class="sotto">${c.carica_residua?.detto ? esc(c.carica_residua.detto) : '<span class="vuoto">—</span>'}<br>${bollo(c.carica_residua?.base || 'incompleto')}</div></div>
          </div>`;

  // Le Ective avranno due manometri come quello della Bluetti. Finche' non
  // parlano si disegnano smorzati e senza lancetta: un quadrante a zero direbbe
  // «scariche», che e' una bugia diversa dal non sapere.
  // Quando la scatoletta sara' a bordo, qui ci saranno le batterie vere: si
  // riconoscono perche' mandano le celle. Finche' non arrivano, due quadranti
  // spenti con i nomi che avranno.
  const vere = (dati.istantanee || []).filter(r => r.dati?.celle_mv || /^NWJ/i.test(r.apparecchio || ''));
  const quadrante = (r, i) => {
    const d = r?.dati || {};
    const residuoAh = d.capacita_ah != null && d.carica != null ? d.capacita_ah * d.carica / 100 : null;
    // Colonna alta uguale e riquadro spinto in fondo: cosi' i due «carica
    // residua» stanno sulla stessa riga anche quando il testo del ritmo e' piu'
    // lungo da una parte. Due riquadri sfalsati sembrano un errore.
    return `<div style="display:flex;flex-direction:column;height:100%">
      ${manometro({ pct: d.carica ?? null, nome: `Ective ${i + 1}`,
        tendenza: r?.tendenza, atteso: !r, perche: 'con la scatoletta',
        // Un filo di corrente positiva e' rumore attorno allo zero, non una
        // carica: sotto i 50 mA non si annuncia niente.
        carica: d.ampere != null && d.ampere > 0.05 })}
      <div class="scheda" style="margin:8px 0 0;padding:10px 9px;margin-top:auto">
        <div class="eti">Carica residua</div>
        <div class="cifra" style="font-size:19px">${d.carica == null ? '<span class="vuoto">—</span>' : num(d.carica, 0) + ' %'}</div>
        <div class="sotto" style="font-size:10.5px">${residuoAh == null ? '<span class="vuoto">—</span>' : num(residuoAh, 0) + ' Ah di ' + num(d.capacita_ah, 0)}${d.volt != null ? `<br>${num(d.volt, 2)} V · ${d.ampere > 0 ? '+' : ''}${num(d.ampere, 2)} A` : ''}</div>
      </div></div>`;
  };
  const ective = `<div class="scheda">
      <div class="griglia" style="grid-template-columns:1fr 1fr">
        ${quadrante(vere[0], 0)}
        ${quadrante(vere[1], 1)}
      </div>
      ${vere.length ? '' : `<div class="riga" style="margin-top:8px">
        <div class="cresci"><div class="eti">Col consumo di adesso</div>
          <div class="perche">${esc(dati.conti?.tempo_residuo_ective?.perche || '')}</div></div>
        <div class="valore"><span class="vuoto">—</span></div>
      </div>
      <div class="perche" style="text-align:center;margin-top:6px">Stesso quadrante della Bluetti, stessa lancetta: appena il Raspberry sarà a bordo si accendono.</div>`}
    </div>`;

  const attesi = (dati.attesi || []).filter(a => a.id !== 'ective').map(a => `<div class="scheda atteso">
      <div class="riga" style="border:0;padding:0">
        <div class="cresci"><div class="cifra">${a.icona} ${esc(a.nome)}</div>
          <div class="perche">${esc(a.perche)}</div>
          <div class="perche">Dirà: ${esc(a.cosa)}</div></div>
      </div></div>`).join('');

  return `<div class="titolo">Stazione di accumulo</div>
    ${capo}
    ${barraCarica()}
    <div class="titolo">Batterie di servizio</div>
    ${ective}
${vistaSegnale()}
        <div class="titolo">Non ancora collegati</div>
    <div class="nota" style="margin-bottom:12px">Questi apparecchi esistono e sono già stati letti una volta, il 16 novembre, col computer dentro al camper. Parlano solo da vicino: arriveranno qui quando la scatoletta sarà a bordo. Finché non ci sono, <b>non mostro numeri</b>: sarebbero vecchi di settimane.</div>
    ${attesi}`;
}

// ---------- la barra della carica ----------
//
// Mostra tre cose in una: a che punto sta la carica, **da dove** sta arrivando
// quella che entra, e quando sara' piena. Il colore del riempimento dice la
// provenienza, cosi' lo si capisce senza leggere.
//
// Quando non entra niente la barra resta, ma grigia e muta: dire «non sta
// caricando» e' un'informazione, far sparire il riquadro no.
const FONTI = {
  rete: { nome: 'dalla 220', colore: 'var(--rete, #5aa9e6)' },
  continua: { nome: 'in continua', colore: 'var(--sole, #e8b64c)' },
};

function barraCarica() {
  const c = dati.conti || {};
  const i = c.ingresso || {};
  const pct = Math.max(0, Math.min(100, Number(c.carica_residua?.valore != null && dati.bluetti?.apparecchi?.[0]?.carica) || dati.bluetti?.apparecchi?.[0]?.carica || 0));
  const rete = Number(i.rete_w) || 0;
  const continua = Number(i.continua_w) || 0;
  const entra = rete + continua;

  // Le due fette dentro la parte piena, in proporzione a chi sta spingendo.
  const fette = entra > 0
    ? [['rete', rete], ['continua', continua]].filter(([, w]) => w > 0)
      .map(([k, w]) => `<span style="flex:${w};background:${FONTI[k].colore}"></span>`).join('')
    : '<span style="flex:1;background:var(--filo,#3a4150)"></span>';

  const legenda = entra > 0
    ? [['rete', rete], ['continua', continua]].filter(([, w]) => w > 0)
      .map(([k, w]) => `<span class="perche" style="margin-right:12px">
          <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${FONTI[k].colore};margin-right:4px"></span>
          ${FONTI[k].nome} <b>${num(w, 0)} W</b></span>`).join('')
    : '<span class="perche">Non sta caricando</span>';

  return `<div class="scheda">
    <div class="eti">Carica e provenienza</div>
    <div style="display:flex;height:16px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.08);margin:8px 0 6px">
      <div style="display:flex;width:${pct}%;min-width:2px">${fette}</div>
    </div>
    <div class="riga" style="border:0;padding:0;align-items:baseline">
      <div class="cresci">${legenda}</div>
      <div class="valore" style="font-size:15px">${pct ? num(pct, 0) + ' %' : '<span class="vuoto">—</span>'}</div>
    </div>
    ${entra > 0 ? `<div class="riga" style="margin-top:8px">
      <div class="cresci"><div class="eti">Piena</div>
        <div class="perche">${esc(c.alla_piena?.perche || '')}</div></div>
      <div class="valore">${esc(c.alla_piena?.detto || '—')} ${bollo(c.alla_piena?.base || 'incompleto')}</div>
    </div>` : ''}
    <div class="nota" style="margin-top:8px">Sulla Bluetti il Charger del motore entra dalla <b>stessa porta</b> dei pannelli:
      «in continua» sono i due insieme e il numero non li distingue. Dirlo e' meglio che indovinare.</div>
  </div>`;
}

// ---------- quanto si sente ----------
//
// Serve a una cosa sola: decidere dove sta il Raspberry. Un apparecchio che si
// sente al limite oggi funziona e domani no, e senza guardarlo lo si scopre il
// giorno in cui serviva. Le soglie sono quelle che si usano per il Bluetooth a
// bassa energia: sotto -85 dBm i pacchetti cominciano a perdersi.
const QUANTO = [[-60, 'ottimo', 4], [-75, 'buono', 3], [-85, 'debole', 2], [-999, 'al limite', 1]];

function antenna(rssi) {
  if (rssi == null) return '';
  const [, parola, tacche] = QUANTO.find(([s]) => rssi >= s);
  const barre = [1, 2, 3, 4].map(n =>
    `<span style="display:inline-block;width:3px;height:${3 + n * 2}px;margin-right:1px;vertical-align:bottom;background:${n <= tacche ? 'currentColor' : 'rgba(255,255,255,.18)'}"></span>`).join('');
  return `<span title="${rssi} dBm">${barre} ${parola}</span>`;
}

function vistaSegnale() {
  const sentiti = (dati.istantanee || []).filter(r => r.dati?.rssi != null)
    .sort((a, b) => b.dati.rssi - a.dati.rssi);
  if (!sentiti.length) return '';
  return `<div class="titolo">Quanto si sente</div>
    <div class="scheda">
      ${sentiti.map(r => `<div class="riga">
        <div class="cresci"><div class="eti">${esc(r.apparecchio)}</div></div>
        <div class="valore" style="font-size:13px">${antenna(r.dati.rssi)}</div>
      </div>`).join('')}
      <div class="nota" style="margin:8px 0 0">Decide dove va montata la scatoletta: se qualcosa sta su <b>debole</b> o <b>al limite</b>, spostarla di mezzo metro cambia tutto. Si misura da sola a ogni giro, quindi si può provare e riguardare.</div>
    </div>`;
}

function dilloInOre(ore) {
  if (ore == null) return '—';
  if (ore < 1) return `${Math.round(ore * 60)} min`;
  if (ore < 10) { const h = Math.floor(ore), m = Math.round((ore - h) * 60); return m ? `${h} h ${m} min` : `${h} h`; }
  if (ore < 48) return `${Math.round(ore)} ore`;
  return `${Math.round(ore / 24)} giorni`;
}


// ---------- il calcolatore ----------
//
// «Se la Bluetti e' al 30 %, quante ore di motore?» e' la domanda vera, e non
// si risponde con un numero fisso: dipende da dove parti, dove vuoi arrivare e
// da cosa la attacchi.
//
// La finezza che conta: una colonnina da 16 A non carica il doppio di una da
// 8 A, se la Bluetti ne accetta al massimo 1800 W. **Il limite e' il piu'
// piccolo dei due**, e questo va detto, non nascosto dentro il risultato.
const RETE_V = 230;
const leggiCalc = () => { try { return JSON.parse(localStorage.getItem('calc') || '{}'); } catch { return {}; } };
const scriviCalc = o => { try { localStorage.setItem('calc', JSON.stringify(o)); } catch { /* finestra privata */ } };

function calcolo() {
  const imp = dati.impianto || {};
  const b = (dati.bluetti?.apparecchi || [])[0];
  const c = leggiCalc();
  const da = c.da != null ? c.da : (b?.carica != null ? Math.round(b.carica) : 30);
  const a = c.a != null ? c.a : 100;
  const ampere = c.ampere != null ? c.ampere : 16;

  const capacita = imp.bluetti_wh?.valore ?? null;
  const mancaWh = capacita == null ? null : Math.max(0, capacita * (a - da) / 100);

  const sorgenti = [
    { id: 'motore', nome: '🔑 Col motore acceso', w: imp.charger_w?.valore ?? null,
      misurato: imp.charger_w?.misurato, manca: 'Potenza del Charger 2',
      nota: 'Il motore deve girare davvero: a quadro acceso e motore spento l\u2019alternatore non da\u2019 niente.' },
    { id: 'casa', nome: '🏠 Da casa, presa 220 V', w: imp.bluetti_carica_ac_w?.valore ?? null,
      misurato: imp.bluetti_carica_ac_w?.misurato, manca: 'Carica dalla 220',
      nota: 'Una presa di casa regge piu\u2019 di quanto la Bluetti chieda: comanda lei.' },
    { id: 'colonnina', nome: '🔌 Da colonnina', colonnina: true,
      w: imp.bluetti_carica_ac_w?.valore == null ? null
        : Math.min(imp.bluetti_carica_ac_w.valore, ampere * RETE_V),
      misurato: imp.bluetti_carica_ac_w?.misurato, manca: 'Carica dalla 220' },
  ];

  const righe = sorgenti.map(s => {
    if (s.w == null) return `<div class="riga">
      <div class="cresci"><div>${s.nome} ${bollo('incompleto')}</div>
        <div class="perche">manca: <b>${esc(s.manca)}</b> \u2014 mettilo in Impianto e il conto compare</div></div>
      <div class="valore"><span class="vuoto">\u2014</span></div></div>`;
    const ore = mancaWh == null ? null : mancaWh / s.w;
    const perOra = capacita == null ? null : s.w / capacita * 100;
    const tetto = s.colonnina && imp.bluetti_carica_ac_w?.valore != null && ampere * RETE_V > imp.bluetti_carica_ac_w.valore;
    return `<div class="riga">
      <div class="cresci">
        <div>${s.nome} ${bollo(s.misurato ? 'misurato' : 'stima')}</div>
        ${s.colonnina ? `<div class="perche">${num(ampere, 0)} A \u00d7 ${RETE_V} V = ${num(ampere * RETE_V, 0)} W${tetto
          ? ` \u2014 ma la Bluetti ne accetta <b>${num(imp.bluetti_carica_ac_w.valore, 0)}</b>: <b>comanda lei</b>`
          : ', e la Bluetti sta sotto il suo tetto'}</div>` : ''}
        <div class="perche">a ${num(s.w, 0)} W \u00b7 ogni ora aggiunge <b>${perOra == null ? '\u2014' : '+' + num(perOra, 1) + ' %'}</b>${s.nota ? ' \u00b7 ' + esc(s.nota) : ''}</div>
      </div>
      <div class="valore">${ore == null ? '<span class="vuoto">\u2014</span>' : esc(dilloInOre(ore))}</div>
    </div>`;
  }).join('');

  return `<div class="scheda">
    <div style="display:flex;gap:12px;align-items:flex-end;padding-bottom:14px;border-bottom:1px solid var(--bordo)">
      <div style="flex:1;min-width:0"><div class="eti">Dalla carica</div>
        <input type="number" id="c-da" min="0" max="100" step="1" value="${da}" style="font-size:22px;font-weight:650;text-align:center"></div>
      <div style="flex:none;padding-bottom:12px;color:var(--fioco);font-size:18px">\u2192</div>
      <div style="flex:1;min-width:0"><div class="eti">fino a</div>
        <input type="number" id="c-a" min="0" max="100" step="1" value="${a}" style="font-size:22px;font-weight:650;text-align:center"></div>
    </div>
    <div class="riga" style="align-items:baseline">
      <div class="cresci"><div class="eti">Da rimettere dentro</div></div>
      <div class="cifra">${mancaWh == null ? '\u2014' : (mancaWh / 1000).toFixed(2).replace('.', ',') + ' kWh'}</div>
    </div>
    ${righe}
    <div class="riga">
      <div class="cresci"><div class="eti">Quanti ampere d\u00e0 la colonnina</div>
        <div class="perche">Le colonnine dichiarano gli ampere: 6, 8, 16. I watt sono quelli per ${RETE_V} V.</div></div>
      <div style="flex:none"><input type="number" id="c-a-amp" min="1" max="32" step="1" value="${ampere}" style="width:92px"></div>
    </div>
  </div>`;
}

function vistaEnergia() {
  const c = dati.conti || {};
  return `<div class="titolo">Quanto ci vuole a caricarla</div>
    ${calcolo()}
    <div class="nota">Ogni riga dice <b>su cosa si basa</b>. <span class="bollo misurato">misurato</span> vuol dire che i numeri vengono dal tuo impianto; <span class="bollo stima">stima</span> che almeno uno viene da un catalogo. Quando un dato manca, il conto non si fa: si dice quale manca.</div>
    <div class="titolo">Quanta corrente c'è</div>
    <div class="scheda">
      ${rigaConto('Carica residua', c.carica_residua)}
      ${rigaConto('Manca alla piena', c.manca_alla_piena)}
      ${rigaConto('Saldo adesso', c.saldo_adesso)}
    </div>
    <div class="titolo">Bluetti e batterie di servizio</div>
    <div class="scheda">
      ${rigaConto('Il cambio', c.cambio_ective)}
      ${rigaConto('Riempirle da vuote', c.ective_piene_da_vuote)}
    </div>
    <div class="titolo">Quanto manca allo scarico</div>
    <div class="scheda">
      ${rigaConto('Bluetti, col consumo di adesso', c.tempo_residuo_bluetti)}
      ${rigaConto('Ective, col consumo di adesso', c.tempo_residuo_ective)}
    </div>
    <div class="titolo">Quanta Truma elettrica ci sta</div>
    <div class="scheda">
      ${rigaConto('A 900 W — EL 1 e MIX 1', c.ore_truma_el1)}
      ${rigaConto('A 1800 W — EL 2 e MIX 2', c.ore_truma_el2)}
      <div class="nota">Tempo di <b>resistenza accesa</b>, non di stufa accesa: la Combi stacca quando arriva a temperatura, e l'orologio dura di più. La ventola sta sui 12 V delle Ective e qui non è contata. E vale solo se i 230 V li fa la Bluetti: attaccato alla colonnina, la stufa elettrica alla Bluetti non costa niente.</div>
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

// ---------- la taratura ----------
//
// La serata in cui si accende un carico per volta e si guarda lo scalino nella
// corrente. Sta dentro «Impianto» perche' e' esattamente questo: il modo di
// **misurare** l'impianto invece di stimarlo.
//
// Due cose che l'interfaccia deve dire, altrimenti sembra rotta:
//   - la scatoletta si accorge della sessione al giro dopo, quindi fino a
//     cinque minuti;
//   - lo scalino non compare subito: servono tre minuti di letture dopo
//     l'accensione prima che il numero sia credibile.
const CARICHI = ['Luci cucina', 'Luci dinette', 'Pompa acqua', 'Frigo', 'Truma', 'Prese 12 V'];

async function bloccoTaratura() {
  let d;
  try { d = await api('/taratura'); } catch { return ''; }
  const s = d.sessione || {};

  const segni = (d.segni || []).map(g => {
    const m = g.misura || {};
    return `<div class="riga">
      <div class="cresci">
        <div>${esc(g.nome)} ${bollo(m.base || 'incompleto')}</div>
        <div class="perche">${ora(g.quando)} · ${esc(m.perche || '')}</div>
      </div>
      <div style="flex:none;text-align:right">
        <div class="valore">${m.ampere == null ? '<span class="vuoto">—</span>' : num(m.ampere, 2) + ' A'}</div>
        ${m.base === 'misurato'
          ? `<button class="btn piccolo" data-accetta="${g.id}" style="margin-top:4px">accetta</button>`
          : `<button class="btn piccolo" data-scorda="${g.id}" style="margin-top:4px">scorda</button>`}
      </div>
    </div>`;
  }).join('');

  const dentro = s.attiva
    ? `<div class="riga" style="padding-top:0">
        <div class="cresci"><div>Sessione aperta</div>
          <div class="perche">Scade alle ${ora(s.scade)}. La scatoletta legge ogni ${s.secondi || 10} secondi
            finche' dura, poi torna da sola al passo normale.</div></div>
        <button class="btn piccolo" id="taratura-chiudi">chiudi</button>
      </div>
      <div class="griglia stretta" style="margin-top:10px">
        ${CARICHI.map(c => `<button class="btn" data-carico="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <div class="riga" style="margin-top:10px">
        <div class="cresci"><input id="taratura-nome" placeholder="un altro carico…"></div>
        <button class="btn" id="taratura-segna">segna</button>
      </div>
      <div class="nota" style="margin-top:10px">Accendi il carico <b>e subito</b> premi il suo tasto. Lo scalino
        compare dopo circa tre minuti: tanto serve per avere letture stabili dopo l'accensione.</div>`
    : `<div class="riga" style="padding-top:0">
        <div class="cresci"><div>Nessuna sessione aperta</div>
          <div class="perche">Spegni tutto, apri la sessione, e accendi un carico per volta premendo il suo tasto.
            Ne esce il consumo del <b>tuo</b> camper invece di numeri da catalogo.</div></div>
        <button class="btn primario" id="taratura-apri">apri</button>
      </div>
      <div class="nota" style="margin-top:10px">La scatoletta se ne accorge al giro dopo, quindi fino a cinque minuti:
        comincia quando l'ora in alto a destra diventa fresca di meno di un minuto.</div>`;

  return `<div class="titolo">Taratura dei consumi</div>
    <div class="scheda">${dentro}</div>
    ${segni ? `<div class="scheda" style="margin-top:10px">${segni}</div>` : ''}`;
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
  const taratura = await bloccoTaratura();
  return `${taratura}
    <div class="titolo">I dati fissi</div>
    <div class="nota">Questi sono i dati fissi del <b>tuo</b> camper: non stanno nel codice perché cambiano quando cambi un pezzo. Un valore che scrivi qui diventa <span class="bollo misurato">misurato</span>, e i conti che lo usano smettono di chiamarsi stime.</div>
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
      <div class="nota" style="margin-top:10px">Si apre la loro pagina, si preme <b>Agree</b>, e <b>poi</b> chiede l’accesso al tuo account Bluetti:
        entra lì e torni qui da solo. Su iPhone tutto questo succede in <b>Safari</b>, quindi l’accesso va fatto lì —
        essere entrato nell’app Bluetti del telefono non conta.</div>
      <a class="btn primario largo" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="${esc(dati.collegamento?.indirizzo || '#')}">${dati.collegamento?.collegato ? 'Ricollega' : 'Collega la Bluetti'}</a>
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
      : esito === 'scaduto' ? 'Il collegamento è scaduto: ripremi il tasto e rifallo entro un quarto d’ora'
      : 'Il collegamento non è riuscito: riprova');
  }
}

function aggancia() {
  const r = $('#rileggi');
  if (r) r.onclick = sicuro(async () => { r.textContent = '…'; await api('/stato?fresco=1'); await disegna(); brindello('Riletto'); });

  for (const id of ['c-da', 'c-a', 'c-a-amp']) {
    const e = document.getElementById(id);
    if (!e) continue;
    // Si ricalcola mentre scrive, ma solo il riquadro: ridisegnare tutta la
    // pagina a ogni cifra farebbe perdere il fuoco dal campo.
    e.oninput = () => {
      const c = leggiCalc();
      const v = e.value === '' ? null : Number(e.value);
      if (id === 'c-da') c.da = v; else if (id === 'c-a') c.a = v; else c.ampere = v;
      scriviCalc(c);
      const vecchio = e.closest('.scheda');
      const nuovo = document.createRange().createContextualFragment(calcolo()).firstElementChild;
      vecchio.replaceWith(nuovo);
      const rimesso = document.getElementById(id);
      // Su un <input type=number> spostare il cursore lancia InvalidStateError:
      // il fuoco serve, la posizione e' un di piu' che non vale un errore.
      if (rimesso) {
        rimesso.focus();
        try { rimesso.setSelectionRange(rimesso.value.length, rimesso.value.length); } catch { /* i campi numerici non lo permettono */ }
      }
      aggancia();
    };
  }

  const g = $('#giorni');
  if (g) g.onchange = sicuro(async () => { localStorage.setItem('giorni', g.value); await disegna(); });

  const s = $('#salva');
  if (s) s.onclick = sicuro(async () => {
    const campi = [...document.querySelectorAll('[data-chiave]')];
    for (const c of campi) await api('/impianto/' + encodeURIComponent(c.dataset.chiave), { method: 'PUT', body: { valore: c.value } });
    brindello('Impianto aggiornato');
    await disegna();
  });

  const ta = $('#taratura-apri');
  if (ta) ta.onclick = sicuro(async () => {
    await api('/taratura/apri', { method: 'POST', body: { minuti: 30 } });
    brindello('Taratura aperta per 30 minuti');
    await disegna();
  });

  const tc = $('#taratura-chiudi');
  if (tc) tc.onclick = sicuro(async () => {
    await api('/taratura/chiudi', { method: 'POST', body: {} });
    brindello('Taratura chiusa');
    await disegna();
  });

  // Segnare e' l'unica cosa che si fa col carico in mano: deve costare un tocco
  // e non deve ridisegnare la pagina sotto le dita, altrimenti si perde il
  // tasto successivo. Si avvisa e si ridisegna dopo.
  const segnaCarico = async (nome) => {
    await api('/taratura/segna', { method: 'POST', body: { nome } });
    brindello(`Segnato: ${nome}`);
    await disegna();
  };
  for (const b of document.querySelectorAll('[data-carico]')) {
    b.onclick = sicuro(() => segnaCarico(b.dataset.carico));
  }
  const ts = $('#taratura-segna');
  if (ts) ts.onclick = sicuro(async () => {
    const campo = $('#taratura-nome');
    const nome = (campo?.value || '').trim();
    if (!nome) { brindello('Scrivi come si chiama il carico'); return; }
    await segnaCarico(nome);
  });

  for (const b of document.querySelectorAll('[data-accetta]')) {
    b.onclick = sicuro(async () => {
      const r = await api('/taratura/accetta/' + b.dataset.accetta, { method: 'POST', body: {} });
      brindello(`Salvato in impianto: ${num(r.ampere, 2)} A`);
      await disegna();
    });
  }
  for (const b of document.querySelectorAll('[data-scorda]')) {
    b.onclick = sicuro(async () => {
      await api('/taratura/segni/' + b.dataset.scorda, { method: 'DELETE' });
      await disegna();
    });
  }

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

// ---------- l'app che si accorge di essere vecchia ----------
//
// Un'app aggiunta alla schermata Home di iPhone non si ricarica da sola: iOS
// la tiene sospesa e riaprendola riprende la pagina di prima. Chi la usa non
// ha modo di accorgersene, perche' li' dentro non c'e' nemmeno il tasto di
// ricarica di Safari.
//
// Allora chiede lei: a ogni ritorno in primo piano confronta l'impronta del
// programma con quella che aveva all'avvio. Se e' cambiata, si ricarica.
let improntaMia = null;

async function controllaVersione() {
  let v;
  try { v = (await (await fetch('/api/health', { cache: 'no-store' })).json())?.versione; } catch { return; }
  if (!v) return;
  if (improntaMia == null) { improntaMia = v; return; }
  if (v === improntaMia) return;
  brindello('Nuova versione: ricarico\u2026');
  // Un attimo perche' si legga l'avviso, e la ricarica senza la cache
  setTimeout(() => location.reload(), 900);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) controllaVersione(); });
window.addEventListener('focus', controllaVersione);
setInterval(controllaVersione, 10 * 60 * 1000);

async function avvia() {
  try {
    await controllaVersione();          // prende l'impronta di partenza
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
