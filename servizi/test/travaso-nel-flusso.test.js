// La scomposizione del travaso attaccata al ramo della 220.
//
// Disegno: docs/superpowers/specs/2026-11-23-travaso-scomposto-design.md
//
// **Solo durante un travaso riconosciuto.** Scelta del proprietario del
// 23/11/2026: fuori di li' non si sa cosa alimenta la 220 -- potrebbe essere
// un bollitore -- e la scomposizione racconterebbe una catena che non esiste.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ramiDellaCarica } from '../src/lib/flusso.js';

const fonti = { valore: 199, sole_w: 0, motore_w: 0, rete_w: 199 };
const conTravaso = { uscita_ac_w: 447, travaso: { watt: 447, minuti: 12, letture: 3 } };
const ramo220 = f => (f.rami || []).find(r => r.id === 'rete');

test('col travaso in corso il ramo della 220 porta la scomposizione', () => {
  const f = ramiDellaCarica(fonti, { letture: true, bluetti: conTravaso });
  const s = ramo220(f).scomposizione;
  assert.ok(s, 'il ramo non dice di cosa e’ fatto il buco');
  assert.equal(Math.round(s.dispersi), 56);
  assert.equal(Math.round(s.consumi), 192);
  assert.equal(Math.round(s.nelle_ective), 199);
});

test('senza travaso riconosciuto non si scompone niente', () => {
  // La 220 accesa potrebbe alimentare il bollitore: quei watt non passano dal
  // caricatore, e dire «56 dispersi» sarebbe inventato.
  const f = ramiDellaCarica(fonti, { letture: true, bluetti: { uscita_ac_w: 447 } });
  assert.equal(ramo220(f).scomposizione, undefined);
});

test('travaso senza i watt alla presa: niente da scomporre', () => {
  const f = ramiDellaCarica(fonti, { letture: true, bluetti: { travaso: { minuti: 12 } } });
  assert.equal(ramo220(f).scomposizione, undefined);
});

test('la figura resta quella di prima: la scomposizione non tocca il ramo', () => {
  // Spessore e velocita' si calcolano sui watt che entrano, e quelli non
  // cambiano: la scomposizione racconta, non ridisegna.
  const senza = ramo220(ramiDellaCarica(fonti, { letture: true, bluetti: { uscita_ac_w: 447 } }));
  const con = ramo220(ramiDellaCarica(fonti, { letture: true, bluetti: conTravaso }));
  assert.equal(con.watt, senza.watt);
  assert.equal(con.spessore, senza.spessore);
  assert.equal(con.attivo, senza.attivo);
});
