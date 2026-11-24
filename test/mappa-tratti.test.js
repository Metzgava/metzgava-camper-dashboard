// Sulla mappa un tratto vuol dire una cosa sola.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// Il proprietario, su un viaggio importato: «perche' il tracciato caricato da
// carlock da novaledo a udine passa per bassano invece non e' vero perche
// siamo passati per vidor e pieve di soligo?».
//
// Non era un errore di misura: CarLock manda solo partenza e arrivo, e la riga
// sulla mappa e' **ricostruita**. Ma era disegnata piena, come tutte le altre,
// e una riga piena su una mappa si legge come una registrazione.
//
// Il tratteggio pero' e' gia' occupato, e non da una cosa sola: le tracce degli
// atleti ne usano quattro, il traghetto e l'aereo uno, le strade alternative
// fuori mappa un altro. Sei. Un settimo significato che riusasse un tratto
// gia' preso non sarebbe una spiegazione, sarebbe un indovinello.
//
// Il linguaggio per «dedotto» pero' il progetto ce l'ha, e viene dall'altra
// app: nella figura delle batterie «il tratteggio del ramo dedotto e' fatto di
// punti; quello degli altri di linee».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const nostro = app.match(/const TRATTO_RICOSTRUITO = '([^']+)'/);

test('il tratto della strada ricostruita esiste e ha un nome suo', () => {
  assert.ok(nostro, 'manca TRATTO_RICOSTRUITO');
});

test('non e’ nessuno dei tratti gia’ presi', () => {
  // Si guardano tutti: quelli scritti come `dashArray` e quelli nell'elenco
  // delle tracce degli atleti. Contro l'elenco intero e non contro tre nomi
  // scritti a mano, cosi' la regola tiene anche per il prossimo significato
  // che qualcuno vorra' aggiungere.
  assert.ok(nostro);
  const daDashArray = [...app.matchAll(/dashArray: '([^']+)'/g)].map(m => m[1]);
  const daTratti = [...app.matchAll(/\['([\d ]+)', '(?:dashed|dotted)'\]/g)].map(m => m[1]);
  const altri = [...daDashArray, ...daTratti].filter(t => t !== nostro[1]);
  assert.ok(altri.length >= 5, `trovati solo ${altri.length} tratti da confrontare`);
  for (const t of altri) {
    assert.notEqual(nostro[1], t, `il tratto ${nostro[1]} e’ gia’ usato per altro`);
  }
});

test('tutte e due le mappe lo usano: un significato non cambia da una mappa all’altra', () => {
  assert.ok((app.match(/TRATTO_RICOSTRUITO/g) || []).length >= 3,
    'il tratto non e’ usato in tutte e due le mappe che disegnano le tappe');
});

test('si applica solo dove c’e’ una misura che la riga contraddice', () => {
  // Su una tappa scritta a mano i chilometri **sono** quelli del navigatore:
  // riga e numero dicono la stessa cosa, non c'e' niente da tradire. Su una
  // tappa in preparazione la riga e' una scelta, non una deduzione.
  // La guardia e' una funzione con un nome, `stradaDedotta`, e non un
  // confronto ripetuto: cosi' la regola sta scritta in un posto solo. La prova
  // chiede le due cose -- che la guardia dica quel che deve, e che ogni uso
  // del tratto le stia dietro.
  //
  // **24/11/2026:** la guardia si e' spaccata in due. `daCarlock` dice da
  // dove viene la tappa, `stradaDedotta` aggiunge che la strada e' ancora una
  // ricostruzione -- col tracciato vero non lo e' piu', e il puntinato
  // direbbe il falso. La prova segue la divisione invece di pretendere la
  // vecchia riga, ma chiede le stesse due cose di prima.
  assert.match(app, /const daCarlock = l => l\?\.source === 'carlock'/,
    'la guardia non guarda se la tappa viene dal tracker');
  assert.match(app, /const stradaDedotta = l => daCarlock\(l\) && !l\?\.tracciato_vero/,
    'il puntinato resta su una strada che non e\u2019 piu\u2019 una ricostruzione');
  for (const m of app.matchAll(/TRATTO_RICOSTRUITO/g)) {
    if (app.slice(Math.max(0, m.index - 60), m.index).includes('const ')) continue;
    const prima = app.slice(Math.max(0, m.index - 200), m.index);
    assert.match(prima, /stradaDedotta\(/,
      'il tratto a punti si applica senza passare dalla guardia');
  }
});
