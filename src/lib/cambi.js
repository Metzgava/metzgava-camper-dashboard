// Cambi verso l'euro, dalla Banca Centrale Europea tramite frankfurter.dev:
// gratuito, senza chiavi, e conosce anche le date passate.
//
// Il cambio si salva insieme alla spesa e non si tocca piu': una nota in corone
// di luglio deve restare quello che e' costata a luglio, anche se la corona poi
// si muove. Ricalcolare tutto a ogni apertura farebbe ballare i totali di
// viaggi gia' chiusi.
import { fetchJson } from './util.js';

const BASE = process.env.CAMBI_URL || 'https://api.frankfurter.dev/v1';

// Quelle che servono a chi gira in camper per l'Europa. Aggiungerne una e'
// una riga: il servizio ne conosce una trentina.
export const VALUTE = {
  EUR: { nome: 'Euro', segno: '€' },
  CHF: { nome: 'Franchi svizzeri', segno: 'CHF' },
  GBP: { nome: 'Sterline', segno: '£' },
  NOK: { nome: 'Corone norvegesi', segno: 'kr' },
  SEK: { nome: 'Corone svedesi', segno: 'kr' },
  DKK: { nome: 'Corone danesi', segno: 'kr' },
};
export const valutaValida = v => Object.prototype.hasOwnProperty.call(VALUTE, String(v || '').toUpperCase()) ? String(v).toUpperCase() : 'EUR';

const cache = new Map();                       // "NOK|2026-07-02" -> euro per unita'
const CHIAVE = (v, g) => `${v}|${g || 'oggi'}`;

// Quanti euro vale un'unita' di quella valuta in quel giorno. L'euro vale uno.
export async function cambioVersoEuro(valuta, giorno = null) {
  const v = valutaValida(valuta);
  if (v === 'EUR') return 1;
  const k = CHIAVE(v, giorno);
  if (cache.has(k)) return cache.get(k);
  // Il servizio da' quante unita' di valuta fanno un euro: a noi serve l'inverso
  const quando = /^\d{4}-\d{2}-\d{2}$/.test(String(giorno || '')) ? giorno : 'latest';
  const d = await fetchJson(`${BASE}/${quando}?base=EUR&symbols=${v}`, {}, 12000);
  const perEuro = Number(d?.rates?.[v]);
  if (!Number.isFinite(perEuro) || perEuro <= 0) throw new Error(`cambio ${v} non disponibile`);
  const valore = Math.round((1 / perEuro) * 1e6) / 1e6;
  cache.set(k, valore);
  return valore;
}

// Il cambio da usare per un importo: quello indicato a mano se c'e', altrimenti
// quello del giorno. Se il servizio non risponde non si blocca la spesa: si
// registra l'importo con cambio 1 e lo si dice.
export async function cambioPerSpesa({ currency, rate, date }) {
  const v = valutaValida(currency);
  if (v === 'EUR') return { currency: 'EUR', rate: 1 };
  const aMano = Number(rate);
  if (Number.isFinite(aMano) && aMano > 0) return { currency: v, rate: aMano };
  try {
    return { currency: v, rate: await cambioVersoEuro(v, date) };
  } catch (e) {
    console.warn(`cambi: ${v} non disponibile (${String(e.message).slice(0, 80)})`);
    return { currency: v, rate: null, avviso: `Cambio ${v} non disponibile: indicalo a mano` };
  }
}
