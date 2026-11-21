// Il campo dei punti, e quel che la pagina dice di loro.
//
// Disegno: docs/superpowers/specs/2026-11-21-strada-ricostruita-design.md
//
// Nel riquadro di modifica c'e' gia' un campo «Soste lungo la strada e note»,
// e i suoi esempi sono proprio dei posti attraversati -- «pranzo a Ferrara,
// rifornimento in A1, deviazione per il borgo». Due campi vicini che chiedono
// «per dove sei passato» si confondono, e scrivere nel posto sbagliato fa
// credere che la correzione non funzioni.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const blocco = (dentro, quanti = 3000) => {
  const i = app.indexOf(dentro);
  assert.ok(i > 0, `non si trova piu: ${dentro}`);
  return app.slice(Math.max(0, i - 1500), i + quanti);
};

test('il campo dei punti c’e’, accanto a quello delle note', () => {
  const modifica = blocco('Soste lungo la strada e note');
  assert.match(modifica, /passat/i, 'manca il campo per dire per dove si e’ passati');
});

test('le due etichette dicono quale dei due disegna', () => {
  // E' la differenza che conta: uno cambia la riga sulla mappa, l'altro no.
  // Si cercano **tutte e due** le diciture, non la parola «disegna» da sola:
  // quella compariva gia' li' intorno, e la prova passava senza provare
  // niente.
  const modifica = blocco('Soste lungo la strada e note');
  assert.match(modifica, /\(cambia la riga sulla mappa\)/,
    'il campo dei punti non dice che disegna');
  assert.match(modifica, /\(non cambia la riga sulla mappa\)/,
    'il campo delle note non dice che NON disegna');
});

test('i punti dichiarati si segnano sulla mappa', () => {
  // Sono l'unica parte di quella riga che viene da chi c'era: vederli dice
  // anche se sono finiti dove ci si aspettava.
  assert.match(app, /\.via\b/, 'la mappa non guarda i punti dichiarati');
});

test('la frase cambia quando i punti ci sono', () => {
  // Attenzione: «Passando per» esiste gia' nel programma, nel riquadro che
  // **pianifica** un viaggio nuovo -- tappe intermedie che diventano tappe
  // vere. Qui si registra una strada gia' fatta, ed e' un'altra cosa. La
  // prova cercava la parola e pescava quello: adesso cerca la frase nella
  // riga della tappa, dove deve stare.
  const riga = blocco('strada da ridisegnare').replace(/title="[^"]*"/g, '');
  assert.match(riga, /passando per/i,
    'la riga della tappa non dice che la strada passa per i punti dichiarati');
  assert.match(riga, /come hai detto tu/i,
    'non si capisce che quella parte viene da chi c’era');
});

test('la riga resta a punti anche coi punti dichiarati', () => {
  // La tentazione di promuoverla a linea piena quando il proprietario ha
  // parlato e' il modo di ricominciare a chiamare traccia una deduzione: le
  // strade fra Vidor e Pieve di Soligo le scegle ancora il navigatore.
  const usi = [...app.matchAll(/TRATTO_RICOSTRUITO/g)];
  for (const m of usi) {
    const prima = app.slice(Math.max(0, m.index - 200), m.index);
    if (prima.includes('const ')) continue;
    assert.doesNotMatch(prima, /!\s*\w*\.?via|via\?\.length|senzaVia/,
      'il tratto a punti si spegne quando ci sono i punti dichiarati');
  }
});

test('la pagina dice che un ridisegno rifa’ i chilometri di autostrada', () => {
  // Buco noto e dichiarato: non c'e' modo di sapere se quel numero l'ha
  // scritto il proprietario a mano, e il ridisegno lo sovrascrive gia' da
  // prima. Dirlo costa una riga; una colonna nuova costa un altro lavoro.
  const campo = blocco('Km in autostrada');
  assert.match(campo, /ridisegn/i,
    'chi scrive i km di autostrada a mano non sa che un ridisegno li rifa’');
});
