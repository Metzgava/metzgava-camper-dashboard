// Le variabili d'ambiente da `.env`, se c'è.
//
// **Questo modulo va importato per primo**, e il suo corpo non fa altro.
//
// Il programma non leggeva `.env` da nessuna parte: le variabili arrivavano
// solo dalla riga di comando (in locale) o dalle variabili del servizio (su
// Railway). Il 24/11/2026, aggiungendo le credenziali di CarLock, si è
// scoperto che scriverle nel file non serviva a niente.
//
// La prima correzione metteva `process.loadEnvFile()` fra le istruzioni di
// `server.js`, e la revisione l'ha smontata con un caso minimo: gli `import`
// di un modulo ESM si valutano **prima** delle sue istruzioni. Quindi
// `db.js`, `util.js`, `geo.js` e `carlock-api.js` leggevano `process.env`
// quando il file non era ancora stato caricato — e chi avesse messo
// `CARLOCK_API_URL` nel file per **non** toccare il conto vero avrebbe
// chiamato `api.carlock.co` lo stesso.
//
// Gli import invece si valutano in ordine: importando questo per primo, il
// suo corpo gira prima di tutti gli altri moduli.
//
// Su Railway non cambia niente: `.env` è fuori dal versionamento, quindi
// nell'immagine non c'è e questa riga non fa nulla.
//
// Avvolto, perché senza il file `loadEnvFile` lancia — e un file di segreti
// che manca non deve impedire al server di partire.
try { process.loadEnvFile(); } catch { }
