// Il rubinetto: parlare con CarLock, e il gettone che si rinnova.
//
// Disegno: docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md
//
// Quell'interfaccia non e' documentata ne' supportata -- l'hanno scritta per
// il loro programma della pagina -- quindi le forme delle risposte stanno in
// `test/fixtures/carlock-api-forme.json`, misurate il 24/11/2026. Le prove
// girano **senza rete**: il `fetch` si passa da fuori.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { creaRubinetto, hashPassword, CLIENT } from '../src/lib/carlock-api.js';

const FORME = JSON.parse(readFileSync(new URL('./fixtures/carlock-api-forme.json', import.meta.url), 'utf8'));

// Una risposta finta che si comporta come quella di `fetch` per quel poco che
// il rubinetto le chiede.
const risposta = (corpo, stato = 200) => ({
  status: stato,
  ok: stato >= 200 && stato < 300,
  async text() { return JSON.stringify(corpo); },
  async json() { return corpo; },
});

test('la password va in SHA-256 esadecimale, quello che vuole la loro interfaccia', () => {
  // Valore noto, cosi' la prova fallisce se qualcuno cambia algoritmo.
  assert.equal(hashPassword('prova'),
    crypto.createHash('sha256').update('prova', 'utf8').digest('hex'));
  assert.match(hashPassword('prova'), /^[0-9a-f]{64}$/);
  assert.notEqual(hashPassword('prova'), hashPassword('provA'));
});

test('il gettone non finisce su disco', () => {
  // Anti obiettivo del disegno: un riavvio costa un accesso, non un rischio.
  const sorgente = readFileSync(new URL('../src/lib/carlock-api.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sorgente, /writeFile|appendFile|createWriteStream/,
    'il gettone o le credenziali possono finire in un file');
});

test('non si stampa niente nei registri da questo modulo', () => {
  // «Non si scrivono mai nei registri, nemmeno troncate»: la via piu' sicura
  // e' che questo file non parli affatto. Chi chiama decide cosa dire.
  const sorgente = readFileSync(new URL('../src/lib/carlock-api.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sorgente, /console\.(log|warn|error|info|debug)/,
    'un registro qui dentro puo’ stampare la password o il gettone');
});

test('il veicolo si puo’ scegliere, invece di prendere sempre il primo', async () => {
  // Oggi sul conto ce n'e' uno solo. Domani, con un secondo tracker, «il
  // primo» porterebbe dentro i tragitti dell'auto senza che niente lo dica.
  const vie = [];
  const finto = async url => { vie.push(String(url)); return risposta(
    String(url).includes('/user/login') ? FORME.login : FORME.trips_elenco,
    String(url).includes('/user/login') ? 201 : 200); };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', uuid: 'SCELTO-A-MANO', fetch: finto });
  await r.tragittiDelPeriodo(null, 1, 2);
  assert.ok(vie.some(v => v.includes('SCELTO-A-MANO')),
    'l’uuid passato da fuori viene ignorato');
});

test('l’accesso manda email e password_hash, e le intestazioni del programma', async () => {
  // Si guarda cos'e' stato spedito, non cosa torna: e' l'unico modo di
  // provare che la password non parte in chiaro.
  const viste = [];
  const finto = async (url, opz) => { viste.push({ url, opz }); return risposta(
    String(url).includes('/user/login') ? FORME.login : FORME.user_vehicles,
    String(url).includes('/user/login') ? 201 : 200); };
  const r = creaRubinetto({ email: 'a@b.c', password: 'segreta', fetch: finto });
  await r.veicolo();
  const corpo = JSON.parse(viste[0].opz.body);
  assert.equal(corpo.email, 'a@b.c');
  assert.equal(corpo.password_hash, hashPassword('segreta'));
  assert.ok(!JSON.stringify(viste).includes('segreta'), 'la password e’ partita in chiaro');
  assert.equal(viste[0].opz.headers['X-Client-Type'], CLIENT.type);
  assert.equal(viste[0].opz.headers['X-Client-Version'], CLIENT.version);
});

test('il veicolo porta il fuso e il piano, che servono a chi lo chiama', async () => {
  // Il fuso al traduttore, il piano alla finestra da chiedere.
  const finto = async url => risposta(
    String(url).includes('/user/login') ? FORME.login : FORME.user_vehicles,
    String(url).includes('/user/login') ? 201 : 200);
  const v = await creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto }).veicolo();
  assert.equal(v.time_zone_id, 'Europe/Rome');
  assert.equal(v.subscription_tier, 'STANDARD_PLUS');
  assert.equal(v.uuid, FORME.user_vehicles.vehicles[0].uuid);
});

test('il gettone si usa senza rifare l’accesso a ogni chiamata', async () => {
  // Due richieste di fila: un accesso solo.
  const vie = [];
  const finto = async via => { vie.push(String(via)); return risposta(
    String(via).includes('/user/login') ? FORME.login
      : String(via).includes('/trip/') ? FORME.trip_singolo : FORME.trips_elenco,
    String(via).includes('/user/login') ? 201 : 200); };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  await r.tragittiDelPeriodo('U', 1, 2);
  await r.tragittiDelPeriodo('U', 3, 4);
  assert.equal(vie.filter(v => v.includes('/user/login')).length, 1);
});

test('il gettone viaggia in X-Token, non in Authorization', async () => {
  const viste = [];
  const finto = async (url, opz) => { viste.push({ url: String(url), opz }); return risposta(
    String(url).includes('/user/login') ? FORME.login : FORME.trips_elenco,
    String(url).includes('/user/login') ? 201 : 200); };
  await creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto }).tragittiDelPeriodo('U', 1, 2);
  const dopo = viste.find(v => !v.url.includes('/user/login'));
  assert.equal(dopo.opz.headers['X-Token'], FORME.login.token);
});

test('il gettone che scade a meta’ lavoro si rinnova una volta e si continua', async () => {
  // Review Focus 1. Un 401 sulla seconda chiamata: si rifa' l'accesso e la
  // chiamata riparte, invece di buttare via tutto il lavoro fatto.
  let accessi = 0, chiamate = 0;
  const finto = async via => {
    if (String(via).includes('/user/login')) { accessi++; return risposta(FORME.login, 201); }
    chiamate++;
    if (chiamate === 2) return risposta({ http_status: 401 }, 401);
    return risposta(FORME.trips_elenco, 200);
  };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  await r.tragittiDelPeriodo('U', 1, 2);
  const d = await r.tragittiDelPeriodo('U', 3, 4);
  assert.equal(accessi, 2, 'non si e’ rinnovato il gettone');
  assert.equal(d.length, 2, 'la chiamata non e’ ripartita dopo il rinnovo');
});

test('se anche il gettone nuovo viene rifiutato, si smette e lo si dice', async () => {
  // Mai due accessi di fila per la stessa richiesta: e' il modo di farsi
  // bloccare il conto, e col gettone della Bluetti l'abbiamo gia' visto fare
  // danni (una grandinata di rinnovi, 805 di fila).
  let accessi = 0;
  const finto = async via => {
    if (String(via).includes('/user/login')) { accessi++; return risposta(FORME.login, 201); }
    return risposta({ http_status: 401 }, 401);
  };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  await assert.rejects(() => r.tragittiDelPeriodo('U', 1, 2), /CarLock/);
  assert.equal(accessi, 2, `accessi tentati: ${accessi} -- devono essere due, non di piu’`);
});

test('le pagine si girano tutte: fermarsi alla prima perde la coda in silenzio', async () => {
  // `total_count` dice quanti sono; senza `page_size` ne tornano 20.
  const pagine = [];
  const finto = async via => {
    if (String(via).includes('/user/login')) return risposta(FORME.login, 201);
    pagine.push(new URL(via).searchParams.get('page'));
    return risposta({ total_count: 3, trips: [FORME.trips_elenco.trips[0]] }, 200);
  };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  const d = await r.tragittiDelPeriodo('U', 1, 2);
  assert.equal(d.length, 3, `ne ha presi ${d.length} su 3`);
  assert.deepEqual(pagine, ['0', '1', '2'], 'le pagine si contano da zero');
});

test('una pagina vuota ferma il giro, anche se loro dicono che ce n’e’ ancora', async () => {
  // La cintura: un `total_count` sbagliato da parte loro diventerebbe un
  // ciclo infinito, e un ciclo infinito su una rotta e' un server fermo.
  let giri = 0;
  const finto = async via => {
    if (String(via).includes('/user/login')) return risposta(FORME.login, 201);
    giri++;
    return risposta({ total_count: 9999, trips: [] }, 200);
  };
  const d = await creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto })
    .tragittiDelPeriodo('U', 1, 2);
  assert.equal(d.length, 0);
  assert.ok(giri <= 2, `ha chiesto ${giri} pagine a un servizio che non ne ha`);
});

test('il periodo arriva in millisecondi, come vuole la loro interfaccia', async () => {
  const vie = [];
  const finto = async via => { vie.push(String(via)); return risposta(
    String(via).includes('/user/login') ? FORME.login : FORME.trips_elenco,
    String(via).includes('/user/login') ? 201 : 200); };
  await creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto })
    .tragittiDelPeriodo('U', 1795256309000, 1795266309000);
  const q = new URL(vie.find(v => v.includes('/trips?'))).searchParams;
  assert.equal(q.get('date_from'), '1795256309000');
  assert.equal(q.get('date_to'), '1795266309000');
  assert.equal(q.get('ascending'), 'true');
});

test('i punti di un tragitto si chiedono uno per volta, dalla sua rotta', async () => {
  const vie = [];
  const finto = async via => { vie.push(String(via)); return risposta(
    String(via).includes('/user/login') ? FORME.login : FORME.trip_singolo,
    String(via).includes('/user/login') ? 201 : 200); };
  const t = await creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto })
    .puntiDelTragitto('TRAGITTO-1');
  assert.ok(vie.some(v => v.includes('/trip/TRAGITTO-1')));
  assert.equal(t.locations.length, FORME.trip_singolo.locations.length);
});

test('un guasto di CarLock si riconosce dal messaggio, e non porta dentro la password', async () => {
  const finto = async () => risposta({ http_status: 500, description: 'Sorry' }, 500);
  const r = creaRubinetto({ email: 'a@b.c', password: 'segreta', fetch: finto });
  await assert.rejects(() => r.veicolo(), e =>
    /CarLock/.test(e.message) && !/segreta/.test(e.message));
});

test('senza credenziali il rubinetto dice che non e’ configurato, invece di provarci', async () => {
  // Un servizio non acceso non e' un guasto: chi chiama lo distingue e
  // risponde 501 invece di 500.
  const r = creaRubinetto({ email: '', password: '', fetch: async () => risposta({}, 200) });
  await assert.rejects(() => r.veicolo(), /configurat/i);
});

// ---------------------------------------------------------------------------
// Il veicolo gia' noto, e il tempo massimo di attesa
// ---------------------------------------------------------------------------
//
// Trovato il 24/11/2026, appena le credenziali sono andate in produzione:
// `datiViaggio` aspettava `mesiStoricoDelConto()`, che a processo freddo fa un
// accesso a CarLock. `fetch` non ha un tempo massimo di suo, quindi la pagina
// di un viaggio restava appesa a un servizio non documentato -- per un numero
// che decide soltanto se un cartello compare.
//
// Due cose: si puo' chiedere **se il veicolo e' gia' noto** senza toccare la
// rete, e ogni chiamata ha un tempo massimo.
test('si puo’ sapere se il veicolo e’ gia’ noto senza chiamare nessuno', async () => {
  let chiamate = 0;
  const finto = async url => { chiamate++; return risposta(
    String(url).includes('/user/login') ? FORME.login : FORME.user_vehicles,
    String(url).includes('/user/login') ? 201 : 200); };
  const r = creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto });
  assert.equal(r.veicoloNoto(), null, 'si e’ inventato un veicolo mai letto');
  assert.equal(chiamate, 0, 'chiedere «lo sai?» ha fatto una chiamata');
  await r.veicolo();
  assert.equal(r.veicoloNoto()?.time_zone_id, 'Europe/Rome');
  const prima = chiamate;
  r.veicoloNoto();
  assert.equal(chiamate, prima, 'rileggere quel che si sa gia’ fa una chiamata');
});

test('ogni chiamata ha un tempo massimo: un servizio appeso non appende noi', async () => {
  const viste = [];
  const finto = async (url, opz) => { viste.push(opz); return risposta(
    String(url).includes('/user/login') ? FORME.login : FORME.user_vehicles,
    String(url).includes('/user/login') ? 201 : 200); };
  await creaRubinetto({ email: 'a@b.c', password: 'x', fetch: finto }).veicolo();
  for (const o of viste)
    assert.ok(o.signal, 'una chiamata senza tempo massimo puo’ restare appesa per sempre');
});
