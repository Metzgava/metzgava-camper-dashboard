// Il conto di un'ipotesi di viaggio.
//
// Un'ipotesi e' una direzione presa per intero: la destinazione, e sotto i
// giorni che servono ad arrivarci e a girarci. Serve a una cosa sola, mettere
// due direzioni accanto e vedere cosa costano - quindi il conto e' il cuore, e
// vale la regola del budget: ogni numero porta con se' **come** e' stato
// contato, e quando un dato manca si torna null invece di zero. Zero vuol dire
// «non costa niente», che non e' quello che si sta dicendo.
//
// Il giorno e' un contenitore: dentro puo' avere una tratta, due, o nessuna. Un
// giro di venti giorni senza un solo giorno fermo non esiste.
import { gasolioPrevisto } from './budget.js';

const dueDecimali = n => Math.round(n * 100) / 100;
const comeSiScrive = (n, dec = 0) => n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Di ogni strada vale la variante scelta: e' quella che si fara'. Senza una
// scelta vale la prima, che e' quella che si vede in cima.
const varianteDi = p => {
  const v = p?.varianti || [];
  return v.find(x => x.chiave === p?.scelta) || v[0] || null;
};

const tratteDi = giorni => (giorni || []).flatMap(g => (g.percorsi || []).map(varianteDi).filter(Boolean));

export function contoIpotesi({ giorni, kmPerLitro, prezzoLitro, tariffaPedaggio }) {
  const elenco = giorni || [];
  const tratte = tratteDi(elenco);
  const km = dueDecimali(tratte.reduce((a, v) => a + (+v.distance_km || 0), 0));
  const minuti = Math.round(tratte.reduce((a, v) => a + (+v.duration_min || 0), 0));
  const mancano = [];

  // ---- il gasolio ----
  const gasolio = gasolioPrevisto({ km, kmPerLitro, prezzoLitro });
  if (!gasolio) mancano.push(!km ? 'le tratte dei giorni, per contare il gasolio'
    : !(+kmPerLitro) ? 'il consumo del camper, per contare il gasolio'
      : 'il prezzo del gasolio');

  // ---- i pedaggi ----
  // Dei pedaggi si conoscono i chilometri di autostrada, non la tariffa: il
  // costo e' una stima a tariffa fissa, e si dice che lo e'. Una strada che
  // dichiara zero chilometri di pedaggio costa zero: qui lo zero e' un dato.
  // Il controllo e' su null prima che sul numero: `+null` fa 0, e 0 e' un
  // numero finito. Senza questa riga una strada che non sa i suoi pedaggi
  // direbbe «0 € di pedaggi», che e' il contrario di quello che si sa.
  const conPedaggi = tratte.filter(v => v.pedaggio_km != null && Number.isFinite(+v.pedaggio_km));
  const tariffa = +tariffaPedaggio || 0;
  let pedaggi = null;
  if (!conPedaggi.length) mancano.push('i chilometri di pedaggio delle strade (li dice il calcolatore: premi 🔄)');
  else if (!tariffa) mancano.push('la tariffa dei pedaggi nelle impostazioni');
  else {
    const kmPed = dueDecimali(conPedaggi.reduce((a, v) => a + (+v.pedaggio_km || 0), 0));
    pedaggi = {
      importo: dueDecimali(kmPed * tariffa),
      conto: `${comeSiScrive(kmPed)} km di autostrada × ${comeSiScrive(tariffa, 2)} €/km (stima)`
        + (conPedaggi.length < tratte.length ? ` — ${tratte.length - conPedaggi.length} tratt${tratte.length - conPedaggi.length === 1 ? 'a' : 'e'} non lo dice` : ''),
    };
  }

  // ---- le notti ----
  // Le notti sono i giorni in cui si dorme da qualche parte: quelli che hanno un
  // posto dove dormire - preso dalla lavagna col suo codice park4night, o
  // scritto a mano - o almeno un prezzo. Se nessun giorno lo dice, si stima coi
  // giorni meno uno: il primo si parte, l'ultimo si torna.
  //
  // Il prezzo di una notte: quello scritto sul giorno se c'e', perche' e'
  // l'ultima parola di chi pianifica; se no quello dei posti dove si dorme di
  // quel giorno. Due posti per la stessa notte vogliono dire che non si e'
  // ancora scelto: si fa la media, invece di dare per buono il primo.
  const dormire = g => (g.proposte || []).filter(p => (p.tipo || 'pernotto') === 'pernotto');
  const prezzoNotte = g => {
    if (g.prezzo_notte != null && Number.isFinite(+g.prezzo_notte)) return +g.prezzo_notte;
    const loro = dormire(g).map(p => +p.prezzo).filter(x => Number.isFinite(x) && x > 0);
    return loro.length ? loro.reduce((a, b) => a + b, 0) / loro.length : null;
  };
  const conNotte = elenco.filter(g => g.notte || g.prezzo_notte != null || dormire(g).length);
  const notti = conNotte.length || Math.max(0, elenco.length - 1);
  const prezzi = conNotte.map(prezzoNotte).filter(x => x != null && x > 0);
  let campeggi = null;
  if (!prezzi.length) { if (notti) mancano.push('il prezzo di almeno una notte'); }
  else {
    const noti = dueDecimali(prezzi.reduce((a, b) => a + b, 0));
    const restanti = Math.max(0, notti - prezzi.length);
    const media = noti / prezzi.length;
    campeggi = {
      importo: dueDecimali(noti + restanti * media),
      conto: restanti
        ? `${comeSiScrive(noti, 2)} € di ${prezzi.length} nott${prezzi.length === 1 ? 'e' : 'i'} che sai, più ${restanti} a ${comeSiScrive(media, 2)} € di media`
        : `${prezzi.length} nott${prezzi.length === 1 ? 'e' : 'i'} col suo prezzo`,
    };
  }

  const pezzi = [gasolio, pedaggi, campeggi].filter(Boolean);
  return {
    km, minuti, giorni: elenco.length, notti,
    gasolio: gasolio || null, pedaggi, campeggi,
    totale: pezzi.length ? dueDecimali(pezzi.reduce((a, x) => a + x.importo, 0)) : null,
    mancano,
  };
}
