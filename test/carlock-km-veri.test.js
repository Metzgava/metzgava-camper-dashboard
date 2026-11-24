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

// ---------------------------------------------------------------------------
// Il bollino del tracciato vero segue la riga
// ---------------------------------------------------------------------------
//
// Revisione del 24/11/2026. `tracciato_vero` dice «questa riga e' la traccia
// registrata»: appena la riga viene sostituita da una strada calcolata, quel
// bollino parla di una riga che non c'e' piu'.
//
// Sta qui, insieme alla protezione dei chilometri, perche' e' la stessa
// distinzione: si protegge quel che e' misurato, e si butta quel che
// descriveva una cosa sostituita. E sta qui anche perche' il salvataggio
// riscrive `geometry` **sempre** -- anche quando nessun ramo ha calcolato
// niente, rimettendoci quella di prima. Spegnere il bollino senza guardare
// avrebbe cancellato la traccia vera a ogni correzione di una nota.
// **Il salvataggio chiama sempre con un oggetto**, anche quando nessun ramo
// ha calcolato niente: li' `strada` e' la tappa stessa rimessa a posto. Per
// questo la domanda non e' «c'e' una strada?» ma «la riga e' stata rifatta?»,
// e deve arrivare da chi lo sa: la rotta.
//
// La prima versione di queste prove chiamava con `null` per dire «nessuna
// strada nuova» -- una forma che la rotta non usa mai -- e passava mentre il
// programma vero spegneva la traccia a ogni correzione di una nota. L'ha fatto
// vedere la pagina, non la prova: il 24/11/2026, salvando una tappa, la
// traccia appena caricata se ne andava. Adesso le prove chiamano come chiama
// la rotta.
const tappaConTraccia = () => ({
  source: 'carlock', distance_km: 187, duration_min: 150, geometry: [[1, 2]],
  tracciato_vero: true, scarto_ricostruzione_km: 15.6,
});
// Com'e' fatta la chiamata quando nessun ramo ha calcolato niente: la riga di
// prima, rimessa dentro.
const comeLaRotta = (t, { rigaRifatta = false, strada = null } = {}) =>
  numeriDellaTappa(t, strada || { distance_km: t.distance_km, duration_min: t.duration_min, geometry: t.geometry },
    { rigaRifatta });

test('senza una strada nuova il bollino della traccia vera resta', () => {
  const r = comeLaRotta(tappaConTraccia());
  assert.equal(r.tracciato_vero, true, 'correggere una nota spegneva la traccia vera');
  assert.equal(r.scarto_ricostruzione_km, 15.6);
});

test('con una strada nuova il bollino si spegne e lo scarto si butta', () => {
  const r = comeLaRotta(tappaConTraccia(), { rigaRifatta: true,
    strada: { distance_km: 201, duration_min: 170, geometry: [[3, 4], [5, 6]] } });
  assert.equal(r.tracciato_vero, false,
    'una strada calcolata si portava appresso il bollino «vera dal tracker»');
  assert.equal(r.scarto_ricostruzione_km, null,
    'lo scarto era misurato contro una riga che e’ stata sostituita');
  assert.equal(r.distance_km, 187, 'e i chilometri del tracker restano protetti');
});

test('nel dubbio il bollino si spegne: il verso prudente e’ quello che non afferma', () => {
  // Chiamando senza dire niente, la riga potrebbe essere stata rifatta. Fra
  // «dico che e' misurata» e «non lo dico», il verso giusto e' il secondo.
  const r = numeriDellaTappa(tappaConTraccia(),
    { distance_km: 201, duration_min: 170, geometry: [[3, 4]] });
  assert.equal(r.tracciato_vero, false);
});

test('su una tappa che non ha mai avuto la traccia vera non si inventa un bollino', () => {
  const r = comeLaRotta({ distance_km: 100, geometry: [[1, 2]] });
  assert.equal(r.tracciato_vero, false);
  assert.equal(r.scarto_ricostruzione_km, null);
});
