// I chilometri veri di una tappa CarLock non si sovrascrivono.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// Difetto che c'era gia', trovato il 21/11/2026 mentre se ne cercava un altro.
// Su una tappa importata dal tracker bastano **due tocchi**: «Modifica» chiede
// da se' le strade possibili e le mostra, e se se ne tocca una il salvataggio
// scrive i chilometri e la durata **della variante** al posto di quelli di
// CarLock. Da li' scendono il gasolio, i totali del viaggio e il costo al km.
//
// CarLock misura i chilometri e il tempo; la strada no -- manda solo partenza
// e arrivo, e la riga sulla mappa e' sempre una ricostruzione. Quindi scegliere
// una strada deve cambiare **il disegno e niente altro**.
//
// Il contrario vale sulle tappe scritte a mano: li' i chilometri **sono**
// quelli del navigatore, non c'e' nessuna misura da proteggere, e cambiarli
// insieme alla strada e' il comportamento giusto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { numeriDellaTappa } from '../src/lib/tappe.js';

const strada = { distance_km: 203.1, duration_min: 118,
                 geometry: [[46, 11], [46.5, 12], [46, 13]], pedaggio_km: 54 };

test('su una tappa CarLock la strada scelta cambia il disegno, non la misura', () => {
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142,
                  geometry: [[46, 11], [46, 13]] };
  const n = numeriDellaTappa(tappa, strada);
  assert.equal(n.distance_km, 187.4);
  assert.equal(n.duration_min, 142);
  // Il disegno invece cambia: scegliere la strada giusta e' proprio quel che
  // serve, ed e' il motivo per cui il selettore resta.
  assert.deepEqual(n.geometry, strada.geometry);
});

test('su una tappa scritta a mano i numeri della strada comandano, come prima', () => {
  const tappa = { source: 'manual', distance_km: 100, duration_min: 90,
                  geometry: [[46, 11], [46, 13]] };
  const n = numeriDellaTappa(tappa, strada);
  assert.equal(n.distance_km, 203.1);
  assert.equal(n.duration_min, 118);
});

test('i chilometri di autostrada seguono la strada anche su una tappa CarLock', () => {
  // La distinzione che conta: CarLock misura i chilometri e il tempo, il
  // pedaggio no. L'anti obiettivo protegge quel che e' misurato, non tutto
  // quel che e' scritto.
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142, pedaggio_km: 0 };
  assert.equal(numeriDellaTappa(tappa, strada).pedaggio_km, 54);
});

test('una strada senza pedaggio dichiarato lascia il campo vuoto, non zero', () => {
  // `—` vuol dire «non so», `0` vuol dire «uno zero che conosco»: un percorso
  // che non dice niente sui pedaggi non sta dicendo che non ce ne sono.
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142 };
  assert.equal(numeriDellaTappa(tappa, { ...strada, pedaggio_km: undefined }).pedaggio_km, null);
});

test('senza una strada nuova la tappa resta quella che era', () => {
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142,
                  geometry: [[46, 11], [46, 13]], pedaggio_km: 12 };
  const n = numeriDellaTappa(tappa, null);
  assert.equal(n.distance_km, 187.4);
  assert.deepEqual(n.geometry, tappa.geometry);
  assert.equal(n.pedaggio_km, 12);
});

// ---------------------------------------------------------------------------
// Non basta proteggere il ramo della strada scelta
// ---------------------------------------------------------------------------
//
// Trovato dalla revisione del 21/11/2026: la protezione copriva **un ramo
// solo** del salvataggio. Gli altri due -- quello del mezzo non in camper e
// quello del cambio di mezzo -- scrivevano i numeri calcolati senza passare di
// qui, e bastavano due tocchi come prima:
//
//   1. sulla tendina «Come» si mette «Traghetto» e si salva: i chilometri
//      diventano la distanza in linea d'aria, 143 invece di 187;
//   2. ci si accorge e si rimette «Camper»: si riscrivono quelli della strada.
//
// E `source` resta 'carlock', quindi la riga continua a mostrare «Chilometri e
// orari veri dal tracker» sopra un numero che e' una linea d'aria. La
// direzione rassicurante dell'errore, cioe' quella che questo lavoro chiude.
//
// Il ruling diceva «solo il ramo della strada scelta, perche' se i capi si
// spostano i km del tracker descrivono un'altra tappa». Il **principio** era
// giusto, l'applicazione troppo stretta: cambiare mezzo non sposta nessun capo.

test('cambiare mezzo non sposta i capi: i chilometri del tracker restano', () => {
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142 };
  const inLineaDAria = { distance_km: 143, duration_min: 90, geometry: [[46, 11], [46, 13]] };
  const n = numeriDellaTappa(tappa, inLineaDAria, { capiSpostati: false });
  assert.equal(n.distance_km, 187.4);
  assert.equal(n.duration_min, 142);
});

test('spostati i capi, i numeri si rifanno: quelli di prima erano di un’altra tappa', () => {
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142 };
  const altrove = { distance_km: 64, duration_min: 55, geometry: [[45, 10], [45, 11]] };
  const n = numeriDellaTappa(tappa, altrove, { capiSpostati: true });
  assert.equal(n.distance_km, 64);
  assert.equal(n.duration_min, 55);
});

test('senza dire niente sui capi si protegge, che e’ il verso prudente', () => {
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142 };
  const n = numeriDellaTappa(tappa, { distance_km: 9, duration_min: 9, geometry: [] });
  assert.equal(n.distance_km, 187.4);
});

test('un numero battuto a mano comanda: e’ l’unico modo di rimediare a un import sbagliato', () => {
  // La protezione difende dagli effetti collaterali, non dalle correzioni
  // volute. Togliere anche questa gli leverebbe l'unico modo di sistemare una
  // tappa importata male -- e lui lo fa vedendolo, non per distrazione.
  const tappa = { source: 'carlock', distance_km: 187.4, duration_min: 142 };
  const n = numeriDellaTappa(tappa, { distance_km: 201, duration_min: 142, geometry: [] },
    { scrittoAMano: true });
  assert.equal(n.distance_km, 201);
});
