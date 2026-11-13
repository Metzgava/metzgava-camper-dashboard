// Dal codice di una scheda park4night al posto sulla mappa.
//
// park4night non ha un servizio da cui pescare i dati, ma nella pagina di ogni
// posto c'e' il collegamento «fatti portare li' da Google Maps», e quello porta
// le coordinate. Si legge quello: una volta sola, quando si incolla il codice,
// e quello che torna si salva. Se un giorno cambiano com'e' fatta la pagina,
// qui torna null e chi sta scrivendo si sente dire «mettilo tu sulla mappa» -
// che e' una seccatura, non un guasto.
import { numeroPark4night, linkPark4nightPosto } from './geo.js';

// Come park4night classifica un posto sta scritto nell'icona in cima alla
// scheda: «Campeggio», «Parcheggio giorno e notte», «Area di servizio»... Nelle
// parole chiave della pagina c'e' invece una lista fissa, uguale su ogni posto,
// e leggere quella vuol dire chiamare campeggio anche un parcheggio sterrato.
const tipoDallIcona = t => t.match(/place-header-access[\s\S]{0,200}?<img[^>]*\salt="([^"]*)"/i)?.[1]?.trim() || null;

// Il titolo della pagina e' «park4night - (10057) Avigliana - 1 Strada
// Provinciale 188»: il nome e' quello che resta togliendo il marchio davanti e
// il codice postale fra parentesi. Non sempre e' di cifre - in Inghilterra e'
// SW1A 1AA - quindi si toglie quello che c'e' fra le parentesi, non un numero.
const nomeDalTitolo = titolo => (titolo || '')
  .replace(/^\s*park4night\s*-\s*/i, '')
  .replace(/^\(\s*[^)]{1,12}\)\s*/, '')
  .trim() || null;

export const estraiDaPagina = html => {
  try {
    const t = String(html ?? '');
    const dove = t.match(/destination=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    // Senza coordinate non c'e' niente da salvare: meglio dirlo che tirare a
    // indovinare un posto in mezzo al mare
    if (!dove) return null;
    return {
      nome: nomeDalTitolo(t.match(/<title>([^<]*)<\/title>/i)?.[1]),
      lat: +dove[1],
      lon: +dove[2],
      // Il prezzo non si legge: nella pagina i numeri con l'euro stanno anche
      // dentro alle recensioni, e prenderne uno a caso vuol dire scrivere una
      // cifra sbagliata con l'aria di essere giusta. Quello lo mette chi sa.
      tipo: tipoDallIcona(t),
    };
  } catch { return null; }
};

// Torna il posto, oppure null. Non lancia mai: per chi sta incollando un
// codice, «non l'ho trovato» e «non sono riuscito a leggerla» sono la stessa
// cosa - rimbocca le maniche e lo mette lui sulla mappa.
export async function leggiPosto(codice, timeoutMs = 10000) {
  const id = numeroPark4night(codice);
  if (!id) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(linkPark4nightPosto(id), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'camper-dashboard/1.0', 'Accept-Language': 'it-IT,it;q=0.9' },
    });
    if (!res.ok) return null;
    const posto = estraiDaPagina(await res.text());
    return posto ? { p4n_id: id, ...posto } : null;
  } catch { return null; } finally { clearTimeout(t); }
}
