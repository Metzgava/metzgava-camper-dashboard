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

// ---------------------------------------------------------------------------
// La riga della tappa, delimitata dai suoi due capi veri
// ---------------------------------------------------------------------------
//
// Dall'inizio del modello della riga fino a dove ricominciano i costi.
//
// **Non si contano i caratteri.** Il 24/11/2026 quattro prove sono cadute
// tutte insieme per una ragione che non c'entrava niente con quel che
// provavano: erano state aggiunte dentro il blocco delle righe di commento, e
// la finestra contata a mano non arrivava piu' fino alla frase. Una prova che
// cade quando si spiega meglio il codice non sta misurando il codice.
const rigaDellaTappa = (() => {
  const i = app.indexOf('const legRow =');
  const j = app.indexOf('${rigaCosti(l)}', i);
  assert.ok(i > 0 && j > i, 'il modello della riga della tappa non si trova piu\u2019');
  return app.slice(i, j);
})();

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
  const riga = rigaDellaTappa.replace(/title="[^"]*"/g, '');
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

// ---------------------------------------------------------------------------
// La frase dice solo quel che la riga contiene
// ---------------------------------------------------------------------------
//
// Trovati in revisione il 21/11/2026.
//
// §F: i punti si salvano anche quando il ridisegno fallisce -- scelta giusta,
// una riga vecchia e' meglio di nessuna riga -- ma la frase era calcolata sui
// punti *dichiarati*, non su quelli che la riga tocca davvero. Il messaggio
// passava una volta; al ricaricamento la pagina affermava per sempre un
// passaggio che la geometria non conteneva.
//
// §E: i due numeri che spiegano «strada da ridisegnare» stavano solo in un
// `title=`. Sull'iPad si leggeva «strada da ridisegnare» accanto a «passando
// per Vidor, come hai detto tu»: due messaggi che si contraddicono e nessuno
// dei due spiegabile senza mouse. Lo stesso difetto per cui il lavoro e' nato,
// in un angolo diverso della stessa riga.

test('la frase guarda la riga, non quel che e’ stato dichiarato', () => {
  assert.match(app, /const passaDa = /,
    'nessuno controlla se la riga passa davvero dai punti');
  // Finestra larga come nelle due prove qui sotto: fra il cartello e la
  // frase c'e' l'intestazione della riga, che e' una riga di sorgente sola e
  // lunghissima, piu' il racconto che dal 24/11/2026 ha due versi -- strada
  // ricostruita e strada vera.
  const riga = blocco('strada da ridisegnare', 6000);
  assert.match(riga, /puntiSullaRiga\(l\)/,
    'la frase afferma i punti dichiarati invece di quelli che la riga tocca');
  assert.match(riga, /non passa ancora per/i,
    'non si dice quando un punto dichiarato non e’ ancora sulla riga');
});

test('i numeri dell’avviso si leggono senza mouse', () => {
  // Finestra larga: fra il cartello e la frase c'e' tutta l'intestazione della
  // riga, che e' una riga di sorgente sola e lunghissima.
  const riga = blocco('strada da ridisegnare', 6000).replace(/title="[^"]*"/g, '');
  assert.match(riga, /lunga \$\{num\(lungaQuanto/,
    'la lunghezza della riga sta ancora solo nel suggerimento');
  assert.match(riga, /contro \$\{num\(l\.distance_km/,
    'i chilometri veri stanno ancora solo nel suggerimento');
});

test('col punto dichiarato il consiglio cambia: «Ridisegna» non serve piu’', () => {
  // Prima «Ridisegna» ignorava i punti, perche' non c'erano. Adesso li
  // rispetta: su punti sbagliati o nell'ordine sbagliato ridarebbe la stessa
  // riga sospetta, e chi preme il tasto che la pagina gli indica non vedrebbe
  // cambiare niente, senza sapere perche'.
  const riga = blocco('strada da ridisegnare', 6000);
  assert.match(riga, /controlla l.{0,8}ordine o i nomi/,
    'il consiglio non cambia quando i punti ci sono');
});

test('ogni aiuto che il riquadro di «Ridisegna» chiama esiste davvero', () => {
  // Scritto dopo averlo sbagliato due volte di fila: `numeroP4n` e
  // `lungaQuantoRiga` erano **chiamati e mai definiti**, e le prove che
  // leggono il sorgente non potevano accorgersene -- la pagina sarebbe
  // morta al primo tocco. Qui si cercano le definizioni.
  for (const aiuto of ['lungaQuantoRiga', 'numeroP4n', 'ridisegnaTappa',
                       'stradaDedotta', 'passaDa', 'puntiSullaRiga']) {
    assert.match(app, new RegExp(`(const|function) ${aiuto}\\b`),
      `${aiuto} viene chiamato ma non e’ definito da nessuna parte`);
  }
});
