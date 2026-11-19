#!/usr/bin/env python3
"""Chi e' la scatoletta, letto dalla scheda appena scritta.

Serve a una cosa sola, ma importante: stampare la riga di comando giusta, col
nome utente e il nome di rete **veri**. Entrambi li decide Raspberry Pi Imager
quando scrive la scheda, e li lascia sulla partizione di avvio -- in due
formati diversi a seconda della versione:

  Imager 1.x   `userconf.txt` (utente:hash) e `firstrun.sh` (set_hostname ...)
  Imager 2.x   i file di cloud-init: `user-data`, con `hostname:` e `name:`

Il 18/11 lo script leggeva solo il primo formato. Imager 2.0 scriveva il
secondo, e la riga stampata e' venuta fuori cosi':

    ssh UTENTE@scatoletta.local 'cp -r /boot/firmware/scatoletta ...'

Un segnaposto al posto dell'utente, e il nome del nostro config.json al posto
di quello di rete. Inservibile, e finita anche nella nota sulla scheda. Da qui
due regole:

  - si leggono **entrambi** i formati, il vecchio per primo (una scheda scritta
    col vecchio Imager deve continuare a funzionare);
  - se non si ricava niente **non si inventa**: si esce con errore senza
    stampare, e chi chiama lo dice a voce alta.

Uso:  identita-scheda.py utente|nome CARTELLA_DI_AVVIO
"""
import pathlib
import re
import sys


def utente(scheda):
    vecchio = scheda / "userconf.txt"
    if vecchio.exists():
        primo = vecchio.read_text().split(":")[0].strip()
        if primo:
            return primo
    nuovo = scheda / "user-data"
    if nuovo.exists():
        # cloud-init mette l'utente sotto `user:` come `name: "metz"`, oppure
        # in una lista come `- name: "metz"`. L'ancora a inizio riga evita di
        # pescare `hostname:` o `manage_etc_hosts:`.
        trovato = re.search(r'^\s*-?\s*name:\s*"?([^"\s]+)"?\s*$',
                            nuovo.read_text(), re.M)
        if trovato:
            return trovato.group(1)
    return None


def nome(scheda):
    vecchio = scheda / "firstrun.sh"
    if vecchio.exists():
        testo = vecchio.read_text()
        for schema in (r"set_hostname\s+(\S+)",
                       r"echo\s+(\S+)\s*>\s*/etc/hostname"):
            trovato = re.search(schema, testo)
            if trovato:
                return trovato.group(1).strip("\"'")
    nuovo = scheda / "user-data"
    if nuovo.exists():
        trovato = re.search(r'^hostname:\s*"?([^"\s]+)"?\s*$',
                            nuovo.read_text(), re.M)
        if trovato:
            return trovato.group(1)
    return None


if __name__ == "__main__":
    letture = {"utente": utente, "nome": nome}
    if len(sys.argv) != 3 or sys.argv[1] not in letture:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        raise SystemExit(2)
    valore = letture[sys.argv[1]](pathlib.Path(sys.argv[2]))
    if not valore:
        raise SystemExit(1)
    print(valore)
