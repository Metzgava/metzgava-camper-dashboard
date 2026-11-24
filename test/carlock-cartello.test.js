// Il cartello che ritorna mentre il viaggio accade, e il riquadro che fa
// vedere cosa toglierebbe.
//
// Disegno: docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md
//
// Le guardie si **estraggono dal sorgente e si eseguono** coi valori: cercare
// una parola dentro una finestra di caratteri passa anche su una condizione
// rovesciata, e in questo progetto ci siamo già cascati (il 24/11/2026, sul
// puntinato delle strade vere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

const fra = (ancora, quanti) => {
  const i = app.indexOf(ancora);
  assert.ok(i > 0, `non si trova piu’: ${ancora}`);
  return app.slice(i, i + quanti);
};

// Il gestore del rubinetto, delimitato dai suoi due capi veri: dal tasto al
// gestore del tasto dopo. Una finestra contata a caratteri cresce coi
// commenti e un giorno taglia via quel che la prova cercava -- ed e' gia'
// successo in questa sessione, su quattro prove in una volta.
const riquadro = (() => {
  const i = app.indexOf("$('#carlock-rubinetto')?.addEventListener");
  const j = app.indexOf("$('#tracciati')?.addEventListener", i);
  assert.ok(i > 0 && j > i, 'il riquadro del rubinetto non si trova piu’');
  return app.slice(i, j);
})();

// La guardia com'e' scritta nella pagina, costruita in una funzione e
// chiamata coi valori. Le funzioni su cui si appoggia si forniscono da fuori,
// cosi' si prova una regola per volta.
const guardia = nome => {
  const apre = `const ${nome} = `;
  const i = app.indexOf(apre);
  assert.ok(i > 0, `la guardia ${nome} non si trova piu’ nella pagina`);
  // Il confine e' la chiusura della funzione a inizio riga, non il primo
  // punto e virgola: una guardia su piu' righe ne contiene dei suoi, e
  // fermarsi al primo taglia il corpo a meta'.
  const prossima = app.indexOf('\nconst ', i + apre.length);
  const chiude = app.indexOf('\n};', i);
  const corpo = chiude > i && (prossima < 0 || chiude < prossima)
    ? app.slice(i + apre.length, chiude + 2)
    : app.slice(i + apre.length, app.indexOf(';\n', i));
  return new Function(`return (${corpo});`)();
};

const ora = s => Date.parse(s);
const viaggio = (da, a, segno = null) => ({ start_date: da, end_date: a, carlock_chiesto_fino_a: segno });

test('il cartello non compare su un viaggio tutto nel futuro', () => {
  const vale = guardia('cartelloCarlock');
  assert.equal(!!vale(viaggio('2027-07-04', '2027-07-15'), [], ora('2026-11-24T12:00:00+01:00'), 12), false);
});

test('il cartello compare su un viaggio in corso, e ritorna il giorno dopo', () => {
  const vale = guardia('cartelloCarlock');
  const v = viaggio('2026-11-22', '2026-12-01');
  assert.equal(!!vale(v, [], ora('2026-11-24T12:00:00+01:00'), 12), true);
  assert.equal(!!vale({ ...v, carlock_chiesto_fino_a: '2026-11-24T12:00:00+01:00' }, [],
    ora('2026-11-24T13:00:00+01:00'), 12), false,
    'si e’ appena guardato: non si ripropone subito');
  assert.equal(!!vale({ ...v, carlock_chiesto_fino_a: '2026-11-24T12:00:00+01:00' }, [],
    ora('2026-11-25T09:00:00+01:00'), 12), true,
    'il giorno dopo c’e’ roba nuova e il cartello deve tornare');
});

test('su un viaggio oltre lo storico il cartello non compare', () => {
  const vale = guardia('cartelloCarlock');
  assert.equal(!!vale(viaggio('2024-06-01', '2024-06-10'), [], ora('2026-11-24T12:00:00+01:00'), 12), false);
});

test('col piano piu’ piccolo il cartello si spegne prima', () => {
  // Prova che il numero dei mesi serve davvero: se la guardia lo ignorasse,
  // questi due sarebbero uguali.
  const vale = guardia('cartelloCarlock');
  const v = viaggio('2026-06-01', '2026-06-10'), adesso = ora('2026-11-24T12:00:00+01:00');
  assert.equal(!!vale(v, [], adesso, 12), true);
  assert.equal(!!vale(v, [], adesso, 3), false);
});

test('il cartello non promette un numero che non conosce', () => {
  // Saperlo prima vorrebbe dire chiamare CarLock a ogni apertura di un
  // viaggio, cioe' la strada che il proprietario ha scartato. Il cartello
  // dice che PUO' guardare, non cosa ha trovato.
  const c = fra('cartelloCarlock(trip', 1200);
  assert.doesNotMatch(c, /\$\{[^}]*tragitti[^}]*\.length/,
    'il cartello conta tragitti che non ha ancora chiesto');
});

test('il riquadro fa vedere quali previste toglierebbe, con la spunta messa', () => {
  const r = riquadro;
  assert.match(r, /previste/, 'non si vede cosa sparirebbe');
  assert.match(r, /checked/, 'la spunta non e’ messa: il tocco non sarebbe uno');
});

test('al server vanno solo gli uuid e le previste da togliere', () => {
  const r = riquadro;
  assert.match(r, /uuid/);
  assert.match(r, /togli/);
  assert.doesNotMatch(r, /km:\s*[a-z]/i, 'la pagina rimanda indietro dei chilometri');
});

test('il resoconto arriva intero, ogni conto col suo perche’', () => {
  const r = riquadro;
  for (const campo of ['create', 'gia_presenti', 'senza_punti', 'traccia_parziale',
                       'non_create', 'togliute'])
    assert.match(r, new RegExp(campo), `il resoconto non legge ${campo}`);
});

test('se CarLock non risponde si dice, e si indica il file', () => {
  const r = riquadro;
  assert.match(r, /file/i, 'un guasto di CarLock non indica la strada che funziona ancora');
});

test('un tragitto che e’ gia’ una tappa arriva spento, e si dice perche’', () => {
  const r = riquadro;
  assert.match(r, /gia_presente/, 'un doppione si offre come se fosse nuovo');
});

test('i tragitti corti si dicono, invece di sparire', () => {
  // Il giro al supermercato non diventa una tappa -- ma «ne ho trovati 7 e te
  // ne mostro 3» senza spiegare il salto fa sembrare che manchi qualcosa.
  const r = riquadro;
  assert.match(r, /corti/, 'non si dice quanti tragitti sono stati scartati perche’ troppo corti');
});

test('senza il rubinetto configurato il cartello non compare', () => {
  // Su Railway le credenziali vanno messe nelle variabili del servizio, e
  // finche' non ci sono il rubinetto e' spento. Un cartello che invita a
  // guardare e poi risponde «non configurato» e' peggio di nessun cartello:
  // la pagina non puo' saperlo da se', quindi glielo dice il server.
  const vale = guardia('cartelloCarlock');
  const v = viaggio('2026-11-22', '2026-12-01');
  assert.equal(!!vale(v, [], ora('2026-11-24T12:00:00+01:00'), 0), false,
    'zero mesi di storico vuol dire rubinetto spento: il cartello compare comunque');
});

test('su un viaggio oltre lo storico si dice perche’, invece di tacere', () => {
  // La revisione finale: il riquadro aveva un ramo per «oltre lo storico» che
  // **non poteva mai aprirsi**, perche' il cartello non compare proprio in
  // quel caso -- quindi nessuno tocca il tasto che porterebbe quel messaggio.
  // Il disegno e' esplicito: «il cartello lo DICE invece di non comparire,
  // perche' "non c'e' piu'" e' un'informazione».
  const vale = guardia('cartelloCarlock');
  const vecchio = viaggio('2024-06-01', '2024-06-10');
  assert.equal(!!vale(vecchio, [], ora('2026-11-24T12:00:00+01:00'), 12), false,
    'il cartello che invita a guardare compare su un viaggio che non si puo’ chiedere');
  // Ma una riga che lo spiega si', e la decide la sua guardia.
  const dice = guardia('carlockTroppoVecchio');
  assert.equal(!!dice(vecchio, [], ora('2026-11-24T12:00:00+01:00'), 12), true,
    'un viaggio troppo vecchio sparisce in silenzio');
  assert.equal(!!dice(viaggio('2026-11-22', '2026-12-01'), [], ora('2026-11-24T12:00:00+01:00'), 12), false,
    'si dice «troppo vecchio» su un viaggio in corso');
  assert.equal(!!dice(viaggio('2027-07-04', '2027-07-15'), [], ora('2026-11-24T12:00:00+01:00'), 12), false,
    'un viaggio futuro non e’ vecchio: e’ solo non ancora accaduto');
  assert.equal(!!dice(vecchio, [], ora('2026-11-24T12:00:00+01:00'), 0), false,
    'col rubinetto spento si da’ la colpa all’eta’ del viaggio');
});
