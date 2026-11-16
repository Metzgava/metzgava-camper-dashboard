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

export async function impianto() {
  const righe = (await q('SELECT chiave, valore, unita, nota, misurato FROM impianto ORDER BY chiave')).rows;
  const mappa = Object.fromEntries(righe.map(r => [r.chiave, r]));
  return { righe, mappa };
}

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
  out.ore_colonnina = mancaWh == null
    ? manca('h', ['carica della Bluetti'], 'Serve la carica letta dal cloud.')
    : acW == null
      ? manca('h', ['bluetti_carica_ac_w'], 'Non so a quanti watt carica dalla 220.')
      : conto(mancaWh / acW, 'h', {
          base: misurato(m, 'bluetti_carica_ac_w', 'bluetti_wh') ? 'misurato' : 'stima',
          perche: `${mancaWh} Wh da rimettere, a ${acW} W dalla presa`,
          detto: dilloInOre(mancaWh / acW),
        });

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

  // ---- quanto dura il camper fermo ----
  out.giorni_fermo_bluetti = out.carica_residua.valore == null || fermoW == null
    ? manca('giorni', ['consumo_fermo_w'], 'Serve il consumo a riposo.')
    : conto(out.carica_residua.valore / fermoW / 24, 'giorni', {
        base: misurato(m, 'consumo_fermo_w', 'bluetti_wh') ? 'misurato' : 'stima',
        perche: `${out.carica_residua.valore} Wh a ${fermoW} W di consumo fermo`,
        detto: dilloInOre(out.carica_residua.valore / fermoW),
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
