// Quello che si può scrivere su una proposta, ripulito. Sta qui e non fra le
// rotte perché è pulizia di dati e basta: si prova senza accendere niente.
import { linkPark4nightPosto, numeroPark4night } from './geo.js';
import { num } from './util.js';

export const TIPI = ['pernotto', 'sosta', 'visita'];
export const STATI = ['proposto', 'guardare', 'scelto', 'scartato'];

// Quello che si puo' scrivere su una proposta, ripulito. Il prezzo e' a notte e
// resta qui: non diventa mai il costo di una sosta, perche' una sosta che costa
// diventa da sola una spesa vera del viaggio - e qui non si e' ancora speso
// niente.
export const datiProposta = (b, vecchia = {}) => {
  // Un campo che arriva vuoto e' un campo che qualcuno ha svuotato apposta: il
  // codice sbagliato si deve poter togliere. Solo i campi che non arrivano
  // affatto tengono quello che c'era.
  const scritto = (chiave, di) => (b && chiave in b ? b[chiave] : di);
  const p4n = numeroPark4night(scritto('p4n_id', vecchia.p4n_id));
  const vecchio = scritto('link', vecchia.link);
  const quanto = b?.prezzo ?? vecchia.prezzo;
  return {
    nome: String(b?.nome ?? vecchia.nome ?? '').trim().slice(0, 200),
    tipo: TIPI.includes(b?.tipo) ? b.tipo : (TIPI.includes(vecchia.tipo) ? vecchia.tipo : 'pernotto'),
    lat: b?.lat === '' || b?.lat == null ? (b && 'lat' in b ? null : vecchia.lat ?? null) : num(b.lat),
    lon: b?.lon === '' || b?.lon == null ? (b && 'lon' in b ? null : vecchia.lon ?? null) : num(b.lon),
    p4n_id: p4n,
    // Il collegamento nato da un codice e' del codice, non di chi scrive:
    // tolto il codice se ne va anche quello, se no resta a indicare il posto
    // sbagliato che si era appena cancellato.
    link: linkPark4nightPosto(p4n)
      || (vecchio === linkPark4nightPosto(vecchia.p4n_id) ? null : String(vecchio ?? '').trim().slice(0, 500) || null),
    tipo_p4n: String(scritto('tipo_p4n', vecchia.tipo_p4n) ?? '').trim().slice(0, 80) || null,
    prezzo: quanto === '' || quanto == null ? null : num(quanto),
    currency: String(b?.currency ?? vecchia.currency ?? '').trim().slice(0, 3).toUpperCase() || null,
    perche: String(b?.perche ?? vecchia.perche ?? '').trim().slice(0, 2000) || null,
    perche_no: String(b?.perche_no ?? vecchia.perche_no ?? '').trim().slice(0, 500) || null,
  };
};

