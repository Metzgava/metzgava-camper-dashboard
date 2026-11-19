// Quando la lettura della Bluetti e' di ripiego, i conti che la mescolano con
// le Ective non si fanno.
//
// Il 19/11/2026 il proprietario ha acceso il 220 dalla Bluetti e ha letto
// nella sezione «Dalla Bluetti alle Ective»: **esce 0 W, arriva 201 W**. Una
// frase impossibile, e la sua domanda -- «perche'?» -- era la domanda giusta.
//
// Non era un errore di misura. Il cloud di Bluetti rifiutava da sei minuti, e
// il server mostrava correttamente l'ultima lettura buona: quella delle
// 14:05:17, diciassette secondi **prima** che il 220 venisse acceso. Quindi la
// Bluetti era ferma a un istante in cui non erogava niente, mentre le Ective
// arrivavano fresche di due minuti dalla scatoletta.
//
// Due dati di eta' diversa, messi fianco a fianco senza dirlo, e il conto
// «quanto ne arriva in percentuale» calcolato fra i due. E' la regola di
// sempre, applicata male: un numero vecchio messo dove si guarda «adesso» e'
// peggio di una casella vuota. Li' la casella non era vuota: conteneva un
// numero che contraddiceva quello accanto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './aiuto/archivio-finto.js';

const { bluettiNonConfrontabile } = await import('../src/lib/conti.js');

test('una lettura fresca si puo’ confrontare', () => {
  assert.equal(bluettiNonConfrontabile({ collegato: true, apparecchi: [{}] }), null);
});

test('una lettura di ripiego no, e si dice perche’', () => {
  const m = bluettiNonConfrontabile({ vecchia: true, minuti: 6 });
  assert.ok(m, 'deve tornare una spiegazione');
  assert.match(m, /6/, 'l’eta’ va detta: sei minuti e sei ore sono casi diversi');
});

test('la spiegazione dice che il conto sarebbe falso, non che manca un dato', () => {
  // Il dato c'e'. E' vecchio. Chi legge deve capire che il problema e' il
  // confronto fra due istanti diversi, non un numero assente.
  assert.match(bluettiNonConfrontabile({ vecchia: true, minuti: 6 }), /fresc|vecchi|confront|istant/i);
});

test('senza l’eta’ si dice comunque che non si puo’ confrontare', () => {
  assert.ok(bluettiNonConfrontabile({ vecchia: true }));
});

test('niente Bluetti non e’ una lettura vecchia', () => {
  // Non collegata e' un altro caso, con il suo messaggio: qui non si deve
  // dire «l'ultima lettura buona e' di N minuti fa» quando lettura non ce
  // n'e' mai stata.
  assert.equal(bluettiNonConfrontabile(null), null);
  assert.equal(bluettiNonConfrontabile({ collegato: false }), null);
});
