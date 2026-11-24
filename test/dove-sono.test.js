// In cima resta scritto in che sezione sei, anche mentre scorri.
//
// Le pagine sono lunghe -- un viaggio con dieci tappe, un elenco di
// allenamenti -- e il titolo della sezione scorre via dopo due dita. A meta'
// pagina non c'e' piu' niente che dica dove sei: sul telefono la barra sta in
// **basso** e mostra le icone, non la sezione aperta; sul computer la colonna
// di sinistra ce l'ha, ma e' fuori dal campo dove stai guardando.
//
// Il nome viene da `nav()`, che e' gia' l'elenco delle sezioni: scriverlo una
// seconda volta vorrebbe dire che un giorno i due elenchi diranno cose
// diverse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const layout = (() => {
  const i = app.indexOf('function layout(');
  assert.ok(i > 0, 'la funzione del telaio non si trova piu’');
  return app.slice(i, i + 1400);
})();

test('il telaio scrive in cima dove sei', () => {
  assert.match(layout, /class="dove"/, 'in cima non c’e’ nessuna fascia con la sezione');
});

test('il nome viene da nav(), non riscritto a mano', () => {
  // Due elenchi delle stesse sezioni un giorno divergono, e la fascia
  // direbbe «Viaggi» mentre il menu dice «I miei viaggi».
  const i = layout.indexOf('class="dove"');
  const intorno = layout.slice(Math.max(0, i - 700), i + 400);
  assert.match(intorno, /nav\(\)/, 'la fascia si inventa i nomi delle sezioni');
});

test('dentro un viaggio si puo’ dire anche dove, non solo la sezione', () => {
  // «Viaggi» da solo, mentre guardi una tappa di «Prova costi», e’ meno utile
  // del nome del viaggio.
  assert.match(app, /function layout\(content,\s*\w+/,
    'il telaio non accetta un titolo da chi lo chiama');
});

test('la fascia resta attaccata in alto mentre si scorre', () => {
  const blocco = css.slice(css.indexOf('.dove'), css.indexOf('}', css.indexOf('.dove')) + 1);
  assert.ok(blocco.length > 10, 'la fascia non ha uno stile');
  assert.match(blocco, /position:\s*sticky/, 'la fascia scorre via come prima');
  assert.match(blocco, /top:\s*0/);
});

test('la fascia e’ piena, non trasparente', () => {
  // La lezione dell'altra app, pagata due volte: una fascia velata lascia
  // vedere il contenuto che le scorre sotto, e il risultato non e' ne' sfondo
  // ne' testo.
  const blocco = css.slice(css.indexOf('.dove'), css.indexOf('}', css.indexOf('.dove')) + 1);
  assert.doesNotMatch(blocco, /backdrop-filter/, 'il velo rifa’ la fascia lattiginosa');
  assert.match(blocco, /background:\s*var\(--/, 'senza un fondo pieno il testo si confonde');
});

test('sulla tacca dell’iPhone non ci va sotto', () => {
  const blocco = css.slice(css.indexOf('.dove'), css.indexOf('}', css.indexOf('.dove')) + 1);
  assert.match(blocco, /safe-area-inset-top/,
    'in cima all’iPhone la fascia finisce sotto l’orologio');
});
