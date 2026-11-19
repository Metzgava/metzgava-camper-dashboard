// Quando il cloud di Bluetti rifiuta un comando, cosa legge il proprietario.
//
// Il 19/11/2026 ha premuto «accendi 220»: il primo comando e' passato, poi il
// loro cloud ha cominciato a rifiutare con msgCode 805 e lui ha visto
// «Il cloud ha rifiutato il comando» -- una frase che non dice ne' perche' ne'
// cosa fare. La sua conclusione, ragionevole: «non funziona».
//
// Due difetti dietro quella frase.
//
// **Il primo: il messaggio utile c'era e veniva buttato via.** `comanda()`
// mette la spiegazione nel campo `errore`; la rotta leggeva `r.messaggio`, che
// in quel caso non esiste, e cadeva sempre sulla frase generica. Una frase
// scritta con cura, prodotta a ogni rifiuto e mai letta da nessuno.
//
// **Il secondo: le due parti del codice credevano cose diverse sullo stesso
// codice d'errore.** Il percorso delle letture ha imparato -- e ha un commento
// lungo che lo dice -- che «805 non vuol dire che il permesso e' morto»: e'
// intermittente, e trenta secondi dopo passa. Il percorso dei comandi diceva
// «il permesso e' scaduto: ricollega». Mandava a rifare un collegamento che
// non serviva, nel momento in cui bastava aspettare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './aiuto/archivio-finto.js';

const { motivoRifiuto } = await import('../src/routes/stato.js');
const { RIFIUTO_805 } = await import('../src/lib/bluetti.js');

test('il messaggio di `errore` vince sul generico', () => {
  assert.equal(motivoRifiuto({ ok: false, errore: 'il permesso e’ scaduto' }),
    'il permesso e’ scaduto');
});

test('va bene anche quando il cloud parla col campo `messaggio`', () => {
  assert.equal(motivoRifiuto({ ok: false, messaggio: 'device offline' }), 'device offline');
});

test('`errore` ha la precedenza su `messaggio`', () => {
  // `errore` e' la nostra frase in italiano; `messaggio` e' quella del loro
  // cloud, che il 17/11 arrivo' in cinese.
  assert.equal(motivoRifiuto({ errore: 'la nostra', messaggio: '登录已过期' }), 'la nostra');
});

test('senza niente da dire resta una frase, non un vuoto', () => {
  assert.ok(motivoRifiuto({}).length > 0);
  assert.ok(motivoRifiuto(null).length > 0);
});

test('la frase per l’805 dice di aspettare, non solo di ricollegare', () => {
  // Perche' e' quel che il percorso delle letture ha imparato: e' un rifiuto
  // momentaneo. Mandare a ricollegare come prima cosa fa rifare un lavoro
  // inutile nel momento sbagliato.
  assert.match(RIFIUTO_805, /riprova|aspett|attend/i);
  assert.doesNotMatch(RIFIUTO_805, /scadut/i,
    'dire «scaduto» e’ proprio quel che le letture hanno scoperto essere falso');
});
