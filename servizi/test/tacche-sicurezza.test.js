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
