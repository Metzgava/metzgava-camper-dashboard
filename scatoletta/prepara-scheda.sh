#!/bin/bash
# Si esegue SUL MAC, con la scheda di memoria del Raspberry infilata.
#
# Non scrive il sistema operativo: quello lo mette Raspberry Pi Imager, che sa
# anche configurare rete, utente e SSH meglio di qualunque script. Questo copia
# soltanto la scatoletta nella partizione di avvio, cosi' il Raspberry si
# trova tutto in casa al primo accensione e non serve scaricare niente a bordo.
#
# Perche' non fa partire l'installazione da sola: la partizione grande del
# Raspberry e' ext4 e un Mac non la sa scrivere, e l'unico gancio disponibile
# sulla partizione di avvio (systemd.run in cmdline.txt) e' lo stesso che usa
# Imager per configurare rete e utente. Sovrascriverlo vorrebbe dire una
# scheda che parte senza wifi. Resta una riga da incollare, una volta sola.
set -euo pipefail

DOVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${1:-$DOVE/config.json}"

# --- la scheda ---
# Si cerca la partizione di avvio, non un disco qualunque: ci deve essere
# config.txt, altrimenti stiamo scrivendo sul disco sbagliato.
SCHEDA=""
# SCHEDA_DIR serve solo per le prove: permette di far finta che una cartella
# qualunque sia la scheda, e di verificare lo script senza rischiare un disco.
for v in ${SCHEDA_DIR:-} /Volumes/bootfs /Volumes/boot; do
  [ -f "$v/config.txt" ] && SCHEDA="$v" && break
done
if [ -z "$SCHEDA" ]; then
  echo "!! Non trovo la partizione di avvio del Raspberry."
  echo "   Infila la scheda e controlla che compaia /Volumes/bootfs."
  echo "   Se non c'e' ancora il sistema, scrivilo prima con Raspberry Pi Imager:"
  echo "     - sistema:  Raspberry Pi OS Lite (64 bit)"
  echo "     - ingranaggio: nome bergava-scatoletta, utente e password tuoi,"
  echo "       SSH acceso, e la rete del camper (bergamobile) con la sua password."
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "!! Manca $CONFIG."
  echo "   Copia config.json.esempio in config.json e riempilo (vedi README)."
  exit 1
fi
python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$CONFIG" \
  || { echo "!! $CONFIG non e' JSON valido: correggilo e rilancia."; exit 1; }

CHIAVE=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('chiave',''))" "$CONFIG")
case "$CHIAVE" in
  ""|METTI-QUI-*) echo "!! In $CONFIG la voce \"chiave\" e' ancora da riempire."; exit 1;;
esac

# --- la copia ---
echo "== Copio la scatoletta su $SCHEDA =="
mkdir -p "$SCHEDA/scatoletta"
cp "$DOVE/agente.py" "$DOVE/installa.sh" "$SCHEDA/scatoletta/"
cp "$CONFIG" "$SCHEDA/scatoletta/config.json"
chmod +x "$SCHEDA/scatoletta/installa.sh" 2>/dev/null || true

# La partizione di avvio e' FAT: non tiene i permessi e la legge chiunque
# infili la scheda in un computer. La chiave della porta ci passa, e va bene
# cosi' — serve solo a scrivere misure — ma e' giusto saperlo.
echo "   agente.py, installa.sh, config.json"

UTENTE=$(python3 - "$SCHEDA" <<'PY'
import re, sys, pathlib
# Imager scrive l'utente in userconf.txt (nome:hash). Serve solo per scrivere
# la riga di comando giusta: se non c'e', si mette un segnaposto.
p = pathlib.Path(sys.argv[1]) / "userconf.txt"
print(p.read_text().split(":")[0].strip() if p.exists() else "UTENTE")
PY
)
# Il nome con cui risponde sulla rete lo decide Imager, non il nostro
# config.json: sta scritto dentro firstrun.sh. Se non lo si trova si mette
# quello del config, che e' meglio di un segnaposto ma puo' non combaciare.
NOME=$(python3 "$DOVE/nome-di-rete.py" "$SCHEDA" "$CONFIG")

cat > "$SCHEDA/scatoletta/COME-SI-FINISCE.txt" <<NOTA
Scatoletta del camper — ultimo passo

1. Infila la scheda nel Raspberry e dagli corrente (12 V -> USB).
2. Aspetta un paio di minuti: si accende, si collega al wifi del camper.
3. Dal Mac, sulla stessa rete, incolla questa riga una volta sola:

   ssh $UTENTE@$NOME.local 'cp -r /boot/firmware/scatoletta ~/ && bash ~/scatoletta/installa.sh'

Da quel momento parte da sola a ogni accensione. Non serve piu' toccarla.

Come sta:          ssh $UTENTE@$NOME.local 'systemctl status scatoletta'
Cosa sta dicendo:  ssh $UTENTE@$NOME.local 'journalctl -u scatoletta -f'
NOTA

echo
echo "== Fatto. =="
echo "   Espelli la scheda, infilala nel Raspberry e dagli corrente."
echo "   Poi, una volta sola, dal Mac sulla rete del camper:"
echo
echo "   ssh $UTENTE@$NOME.local 'cp -r /boot/firmware/scatoletta ~/ && bash ~/scatoletta/installa.sh'"
echo
echo "   (la stessa riga e' in $SCHEDA/scatoletta/COME-SI-FINISCE.txt,"
echo "    che resta sulla scheda e si legge da qualunque computer)"
