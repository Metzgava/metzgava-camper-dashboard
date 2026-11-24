// La tacca di sicurezza in alto non si perde passando al tablet.
//
// Sull'iPad l'app aggiunta alla schermata Home gira a tutto schermo con la
// barra di stato **sopra** la pagina (`apple-mobile-web-app-status-bar-style:
// black-translucent` in index.html). Quella striscia in cima non e' nostra:
// iOS ci disegna ora e batteria, e i tocchi li prende lei. Chi ci finisce
// sotto e' opaco da guardare e morto al tocco.
//
// Per questo ogni cosa incollata al bordo di sopra deve scostarsi di
// `env(safe-area-inset-top)`. Le regole di base lo fanno. Il 21/11/2026 il
// blocco del tablet le scavalcava con un padding fisso, e si riportava
// testata e barra laterale sotto la barra di stato: la prima voce del menu --
// «Adesso» -- ci finiva dentro per un terzo.
//
// Questa prova non guarda un pixel: guarda che la tacca sia **nominata** dove
// serve. E' il genere di guasto che nessuna prova di logica vede e che sul
// browser del Mac non esiste, perche' li' la tacca vale zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/stile.css', import.meta.url), 'utf8');

// Il blocco del tablet: da `@media (min-width: 740px)` alla sua graffa di
// chiusura, contando le graffe.
function bloccoTablet() {
  const i = css.indexOf('@media (min-width: 740px)');
  assert.notEqual(i, -1, 'il blocco del tablet non c’e’ piu’: questa prova va rifatta');
  let dentro = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) {
    if (css[k] === '{') dentro++;
    else if (css[k] === '}' && --dentro === 0) return css.slice(j + 1, k);
  }
  throw new Error('graffe sbilanciate in stile.css');
}

// Le dichiarazioni di `prop` dentro il selettore `sel` di quel blocco.
function dichiarazioni(blocco, sel, prop) {
  const fuori = [];
  const re = new RegExp(`(^|[},])\\s*${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(blocco))) {
    for (const d of m[2].split(';')) {
      const [nome, valore] = d.split(':');
      if (nome && nome.trim() === prop) fuori.push(valore.trim());
    }
  }
  return fuori;
}

// `env()` diretto oppure la variabile che lo contiene: l'una vale l'altra, e
// la variabile ha il pregio di potersi mettere alla prova.
const tieneLaTacca = v => /safe-area-inset-top|--?sicuro-alto/.test(v);

test('la testata del tablet non si ricaccia sotto la barra di stato', () => {
  const b = bloccoTablet();
  const d = [...dichiarazioni(b, '.testata', 'padding-top'), ...dichiarazioni(b, '.testata', 'padding')];
  assert.ok(d.length, 'il blocco del tablet non tocca piu’ il padding della testata: prova da rivedere');
  for (const v of d) {
    assert.ok(tieneLaTacca(v), `la testata del tablet perde la tacca di sicurezza: padding «${v}»`);
  }
});

test('la barra laterale non parte da sotto la barra di stato', () => {
  // E' la peggiore delle due: la prima voce del menu e' «Adesso», e un tocco
  // nella striscia di stato lo prende iOS, non la pagina.
  const b = bloccoTablet();
  const d = [...dichiarazioni(b, '.barra', 'padding-top'), ...dichiarazioni(b, '.barra', 'padding')];
  assert.ok(d.length, 'il blocco del tablet non tocca piu’ il padding della barra: prova da rivedere');
  for (const v of d) {
    assert.ok(tieneLaTacca(v), `la barra laterale perde la tacca di sicurezza: padding «${v}»`);
  }
});

test('le due tacche nascono da env(), con lo zero di scorta', () => {
  // Il valore vero lo sa solo il telefono. Lo zero di scorta serve ai browser
  // che `env()` non conoscono: senza, ogni `calc()` che la contiene diventa
  // invalida e il margine sparisce del tutto -- cioe' il guasto che si sta
  // riparando, ma dappertutto.
  assert.match(css, /--sicuro-alto:\s*env\(safe-area-inset-top,\s*0px\)/);
  assert.match(css, /--sicuro-basso:\s*env\(safe-area-inset-bottom,\s*0px\)/);
});

test('le regole di base, quelle del telefono, le usano ancora', () => {
  // La testata in cima; e in fondo la barra delle stanze, il corpo e il velo
  // delle finestrelle.
  assert.match(css, /\.testata\s*\{[^}]*var\(--sicuro-alto\)/);
  assert.ok((css.match(/var\(--sicuro-basso\)/g) || []).length >= 4,
    'le tacche di sotto sono meno di prima');
});

// ---------------------------------------------------------------------------
// Il fondo dell'intestazione non svanisce sotto il titolo
// ---------------------------------------------------------------------------
//
// Il 21/11/2026, dopo l'iPad: «fai in modo che anche su iphone la parte alta
// dell'app non sia opaca ma resti ben visibile».
//
// Stessa radice del difetto dell'iPad, altra misura. Il fondo era
// `linear-gradient(180deg, var(--notte) 70%, transparent)`, e quel **70 % e'
// una percentuale di un'altezza che cresce con la tacca**:
//
//   Mac    tacca 0   -> alta  54 px, piena fino a 37,8 -> titolo 10..44
//   iPad   tacca 24  -> alta  86 px, piena fino a 60   -> titolo 38..72
//   iPhone tacca 47  -> alta 101 px, piena fino a 70,7 -> titolo 57..91
//
// Sull'iPhone venti dei trentaquattro pixel del titolo cadono nella parte che
// svanisce, col contenuto della pagina che gli scorre dietro. Piu' grande e' la
// tacca, peggio e'.
//
// La cura e' togliere la percentuale: lo sfumato si misura **dal basso**, dove
// c'e' il padding, e allora e' giusto a qualunque tacca per costruzione.

// **24/11/2026: lo sfumato e' stato tolto del tutto.** Misurarlo dal basso
// aveva tolto il titolo dalla zona che svanisce, ma restava una fascia sotto
// il titolo dove il contenuto si vedeva **attraverso** il bordo, sfocato dal
// velo: ne' sfondo pulito ne' testo leggibile. Il proprietario, guardandola
// una seconda volta: «fai in modo che su iphone e ipad si veda bene e non con
// la parte alta opaca».
//
// Adesso la testata e' **piena**, con una riga netta sotto: il contenuto
// sparisce a un bordo invece di sfumare dentro il titolo. La lezione di
// allora resta pero' appesa qui: se un giorno torna una sfumatura, non deve
// poterla misurare in percentuale di un'altezza che cresce con la tacca.

test('la testata e’ piena, e il contenuto le sparisce sotto a un bordo netto', () => {
  const blocco = css.slice(css.indexOf('.testata {'), css.indexOf('}', css.indexOf('.testata {')));
  assert.doesNotMatch(blocco, /linear-gradient/,
    'e’ tornato uno sfumato: il contenuto si rivede attraverso il bordo');
  assert.match(blocco, /border-bottom/,
    'senza una riga sotto, la testata e il contenuto si confondono');
  assert.doesNotMatch(blocco, /backdrop-filter/,
    'il velo sfoca quel che scorre sotto, ed e’ proprio la fascia lattiginosa');
});

test('se un giorno torna uno sfumato, si misura dal basso e non in percentuale', () => {
  const blocco = css.slice(css.indexOf('.testata {'), css.indexOf('}', css.indexOf('.testata {')));
  const sfumato = blocco.match(/linear-gradient\([^)]*?(?:\([^)]*\)[^)]*?)*\)/);
  if (!sfumato) return;   // oggi non c'e', ed e' giusto cosi'
  // Una percentuale **dentro un `calc()`** va benissimo -- `calc(100% - 10px)`
  // e' proprio la cura -- mentre una percentuale nuda come stop e' il difetto.
  // Si tolgono i `calc()` e poi si guarda se ne resta una.
  const senzaCalc = sfumato[0].replace(/calc\([^)]*\)/g, 'X');
  assert.doesNotMatch(senzaCalc, /\d+%/,
    'una percentuale dell’altezza scivola sotto il titolo quando la tacca cresce');
  assert.match(sfumato[0], /100%\s*-/,
    'lo sfumato deve essere un pezzo fisso misurato dal basso');
});

test('ogni velo sfocato porta anche la versione con il prefisso di WebKit', () => {
  // Senza `-webkit-backdrop-filter` il velo su iOS non si applica affatto, e
  // quel che resta e' il fondo nudo. Safari recenti lo reggono senza prefisso;
  // quelli di qualche anno fa no, e sono proprio i telefoni che restano in
  // tasca piu' a lungo.
  const quanti = s => (css.match(new RegExp(s.replace(/[-]/g, '\\-'), 'g')) || []).length;
  assert.equal(quanti('-webkit-backdrop-filter'), quanti('backdrop-filter')
    - quanti('-webkit-backdrop-filter'),
    'i due elenchi non combaciano: qualche velo non ha il prefisso');
});
