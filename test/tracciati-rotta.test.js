// La rotta che attacca i tracciati veri alle tappe di un viaggio.
//
// Disegno: docs/superpowers/specs/2026-11-24-tracciati-veri-design.md
//
// Si guardano **solo i giorni del viaggio**: fuori da quelli si lascia
// perdere. Col file evita che un tragitto di agosto finisca su una tappa di
// novembre; con l'interfaccia di CarLock -- che verra' dopo -- e' educazione
// verso un servizio che ci sta gia' facendo un favore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quantoSbagliava } from '../src/lib/tracciati.js';

const rotta = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');
const laRotta = (() => {
  const i = rotta.indexOf("router.post('/trips/:id/tracciati'");
  assert.ok(i > 0, 'la rotta dei tracciati non si trova piu’');
  const fine = rotta.indexOf('router.', i + 10);
  assert.ok(fine > i, 'non si delimita la rotta: finestra non affidabile');
  return rotta.slice(i, fine);
})();

test('la misura dello scarto trova il punto piu’ lontano', () => {
  // Il caso vero del 21/11: la ricostruzione passava per Bassano, a una
  // quindicina di chilometri dalla strada percorsa.
  const vera = [[46.0, 11.5], [45.9, 12.0], [45.9, 12.2]];
  const vecchia = [[46.0, 11.5], [45.767, 11.735], [45.9, 12.2]];
  const km = quantoSbagliava(vecchia, vera);
  assert.ok(km > 10 && km < 30, `scarto misurato: ${km}`);
});

test('due righe uguali non sbagliano di niente', () => {
  const r = [[46, 11], [46, 12]];
  assert.ok(quantoSbagliava(r, r) < 0.001);
});

test('senza una delle due righe non si misura niente', () => {
  // `null` vuol dire «non so»: uno zero direbbe «la ricostruzione era
  // perfetta», che e' un'altra affermazione.
  assert.equal(quantoSbagliava(null, [[46, 11]]), null);
  assert.equal(quantoSbagliava([[46, 11]], []), null);
  assert.equal(quantoSbagliava([], []), null);
});

// La prova di prima cercava «start_date|periodo|dal|giorni» nel testo della
// rotta, e la revisione del 24/11/2026 ha trovato che passava anche
// **cancellando la riga che filtra**: quelle parole stanno nel codice che
// calcola i capi del periodo, non in quello che li applica. Il vincolo piu'
// importante del disegno non aveva una prova capace di fallire.
//
// Adesso il periodo e il filtro sono due funzioni pure, provate sui valori in
// `test/tracciati-periodo.test.js` -- compreso il tragitto di agosto. Qui
// resta una cosa sola da pretendere: che la rotta **le chiami**.
test('si guardano solo i giorni del viaggio', () => {
  assert.match(laRotta, /dentroIlPeriodo\(/,
    'la rotta non filtra per periodo: un tragitto di agosto puo’ finire su una tappa di novembre');
  assert.match(laRotta, /periodoDelViaggio\(/, 'il periodo non viene dalle date del viaggio');
  assert.match(laRotta, /fuori_periodo/, 'non si dice quanti tragitti sono rimasti fuori dalle date');
});

test('un file che non si e’ saputo leggere non diventa un «ok» con tutti zero', () => {
  // Sbagliando export -- quello normale invece di quello delle posizioni --
  // la risposta era `ok` con zero attaccati, e la pagina dava la colpa ai
  // giorni del viaggio: una spiegazione falsa per «non ho capito il file».
  const i = laRotta.indexOf('leggiTracciati(');
  assert.ok(i > 0, 'la rotta non legge piu’ il file');
  const dopo = laRotta.slice(i, i + 700);
  assert.match(dopo, /!tutti\.length|tutti\.length === 0/,
    'non si controlla se dal file e’ uscito qualcosa');
  assert.match(dopo, /status\(400\)/, 'un file illeggibile riceve ancora una risposta buona');
  assert.match(dopo, /latitude/, 'non si dice quali colonne servono');
});

test('i conti del resoconto vengono dalla funzione che li fa tornare', () => {
  // Due contatori per la stessa cosa divergono: quello della rotta contava
  // solo le tappe riscritte, quello del resoconto tutte le agganciate.
  assert.match(laRotta, /resoconto\(tappe, perTappa\)/,
    'i secchi del resoconto non vengono da `resoconto`');
  assert.doesNotMatch(laRotta, /attaccati\+\+|gia_veri\+\+/,
    'la rotta conta di nuovo per conto suo: due conti della stessa cosa divergono');
});

test('la rotta scrive la geometria e i segni, nient’altro', () => {
  // L'anti obiettivo: km, durata, orari e capi sono misure del tracker o
  // decisioni di chi guida.
  const update = laRotta.match(/UPDATE legs SET[^`']*/)[0];
  for (const colonna of ['distance_km', 'duration_min', 'start_time', 'end_time',
                         'source', 'from_lat', 'from_lon', 'to_lat', 'to_lon'])
    assert.doesNotMatch(update, new RegExp(colonna), `la rotta riscrive ${colonna}`);
});

test('se la traccia comincia lontano dal capo salvato, lo si dice', () => {
  // I capi non si spostano -- non c'e' modo di sapere quali ha sistemato lui
  // -- ma quattrocento metri di scarto sono un fatto che merita di sapere.
  assert.match(laRotta, /capi_lontani/,
    'la distanza fra la traccia e il capo salvato non si misura');
});

test('caricare due volte lo stesso file non fa doppioni', () => {
  // Il conto di «quante erano gia' vere» sta in `resoconto`, provato sui
  // valori in `test/tracciati-periodo.test.js`. Quel che resta qui e' il
  // pezzo che vive nella rotta: al secondo caricamento **lo scarto non si
  // rimisura**. Rimisurarlo darebbe la distanza fra la traccia e se stessa --
  // cioe' zero, cioe' «la ricostruzione era perfetta»: il numero piu'
  // rassicurante e piu' falso di tutti.
  assert.match(laRotta, /tappa\.tracciato_vero \? tappa\.scarto_ricostruzione_km/,
    'al secondo caricamento lo scarto si rimisura contro la traccia stessa: verrebbe zero');
});

test('le due colonne nuove esistono', () => {
  const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');
  assert.match(db, /tracciato_vero/, 'niente segno che spenga il puntinato');
  assert.match(db, /scarto_ricostruzione_km/,
    'non si conserva quanto sbagliava la ricostruzione');
});

// Una riga di due punti non e' una ricostruzione: e' la linea d'aria che si
// disegna quando i percorsi non rispondono, e misurare contro quella da' un
// numero piccolo che sembra dire «il ricostruttore aveva quasi indovinato».
//
// Visto dal vivo il 24/11/2026: su una tappa la cui riga era la linea d'aria
// fra i due capi, lo scarto e' venuto **0,00** -- cioe' «la ricostruzione era
// perfetta», che e' l'unico numero che questa misura non deve mai poter
// stampare per sbaglio. Il commento della funzione lo dice gia' per il caso
// della riga mancante; questo e' lo stesso caso travestito.
test('contro una linea d’aria non si misura quanto sbagliava il ricostruttore', () => {
  const vera = [[45.85, 12.25], [45.5, 12.0], [45.2, 11.8], [44.49, 11.34]];
  const lineaDAria = [[45.85, 12.25], [44.49, 11.34]];
  assert.equal(quantoSbagliava(lineaDAria, vera), null,
    'uno scarto quasi nullo misurato contro due punti diventa una lode al ricostruttore');
  // Tre punti sono una strada scelta: li’ la misura vuol dire qualcosa.
  assert.ok(quantoSbagliava([[45.85, 12.25], [46.5, 11.0], [44.49, 11.34]], vera) > 0);
});
