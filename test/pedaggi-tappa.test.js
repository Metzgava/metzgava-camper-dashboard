// La tappa rispetta l'autostrada dichiarata, e i costi seguono.
//
// Disegno: docs/superpowers/specs/2026-11-22-pedaggi-dichiarati-design.md
//
// Prove sul **cablaggio**, lette dal sorgente come fanno via-vincola e
// carlock-km-veri: e' li' che sono stati i difetti delle volte precedenti. Il
// 21/11/2026 le rotte che ridisegnavano erano quattro e non tre, e quella
// dimenticata era la piu' battuta; e la protezione dei chilometri del tracker
// copriva un ramo solo del salvataggio mentre gli altri due la cancellavano.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rotta = readFileSync(new URL('../src/routes/trips.js', import.meta.url), 'utf8');
const fra = (testo, ancora, quanti) => {
  const i = testo.indexOf(ancora);
  assert.ok(i > 0, `non si trova piu’: ${ancora}`);
  return testo.slice(i, i + quanti);
};
// La rotta del ridisegno, dal suo inizio alla rotta dopo. Una finestra contata
// in caratteri cresce coi commenti e un giorno taglia via quel che la prova
// cercava -- oppure sfonda nella rotta vicina e passa senza provare niente.
// Qui il confine e' la rotta successiva, che e' dove la rotta finisce davvero.
const rottaDelVia = (() => {
  const i = rotta.indexOf("router.post('/legs/:id/via'");
  assert.ok(i > 0, 'la rotta del ridisegno non si trova piu’');
  const fine = rotta.indexOf('router.post(', i + 10);
  assert.ok(fine > i, 'la rotta del ridisegno non ha una rotta dopo: finestra non delimitabile');
  return rotta.slice(i, fine);
})();

test('la strada di una tappa passa dalla dichiarazione, in un posto solo', () => {
  const f = fra(rotta, 'async function stradaDellaTappa', 600);
  assert.match(f, /pedaggiDaUsare\(l\)/, 'stradaDellaTappa non guarda la dichiarazione');
  assert.match(f, /percorsoPerIPunti\([^)]*pedaggi/s, 'i punti si percorrono senza la dichiarazione');
  assert.match(f, /percorsoVicinoAiKm\([^)]*pedaggi/s, 'la strada diretta ignora la dichiarazione');
});

test('nessuna rotta calcola una strada scavalcando stradaDellaTappa', () => {
  // Tre chiamate diritte, e tre sole: le due **dentro** stradaDellaTappa, e
  // quella della creazione delle tappe dall'import CarLock, dove la tappa non
  // esiste ancora e non puo' avere niente da rispettare. Una quarta sarebbe
  // una via che ridisegna dimenticandosi della dichiarazione -- il difetto
  // del 21/11/2026, ripetuto.
  const quante = (rotta.match(/percorsoVicinoAiKm\(|percorsoPerIPunti\(/g) || []).length;
  assert.equal(quante, 3, 'qualcuno calcola la strada senza passare da stradaDellaTappa');
});

test('«Ridisegna» salva la dichiarazione, normalizzata', () => {
  const r = rottaDelVia;
  assert.match(r, /pedaggiDichiarati\(/, 'il valore del corpo si scrive senza normalizzarlo');
  assert.match(r, /pedaggi_dichiarati\s*=/, 'la dichiarazione non si salva sulla tappa');
});

test('il campo assente non cancella la dichiarazione che c’e’', () => {
  // I luoghi si correggono anche senza ridire ogni volta l'autostrada.
  const r = rottaDelVia;
  assert.match(r, /pedaggi\s*!==\s*undefined|undefined\s*===?\s*req\.body\?\.pedaggi|'pedaggi' in /,
    'una richiesta senza il campo azzera la dichiarazione');
});

test('il ridisegno scrive la geometria e i km di autostrada, nient’altro', () => {
  // L'anti obiettivo: km, durata e orari sono misure del tracker, e sono la
  // base del gasolio e dei totali del viaggio.
  const r = rottaDelVia;
  const update = r.match(/UPDATE legs SET geometry[^`']*/)[0];
  for (const colonna of ['distance_km', 'duration_min', 'start_time', 'end_time', 'source', 'senza_pedaggio'])
    assert.doesNotMatch(update, new RegExp(colonna), `il ridisegno riscrive ${colonna}`);
});

test('quel che esce si confronta con quel che e’ stato dichiarato', () => {
  const r = rottaDelVia;
  assert.match(r, /pedaggiNonTornano\(/);
  assert.match(r, /sannoEvitareIPedaggi\(\)/, 'senza la chiave un «no» verrebbe dato per onorato');
  // Il segno della strada mancata vale piu' di `pedaggio_km`: senza
  // OpenRouteService quel numero e' sconosciuto, e un campo vuoto letto come
  // «nessun pedaggio» e' esattamente l'autostrada disegnata in silenzio.
  assert.match(r, /senza_pedaggi_mancata/,
    'una strada senza pedaggi che non si e’ ottenuta passerebbe per onorata');
});

test('i costi si rifanno dopo il ridisegno, zero compreso', () => {
  // `syncTollExpense` cancella la stima quando i km sono zero e **lascia
  // stare** un importo scritto a mano (`edited`). Il totale del viaggio somma
  // le spese, quindi segue da se' -- e questa prova e' il motivo per cui
  // «segue da se'» resta vero.
  const r = rottaDelVia;
  assert.match(r, /costiTappa\(/, 'il pedaggio della tappa non si rifa’ dopo il ridisegno');
  const toll = fra(rotta, 'export async function syncTollExpense', 1200);
  assert.match(toll, /!\(km > 0\)/, 'zero km di autostrada non azzerano piu’ la stima');
  assert.match(toll, /ex && !ex\.edited/, 'un importo scritto a mano verrebbe cancellato');
});

// ---------------------------------------------------------------------------
// La quarta via che ridisegna, e la guardia che la mancava
// ---------------------------------------------------------------------------
//
// Trovata il 22/11/2026 dalla revisione. Il ramo della strada scelta nel
// riquadro di modifica guardava **solo i luoghi dichiarati**: con una
// dichiarazione e nessun luogo, applicava la strada calcolata fra i due soli
// capi, che della dichiarazione non sa niente. La prova che doveva accorgersi
// di una quarta via contava le chiamate ai percorsi -- e questo ramo non ne
// chiama nessuna, assegna una geometria calcolata altrove. Era cieca proprio
// dove serviva.
test('la strada scelta a mano non scavalca quel che la tappa ha dichiarato', () => {
  const r = rotta.slice(rotta.indexOf('} else if (scelto)'), rotta.indexOf('} else if (scelto)') + 1800);
  assert.match(r, /laTappaHaDetto\(cur\)/,
    'il ramo della strada scelta guarda solo i luoghi, non la dichiarazione');
});

test('il ridisegno si decide con la regola provata, non con una condizione scritta qui', () => {
  assert.match(rottaDelVia, /daRidisegnare\(/,
    'la condizione del ridisegno vive nella rotta, dove nessuna prova la esegue');
});
