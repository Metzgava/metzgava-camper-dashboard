// Le due rotte del rubinetto: l'elenco, e il tocco che porta tappe e strade.
//
// Disegno: docs/superpowers/specs/2026-11-24-rubinetto-carlock-design.md
//
// Le regole che possono essere **sbagliate al contrario** stanno nelle
// funzioni pure delle attività 1–3, dove si provano sui valori. Qui si
// pretende che le rotte le chiamino, e si guardano i vincoli che vivono solo
// qui: cosa si scrive nel database, cosa si legge dal browser, e cosa finisce
// nei registri.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leggi = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sorgente = leggi('src/routes/trips.js');

// Una rotta, dal suo inizio alla successiva: delimitata per **blocco**, non a
// tot caratteri, cosi' aggiungere un commento non sposta la finestra di
// un'altra prova.
const rotta = via => {
  const i = sorgente.indexOf(`'${via}'`);
  assert.ok(i > 0, `la rotta ${via} non si trova`);
  const dopo = sorgente.indexOf('\nrouter.', i + 10);
  return sorgente.slice(i, dopo > i ? dopo : i + 6000);
};

test('le due rotte esistono, dentro un viaggio come i tasti del file', () => {
  assert.match(sorgente, /'\/trips\/:id\/carlock\/tragitti'/);
  assert.match(sorgente, /'\/trips\/:id\/carlock\/tappe'/);
});

test('i numeri non li manda il browser: dal corpo si prendono solo gli uuid', () => {
  // Chilometri e orari diventano gasolio, pedaggi e totali del viaggio: una
  // pagina che li rimanda indietro e' una pagina che li puo' cambiare.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /body\??\.(uuid|togli)|body\.uuid/, 'non si leggono gli uuid scelti');
  for (const campo of ['body.km', 'body.distance', 'body.start_time', 'body.tragitti', 'body.geometry'])
    assert.doesNotMatch(r, new RegExp(campo.replace(/\./g, '\\.')),
      `i ${campo} arrivano dal browser: li puo’ cambiare chi vuole`);
});

test('la rotta non tocca niente di quel che il tracker ha misurato sulle tappe vecchie', () => {
  const r = rotta('/trips/:id/carlock/tappe');
  for (const s of [...r.matchAll(/UPDATE legs SET[\s\S]*?WHERE/g)].map(m => m[0]))
    for (const colonna of ['distance_km', 'duration_min', 'start_time', 'end_time', 'from_lat', 'to_lat'])
      assert.doesNotMatch(s, new RegExp(colonna), `la rotta riscrive ${colonna} su una tappa che c’era`);
});

test('la strada ricostruita non si calcola quando sta arrivando quella vera', () => {
  // Un tocco porta tappe e strade: calcolare la ricostruzione sarebbe lavoro
  // buttato, sostituito due secondi dopo. E `scarto_ricostruzione_km` resta
  // null, che e' la verita' piena -- non c'e' stata nessuna ricostruzione da
  // confrontare.
  const r = rotta('/trips/:id/carlock/tappe');
  const i = r.indexOf('stradaDellaTappa(');
  assert.ok(i > 0, 'la ricostruzione di scorta non c’e’ piu’: una tappa senza punti resta senza riga');
  const prima = r.slice(Math.max(0, i - 700), i);
  assert.match(prima, /!riga\?\.length|!riga\.length/,
    'si ricostruisce la strada anche quando i punti ci sono');
  // E si passa da `stradaDellaTappa`, non dai percorsi diretti: una prova in
  // `pedaggi-tappa.test.js` conta le chiamate dirette, e tenerle tre vuol
  // dire che una tappa con dei luoghi dichiarati li rispettera' da se'.
  assert.doesNotMatch(r, /percorsoVicinoAiKm\(|percorsoPerIPunti\(/,
    'questa rotta calcola una strada scavalcando `stradaDellaTappa`');
  assert.match(r, /scarto_ricostruzione_km[\s\S]{0,120}NULL/,
    'si scrive uno scarto misurato contro una ricostruzione che nessuno ha visto');
});

test('un tragitto senza punti diventa comunque una tappa, dichiarata ricostruita', () => {
  // Review Focus 5. Meglio una tappa con una strada dedotta, detta tale, che
  // nessuna tappa.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /senza_punti/, 'il resoconto non dice quali tappe non hanno la traccia');
  assert.match(r, /catch/, 'un tragitto che inciampa porta giu’ tutto il tocco');
  // E la tappa nasce lo stesso: il bollino segue i punti, non il tentativo.
  assert.match(r, /tracciato_vero[\s\S]{0,400}!!riga\?\.length|!!riga\?\.length/,
    'il bollino della traccia vera non segue i punti che sono arrivati');
});

test('i doppioni li impedisce il database, e il resoconto li distingue dalle nuove', () => {
  // Review Focus 4.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /ON CONFLICT/, 'niente rete di sicurezza sul doppione');
  assert.match(r, /gia_presenti/, '«c’era gia’» e «creata» finiscono nello stesso conto');
});

test('l’elenco dice anche quali tappe previste sarebbero sostituite', () => {
  assert.match(rotta('/trips/:id/carlock/tragitti'), /previste/,
    'il riquadro non puo’ far vedere cosa toglierebbe');
});

// Le due rotte condividono due aiutanti, `periodoDelRubinetto` e
// `tragittiDelViaggio`: il periodo e l'elenco si calcolano in un posto solo,
// o le due rotte potrebbero rispondere cose diverse sugli stessi giorni. Le
// prove qui sotto pretendono la **delega**, non il codice copiato: se una
// rotta si calcolasse il periodo a mano, non chiamerebbe l'aiutante e la
// prova cadrebbe.
const aiutante = nome => {
  const i = sorgente.indexOf(`function ${nome}(`);
  assert.ok(i > 0, `l’aiutante ${nome} non si trova`);
  return sorgente.slice(i, i + 1400);
};

test('le due rotte chiedono il periodo alla funzione che lo sa, e non a mano', () => {
  for (const via of ['/trips/:id/carlock/tragitti', '/trips/:id/carlock/tappe'])
    assert.match(rotta(via), /periodoDelRubinetto\(|finestraDaChiedere\(/,
      `${via} si calcola il periodo da se’`);
  assert.match(aiutante('periodoDelRubinetto'), /finestraDaChiedere\(/,
    'l’aiutante non usa la regola provata sui valori');
  assert.match(aiutante('periodoDelRubinetto'), /oltreLoStorico\(/,
    'non si sa distinguere «non c’e’ piu’» da «non ancora accaduto»');
});

test('il fuso con cui si costruisce la finestra e’ quello del veicolo', () => {
  // Non quello del server: su Railway sposterebbe i capi di un'ora, e un
  // tragitto partito alle 00:30 del primo giorno resterebbe fuori.
  assert.match(aiutante('periodoDelRubinetto'), /time_zone_id/,
    'si usa la mezzanotte del server invece di quella del veicolo');
  assert.match(aiutante('periodoDelRubinetto'), /mesiDiStorico\(/,
    'lo storico non viene dal piano dell’abbonamento');
});

test('il segno avanza dopo aver chiesto, anche se non si e’ trovato niente', () => {
  // Altrimenti un giorno di sosta ripropone lo stesso cartello per sempre.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /carlock_chiesto_fino_a/, 'il segno non si sposta: il cartello non smette mai');
});

test('le credenziali non finiscono nei registri', () => {
  const r = rotta('/trips/:id/carlock/tragitti') + rotta('/trips/:id/carlock/tappe');
  for (const m of r.matchAll(/console\.(log|warn|error)\(([^)]*)\)/g))
    assert.doesNotMatch(m[2], /CARLOCK_PASSWORD|password|gettone|token/i,
      `questo registro puo’ stampare un segreto: ${m[0].slice(0, 80)}`);
});

test('senza credenziali si risponde 501, non 500: un servizio non acceso non e’ un guasto', () => {
  // La risposta sta in un aiutante condiviso, cosi' le due rotte non possono
  // dire due cose diverse della stessa mancanza.
  for (const via of ['/trips/:id/carlock/tragitti', '/trips/:id/carlock/tappe'])
    assert.match(rotta(via), /nonConfigurato\(res\)/, `${via} non guarda se il rubinetto c’e’`);
  const i = sorgente.indexOf('const nonConfigurato');
  assert.ok(i > 0, 'la risposta del rubinetto spento non si trova');
  const corpo = sorgente.slice(i, i + 400);
  assert.match(corpo, /501/, 'un rubinetto non configurato sembra un errore del programma');
  assert.match(corpo, /file/i, 'non si dice che i tasti col file funzionano comunque');
});

test('la geocodifica si salta quando le coordinate ci sono gia’', () => {
  // Il punto debole noto del file: il 422 «Indirizzo non riconosciuto», i
  // tentativi con 250 ms di pausa l'uno, gli accorgimenti per i nomi
  // stranieri. L'interfaccia da' le coordinate dei due capi: buttarle via per
  // non aggiungere due campi sarebbe un affare cattivo.
  const i = sorgente.indexOf('async function geo(');
  assert.ok(i > 0, 'la geocodifica non si trova piu’');
  assert.match(sorgente.slice(i, i + 460), /lat/,
    'si geocodifica un indirizzo di cui si hanno gia’ le coordinate');
});

test('le previste si togliono col loro gasolio stimato, e nell’ordine giusto', () => {
  // Prima la spesa, poi la tappa: al contrario la spesa resta orfana e il
  // totale conta due volte lo stesso viaggio. E' la regola che il ramo
  // «Sostituisci con CarLock» del file applica gia'.
  const r = rotta('/trips/:id/carlock/tappe');
  const spesa = r.indexOf('DELETE FROM expenses');
  const tappa = r.indexOf('DELETE FROM legs');
  assert.ok(spesa > 0 && tappa > 0, 'le previste non si togliono');
  assert.ok(spesa < tappa, 'si cancella la tappa prima della sua spesa: la spesa resta orfana');
});

test('si toglie solo quel che e’ stato spuntato, non tutte le previste', () => {
  // La spunta e' sua: togliendola, la tappa prevista resta, e allora e' una
  // sua scelta e non una distrazione del programma.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /ANY\(\$\d::int\[\]\)/,
    'si cancellano le previste in blocco invece di quelle indicate');
});

test('una traccia che copre un pezzo della tappa non si prende il bollino «vera»', () => {
  // Trovato sulla pagina vera il 24/11/2026: una tappa di 192 km nata con 8
  // km di riga e sopra «strada vera». La regola si prova sui valori in
  // `tracciati-periodo.test.js`; qui si pretende che la rotta la chiami.
  const r = rotta('/trips/:id/carlock/tappe');
  assert.match(r, /copreLaTappa\(riga, t\.km\)/,
    'si accetta una traccia che copre una frazione del percorso');
});

test('non si offre di togliere un traghetto o un aereo', () => {
  // Trovato guardando il riquadro, il 24/11/2026: fra le «previste da
  // sostituire» compariva **Livorno -> Olbia in traghetto**, con la spunta
  // gia' messa. Un tocco distratto l'avrebbe cancellata -- e CarLock non
  // sostituira' mai una rotta in traghetto, perche' il tracker viaggia
  // sopra la nave e quel tragitto non e' una strada.
  //
  // E' la stessa regola che vale in tutto il resto del programma: solo in
  // camper.
  const i = sorgente.indexOf('const previsteDi');
  assert.ok(i > 0, 'l’elenco delle previste non si trova piu’');
  assert.match(sorgente.slice(i, i + 500), /mezzo/,
    'si offre di cancellare tappe che il tracker non puo’ sostituire');
});

test('la pagina di un viaggio non aspetta CarLock', () => {
  // Trovato il 24/11/2026, appena le credenziali sono andate in produzione:
  // `datiViaggio` aspettava un accesso a CarLock per sapere quanti mesi di
  // storico c'e'. `fetch` non ha un tempo massimo di suo, quindi la pagina di
  // un viaggio restava appesa a un servizio non documentato -- per un numero
  // che decide soltanto se un cartello compare.
  //
  // Adesso si guarda solo quel che si sa gia' (`veicoloNoto`), e se non si sa
  // si risponde col piano piu' piccolo scaldando la cache **in sottofondo**:
  // la prima apertura e' prudente, la seconda giusta, e nessuna aspetta.
  // La finestra e' la funzione, non tot caratteri: 900 caratteri sfondavano in
  // `periodoDelRubinetto`, che invece **deve** aspettare -- quello e' il
  // percorso del tocco, dove l'attesa e' quel che il proprietario ha chiesto.
  const i = sorgente.indexOf('function mesiStoricoDelConto');
  assert.ok(i > 0, 'il numero dei mesi non si calcola piu’');
  const chiude = sorgente.indexOf('\n}', i);
  assert.ok(chiude > i, 'la funzione dei mesi non si delimita');
  const corpo = sorgente.slice(i, chiude);
  assert.match(corpo, /veicoloNoto\(\)/, 'si chiede il veicolo invece di guardare se si sa gia’');
  assert.doesNotMatch(corpo, /await /, 'la pagina di un viaggio aspetta una chiamata a CarLock');
  // E il campo non si aspetta nemmeno dove viene messo nella risposta.
  const d = sorgente.indexOf('carlock_mesi_storico:');
  assert.ok(d > 0, 'il viaggio non porta piu’ i mesi di storico');
  // Solo quella riga: quelle accanto hanno degli `await` che ci stanno bene.
  const riga = sorgente.slice(d, sorgente.indexOf('\n', d));
  assert.doesNotMatch(riga, /await/, 'il campo si aspetta dentro `datiViaggio`');
});

test('la pagina di un viaggio non chiama CarLock, nemmeno in sottofondo', () => {
  // La revisione finale: `datiViaggio` lo chiama anche il percorso dei link
  // condivisi (share.js), che **non e' autenticato**. Un ospite che apre un
  // link innescava un accesso al conto CarLock del proprietario. E il
  // fallimento non si ricorda -- `veicolo()` tiene in memoria solo il
  // successo -- quindi con le credenziali scadute era **un accesso per ogni
  // apertura di pagina**: la grandinata che il commento in cima a
  // `carlock-api.js` racconta di aver gia' vista con la Bluetti.
  const i = sorgente.indexOf('function mesiStoricoDelConto');
  const corpo = sorgente.slice(i, sorgente.indexOf('\n}', i));
  assert.doesNotMatch(corpo, /\.veicolo\(\)/,
    'la pagina di un viaggio puo’ innescare un accesso a CarLock');
  assert.match(corpo, /veicoloNoto\(\)/, 'il numero non viene da quel che si sa gia’');
});

test('il veicolo si legge una volta all’avvio, non su richiesta di qualcuno', () => {
  const server = leggi('src/server.js');
  assert.match(server, /scaldaCarlock|veicoloCarlock/,
    'nessuno legge il veicolo all’avvio: il cartello resterebbe prudente per sempre');
});

test('le previste si togliono DOPO aver creato, o si cancella per niente', () => {
  // La revisione finale: il blocco che cancella stava prima del giro che
  // crea, e niente era in una transazione. Un errore sull'inserimento --
  // 500, toast generico -- e le tappe previste erano andate col loro gasolio,
  // senza che nascesse niente al loro posto.
  const r = rotta('/trips/:id/carlock/tappe');
  const cancella = r.indexOf('DELETE FROM legs');
  const crea = r.indexOf('INSERT INTO legs');
  assert.ok(cancella > 0 && crea > 0, 'la rotta non crea o non cancella piu’');
  assert.ok(crea < cancella,
    'si cancellano le previste prima di creare: un errore e le perde per niente');
});

test('le tappe nuove si rimettono in ordine di data', () => {
  // L'import da file lo fa; questa rotta no. Toccando al terzo giorno di un
  // viaggio di dieci, le tappe vere finivano **dopo** quelle ancora previste
  // dei giorni successivi, perche' si accodano a `max(position)`.
  assert.match(rotta('/trips/:id/carlock/tappe'), /rimettiInOrdine\(/,
    'le tappe nuove restano in fondo all’elenco');
});

test('il resoconto distingue le tre ragioni di una tappa senza traccia', () => {
  // Erano tutte `senza_traccia`: il capo non geocodificato (dove la tappa non
  // nasce nemmeno), i punti non arrivati, e la traccia troppo corta. La
  // pagina ne diceva una sola -- «i punti non sono arrivati» -- falsa per le
  // altre due, e in un caso diceva che esiste una tappa che non esiste.
  const r = rotta('/trips/:id/carlock/tappe');
  for (const campo of ['senza_punti', 'traccia_parziale', 'non_create'])
    assert.match(r, new RegExp(campo), `il resoconto non distingue ${campo}`);
  assert.doesNotMatch(r, /senza_traccia = Math\.max/, 'resta la riga morta che non decrementa niente');
});

test('una tappa che c’era gia’ e non ha la traccia non butta via i punti letti', () => {
  // La revisione: `continue` dopo `gia_presenti` scartava dei punti appena
  // scaricati, e una tappa importata dal file restava «ricostruita» per
  // sempre -- il rubinetto non poteva piu' sistemarla.
  const r = rotta('/trips/:id/carlock/tappe');
  const i = r.indexOf('gia_presenti++');
  assert.ok(i > 0, 'il conto delle tappe gia’ presenti non si trova');
  assert.match(r.slice(i, i + 1400), /UPDATE legs SET/,
    'i punti scaricati per una tappa che c’era si buttano');
  // E lo scarto si misura: e' l'unico caso in cui quel numero vuol dire
  // qualcosa, perche' una ricostruzione viene sostituita da una traccia.
  assert.match(r.slice(i, i + 1400), /quantoSbagliava\(/,
    'si butta la misura di quanto sbagliava la ricostruzione, che qui si puo’ fare');
});
