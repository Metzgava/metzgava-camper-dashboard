// La pagina servita con l'impronta dei suoi file al posto di un numero scritto
// a mano.
//
// `index.html` chiamava `app.js?v=16`, e quel 16 andava alzato a mano a ogni
// modifica del programma della pagina. Dimenticarlo non da' nessun segnale: la
// pubblicazione riesce, il server e' aggiornato, e il browser continua a
// mostrare per un'ora il file che ha in tasca. E' successo il 18/11 e sono
// serviti venti minuti per capirlo, cercando guasti in due funzioni che
// funzionavano benissimo.
//
// L'impronta — la stessa che `/api/health` gia' calcola sui file della pagina
// — cambia da se' quando cambiano i file. Messa qui, il numero a mano sparisce
// e con lui la possibilita' di dimenticarlo.
//
// `index.html` si serve con `no-store`, quindi la sostituzione arriva sempre
// fresca: e' il file che la cita a essere tenuto in cache, non lei.

// Solo `?v=` attaccato a un file nostro: `app.js`, `stile.css`, e qualunque
// altro ne arrivi. Un indirizzo esterno che per caso ha la stessa forma non si
// tocca — da qui il nome del file richiesto davanti.
const VERSIONE = /(\s(?:src|href)="[^"]+\.(?:js|css))\?v=[^"]*"/g;

export function conImpronta(html, impronta) {
  if (!impronta) return html;
  return String(html).replace(VERSIONE, `$1?v=${impronta}"`);
}

// E la stessa cosa per i moduli che un file della pagina importa.
//
// `conImpronta` guarda dentro `index.html` e trova gli indirizzi scritti li'.
// Ma da quando `app.js` importa un altro file della pagina, c'e' un secondo
// indirizzo che `index.html` non nomina:
//
//     import { rifondi } from './rifondi.js';
//
// Senza impronta il browser lo chiede liscio, lo static lo serve con un'ora di
// cache, e dopo una pubblicazione si ritrova a far girare un pezzo vecchio
// dentro un `app.js` nuovo. E' il guasto del 18/11 che rientra da un'altra
// porta, e peggiore: i due file non sarebbero nemmeno della stessa eta'.
//
// Si toccano solo gli indirizzi che cominciano per `./` o `../`, cioe' i file
// nostri. `express`, un indirizzo altrui o una strada assoluta non c'entrano
// con l'impronta della nostra pagina, e appiccicargliela romperebbe la
// richiesta.
const MODULO = /((?:\bfrom|\bimport\s*\()\s*['"])(\.{1,2}\/[^'"?]+\.js)(?:\?v=[^'"]*)?(['"])/g;

export function conImprontaNeiModuli(js, impronta) {
  if (!impronta) return js;
  return String(js).replace(MODULO, `$1$2?v=${impronta}$3`);
}
