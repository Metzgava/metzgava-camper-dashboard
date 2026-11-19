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

# --- chi e' la scatoletta ---
# Si legge dalla scheda **prima** di copiare. Due motivi: senza queste due cose
# la riga da incollare non si puo' scrivere, e soprattutto la loro assenza vuol
# dire che Imager ha scartato l'ingranaggio delle impostazioni -- una scheda
# senza utente, senza password e senza WiFi, che fa partire il Raspberry e lo
# lascia irraggiungibile per sempre. Meglio accorgersene adesso, col lettore
# ancora infilato nel Mac, che dopo, con la scheda dentro una scatola chiusa.
UTENTE=$(python3 "$DOVE/identita-scheda.py" utente "$SCHEDA" || true)
NOME=$(python3 "$DOVE/identita-scheda.py" nome "$SCHEDA" || true)
if [ -z "$UTENTE" ] || [ -z "$NOME" ]; then
  MANCA="il nome utente e il nome di rete"
  [ -n "$UTENTE" ] && MANCA="il nome di rete"
  [ -n "$NOME" ] && MANCA="il nome utente"
  echo "!! Non riesco a ricavare $MANCA dalla scheda: non copio niente." >&2
  echo >&2
  echo "   Sulla partizione di avvio non ci sono le impostazioni di Imager:" >&2
  echo "   ne' i file del formato vecchio (userconf.txt, firstrun.sh) ne'" >&2
  echo "   quelli di cloud-init (user-data) di Imager 2." >&2
  echo >&2
  echo "   Vuol dire che Imager ha scritto il sistema e ha buttato via" >&2
  echo "   l'ingranaggio: niente utente, niente password, niente WiFi," >&2
  echo "   niente SSH. Il Raspberry parte e non lo raggiungi piu'." >&2
  echo >&2
  echo "   Riscrivi la scheda, e alla domanda con i tre pulsanti premi" >&2
  echo "   MODIFICA IMPOSTAZIONI, compila, SALVA, e solo allora SI'." >&2
  echo "   Premere NO e' esattamente quel che porta qui." >&2
  exit 1
fi

# --- la copia ---
echo "== Copio la scatoletta su $SCHEDA =="
mkdir -p "$SCHEDA/scatoletta"
# L'elenco sta in una variabile e non sparso nella riga di `cp`, perche' il
# guasto di questo pezzo non e' un file sbagliato: e' un file che manca. La
# prima stesura copiava solo agente.py, installa.sh e config.json, e `blink.py`
# restava a casa — con `agente.py` che lo importa. La scatoletta sarebbe
# partita e avrebbe perso le telecamere al primo giro, in camper, con la
# scheda gia' infilata. Ora l'elenco e' uno, e `prove/test_scheda.py` lo
# controlla.
PEZZI="agente.py blink.py blink-accedi.py aggiungi-rete.sh aggiungi-victron.sh elenca-victron.py installa.sh"
for pezzo in $PEZZI; do
  cp "$DOVE/$pezzo" "$SCHEDA/scatoletta/$pezzo"
done
cp "$CONFIG" "$SCHEDA/scatoletta/config.json"
chmod +x "$SCHEDA/scatoletta/installa.sh" "$SCHEDA/scatoletta/aggiungi-rete.sh" \
         "$SCHEDA/scatoletta/aggiungi-victron.sh" 2>/dev/null || true

# La partizione di avvio e' FAT: non tiene i permessi e la legge chiunque
# infili la scheda in un computer. La chiave della porta ci passa, e va bene
# cosi' — serve solo a scrivere misure — ma e' giusto saperlo.
echo "   $PEZZI config.json"

cat > "$SCHEDA/scatoletta/COME-SI-FINISCE.txt" <<NOTA
Scatoletta del camper — ultimo passo

1. Infila la scheda nel Raspberry e dagli corrente (12 V -> USB).
2. Aspetta un paio di minuti: si accende, si collega al wifi del camper.
3. Dal Mac, sulla stessa rete, incolla questa riga una volta sola:

   ssh $UTENTE@$NOME.local 'cp -r /boot/firmware/scatoletta ~/ && bash ~/scatoletta/installa.sh'

Da quel momento parte da sola a ogni accensione. Non serve piu' toccarla.

Una seconda rete WiFi (Starlink, casa, un telefono) si aggiunge cosi', sulla
scatoletta, una volta per rete:

   ssh $UTENTE@$NOME.local '~/scatoletta/aggiungi-rete.sh'

Non cambia la rete adesso: scrive il profilo, e NetworkManager aggancia da se'
quella che trova. Il collegamento in corso non si tocca.

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
