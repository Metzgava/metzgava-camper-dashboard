// Ogni sorgente deve almeno compilare.
//
// Trovato il 22/11/2026, aggiungendo una colonna: i commenti SQL nuovi dentro
// `migrate()` contenevano degli **apici inversi**, e quel pezzo di SQL vive
// dentro una stringa a template. Uno di quegli apici l'ha chiusa, e il file e'
// diventato sintatticamente sbagliato:
//
//   src/lib/db.js:113  SyntaxError: missing ) after argument list
//
// Il server non partiva piu'. Centocinquantasei prove erano verdi, perche'
// nessuna importa `db.js`: si parla col database solo dal programma vero. Se
// non fosse stato per la prova nel browser, questo sarebbe finito in
// produzione, dove launchd l'avrebbe riacceso in continuazione senza che
// partisse mai.
//
// Una prova che non guarda il comportamento, solo che i file si leggano. Costa
// un secondo e copre tutti i file che nessuna prova importa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const radice = new URL('../', import.meta.url).pathname;
const jsSotto = (cartella, trovati = []) => {
  for (const nome of readdirSync(radice + cartella)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const dentro = `${cartella}/${nome}`;
    if (statSync(radice + dentro).isDirectory()) jsSotto(dentro, trovati);
    else if (nome.endsWith('.js')) trovati.push(dentro);
  }
  return trovati;
};

test('tutti i sorgenti di src e public compilano', () => {
  const file = [...jsSotto('src'), ...jsSotto('public')];
  assert.ok(file.length > 10, `trovati solo ${file.length} file: la ricerca non guarda piu’ dove deve`);
  const rotti = [];
  for (const f of file) {
    try { execFileSync(process.execPath, ['--check', radice + f], { stdio: 'pipe' }); }
    catch (e) { rotti.push(`${f}: ${String(e.stderr || e.message).split('\n').find(r => /Error/.test(r)) || 'non compila'}`); }
  }
  assert.deepEqual(rotti, [], 'file che non compilano:\n' + rotti.join('\n'));
});

// ---------------------------------------------------------------------------
// Le variabili d'ambiente da `.env`
// ---------------------------------------------------------------------------
//
// Scoperto il 24/11/2026 provando il rubinetto di CarLock sulla pagina vera:
// il programma non leggeva `.env` da nessuna parte. Le credenziali erano nel
// file, il file era al suo posto, e il server non le vedeva -- quindi la
// funzione «non configurata» rispondeva 501 con tutto configurato.
test('il programma legge .env, e un .env che manca non lo ferma', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  // Si cerca la chiamata, non la parola: la parola compare anche nel commento
  // che la spiega, e ancorarsi la' guarderebbe il commento invece del codice.
  const i = server.indexOf('process.loadEnvFile(');
  assert.ok(i > 0, 'le variabili scritte in .env non arrivano al programma');
  // Avvolto: senza il file `loadEnvFile` lancia, e un file di segreti che
  // manca non deve impedire al server di partire. Su Railway non c'e'.
  assert.match(server.slice(Math.max(0, i - 80), i + 60), /try\s*\{/,
    'un .env che manca impedisce al server di partire');
});
