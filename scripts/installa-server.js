/**
 * Tiene acceso il server della dashboard camper sul Mac, sempre.
 *
 *   npm run server:installa     lo accende e lo lascia acceso
 *   npm run server:rimuovi      lo spegne
 *
 * Come per Bergava: un agent di launchd che parte **al login** e, se il
 * processo muore, **riparte da solo** (KeepAlive). Prima viveva dentro una
 * finestra di Terminale e moriva con lei.
 *
 * Le variabili stanno in `.env` (file protetto, fuori da git e da Railway) e le
 * legge Node da sé con `--env-file`: così la chiave non finisce nel plist, che
 * invece è in chiaro e leggibile da chiunque abbia accesso al Mac.
 *
 * Attenzione: il DATABASE_URL del `.env` è quello di **produzione** su Railway,
 * raggiunto dal proxy pubblico. Quello che si scrive da qui si scrive lì.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const ETICHETTA = 'com.camper.server';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${ETICHETTA}.plist`);
const PROGETTO = path.join(QUI, '..');
const AMBIENTE = path.join(PROGETTO, '.env');
const LOG = path.join(PROGETTO, 'log', 'server.log');
const PORTA = process.env.PORT || '3000';
const dominio = `gui/${process.getuid()}`;

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function launchctl(args, { silenzioso = false } = {}) {
  try {
    execFileSync('launchctl', args, { stdio: silenzioso ? 'ignore' : 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function rimuovi() {
  launchctl(['bootout', `${dominio}/${ETICHETTA}`], { silenzioso: true });
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
  console.log('Server automatico spento.');
  console.log(`Per accenderlo a mano: node --env-file=.env src/server.js · registro ${LOG}`);
}

function installa() {
  if (!fs.existsSync(AMBIENTE)) {
    console.error(`Manca ${AMBIENTE}: senza DATABASE_URL il server non parte.`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${ETICHETTA}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>--env-file=${xml(AMBIENTE)}</string>
    <string>${xml(path.join(PROGETTO, 'src', 'server.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(PROGETTO)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${xml(PORTA)}</string>
    <key>HOME</key><string>${xml(os.homedir())}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`;

  fs.writeFileSync(PLIST, plist);
  launchctl(['bootout', `${dominio}/${ETICHETTA}`], { silenzioso: true });   // se c'era già
  if (!launchctl(['bootstrap', dominio, PLIST])) {
    console.error('Non sono riuscito ad avviare il servizio. Prova a mano:\n'
      + `  launchctl bootstrap ${dominio} ${PLIST}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Servizio acceso: ${ETICHETTA}`);
  console.log('Quando:   al login, e se cade riparte da solo');
  console.log(`Dove:     http://127.0.0.1:${PORTA}`);
  console.log(`Ambiente: ${AMBIENTE} (database di produzione su Railway)`);
  console.log(`Registro: ${LOG}`);
}

if (process.argv.includes('--rimuovi')) rimuovi();
else installa();
