// La cassetta: ci si butta dentro qualunque cosa e lei capisce cos'è.
//
// Questa parte non chiama nessuno: guarda il testo e dice di che si tratta.
// Andare a leggere una pagina è una decisione di chi la usa, non di qui — così
// «chiedere a Paolo di park4night» resta un appunto invece di diventare una
// richiesta al sito di qualcun altro.
import { numeroPark4night } from './geo.js';
import { puntiDaLinkMaps } from './maps.js';

// Gli indirizzi accorciati di Google Maps non dicono niente finché non li si
// segue: sono un caso a parte, e chi usa la cassetta sa cosa farne.
const MAPS_CORTO = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

const unIndirizzo = t => {
  // Uno spazio dentro vuol dire che è una frase, non un indirizzo: «vedi
  // park4night domani» non è un link, per quanto gli somigli
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try { return new URL(t); } catch { return null; }
};

export function capisciIncollato(testo) {
  const t = String(testo ?? '').trim();
  if (!t) return { tipo: 'nota', testo: '' };

  const url = unIndirizzo(t);

  if (url && MAPS_CORTO.test(t)) return { tipo: 'maps-corto', url: t };

  // Un numero da solo, o un indirizzo di park4night: è un posto. Il numero si
  // riconosce solo quando è tutto quello che c'è scritto.
  const p4n = url ? (/park4night\./i.test(url.hostname) ? numeroPark4night(t) : null)
    : (/^#?\s*\d{2,9}$/.test(t) ? numeroPark4night(t) : null);
  if (p4n) return { tipo: 'park4night', p4n_id: p4n, url: url ? t : null };

  if (url) {
    const punti = puntiDaLinkMaps(t);
    if (punti.length > 1) return { tipo: 'maps-percorso', punti, url: t };
    if (punti.length === 1) return { tipo: 'maps-punto', punto: punti[0], url: t };
    return { tipo: 'link', url: t };
  }

  return { tipo: 'nota', testo: t };
}
