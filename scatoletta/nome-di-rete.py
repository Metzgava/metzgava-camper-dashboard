#!/usr/bin/env python3
"""Il nome con cui il Raspberry rispondera' sulla rete.

Lo decide Raspberry Pi Imager quando scrive la scheda, e lo lascia scritto
dentro firstrun.sh sulla partizione di avvio. Leggerlo da li' e' l'unico modo
di scrivere la riga di comando giusta senza chiederla a mano: il "nome" del
nostro config.json e' un'altra cosa (serve a firmare le misure) e i due
possono non combaciare.
"""
import json
import pathlib
import re
import sys

scheda = pathlib.Path(sys.argv[1])
config = sys.argv[2]

f = scheda / "firstrun.sh"
if f.exists():
    testo = f.read_text()
    for schema in (r"set_hostname\s+(\S+)", r"echo\s+(\S+)\s*>\s*/etc/hostname"):
        trovato = re.search(schema, testo)
        if trovato:
            print(trovato.group(1))
            raise SystemExit

print(json.load(open(config)).get("nome", "scatoletta"))
