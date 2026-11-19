#!/bin/bash
# Una seconda rete WiFi per la scatoletta. Si lancia SULLA SCATOLETTA, una
# volta per rete:
#
#     ./aggiungi-rete.sh
#
# Perche' esiste. Il proprietario cambiera' portante: oggi il TP-Link
# `bergamobile`, domani magari il WiFi di Starlink. La tentazione e' un tasto
# nell'app che cambia rete, ed e' una trappola: **il comando viaggia sulla rete
# che sta per spegnere**. Se la nuova non c'e', la scatoletta resta in un posto
# dove non la raggiungi piu', e il canale per dirle «torna indietro» e'
# esattamente quello che le hai appena tolto.
#
# La via buona non ha tasti: si tengono in memoria DUE reti e NetworkManager
# aggancia quella che trova. Se `bergamobile` c'e', sta su `bergamobile`; se
# sparisce passa all'altra da se'; se tornano entrambe segue la priorita'.
# Funziona anche quando nessuno guarda, che e' il requisito vero.
#
# Tre scelte che sembrano dettagli e non lo sono.
#
# 1. **La password non passa dalla riga di comando.** `nmcli device wifi
#    connect ... password X` la metterebbe negli argomenti del processo, dove
#    `ps` la mostra a chiunque sia connesso in quel momento. Qui si scrive il
#    file di NetworkManager e basta.
# 2. **Non si attiva niente.** `nmcli device wifi connect` cambierebbe rete
#    subito, buttando giu' la sessione da cui stai lanciando questo script.
#    Scrivere il profilo e ricaricare non tocca il collegamento in corso.
# 3. **Funziona anche se la rete nuova non e' a portata.** Un `connect` vuole
#    la rete in aria adesso; un profilo su disco aspetta il suo turno. Puoi
#    preparare Starlink da casa.
#
# La password non viene mostrata mentre la batti, non finisce a schermo, e il
# file nasce leggibile solo da root.
set -euo pipefail

# Si possono scavalcare per le prove: `SUDO=` per non chiamare sudo, `NM_DIR`
# per scrivere in una cartella finta invece che in quella di sistema.
SUDO="${SUDO-sudo}"
NM_DIR="${NM_DIR:-/etc/NetworkManager/system-connections}"

PREFERITA=20      # priorita' della rete preferita
NORMALE=5         # priorita' delle altre

echo "== Una rete in piu' per la scatoletta =="
echo "Non cambio la rete adesso: scrivo il profilo e NetworkManager lo usera'"
echo "quando serve. Il collegamento che stai usando non si tocca."
echo

read -r -p "Nome della rete (SSID), esatto, maiuscole comprese: " SSID
if [ -z "${SSID// }" ]; then
  echo "!! Senza nome non si va avanti." >&2
  exit 1
fi

read -r -s -p "Password della rete (non si vedra'): " PSK
echo
if [ -z "$PSK" ]; then
  echo "!! Senza password non si va avanti." >&2
  exit 1
fi
# WPA vuole almeno otto caratteri. Accettarne meno vuol dire scrivere un file
# che NetworkManager rifiutera', e scoprirlo in camper invece che adesso.
if [ "${#PSK}" -lt 8 ]; then
  echo "!! Una password WPA ha almeno otto caratteri: questa ne ha ${#PSK}." >&2
  echo "   Non ho scritto niente. Controlla e rilancia." >&2
  exit 1
fi

read -r -p "E' la rete da preferire quando ci sono entrambe? [s/N] " SCELTA
# `tr` e non `${SCELTA,,}`: quella forma vuole bash 4, e il Mac su cui girano
# le prove ha il 3.2. Uno script che gira solo sulla scatoletta non si puo'
# provare prima di arrivare in camper.
SCELTA="$(printf '%s' "$SCELTA" | tr '[:upper:]' '[:lower:]')"
case "$SCELTA" in
  s|si|sì|y|yes) PRIORITA=$PREFERITA ;;
  *)             PRIORITA=$NORMALE ;;
esac

# Il nome del file: solo caratteri tranquilli. Un SSID puo' contenere spazi e
# accenti, un nome di file e' meglio che no. Il nome vero della rete sta
# dentro, alla voce `ssid`, e quello conta.
SICURO="$(printf '%s' "$SSID" | tr -c 'A-Za-z0-9._-' '_')"
FILE="$NM_DIR/$SICURO.nmconnection"

# Riaggiungere la stessa rete la CORREGGE, non la duplica: stesso nome di file,
# riscritto. E' il caso normale — ci si accorge di aver sbagliato la password.
[ -e "$FILE" ] && echo "(la rete $SSID c'era gia': riscrivo il suo profilo)"

CONTENUTO="[connection]
id=$SICURO
type=wifi
interface-name=wlan0
autoconnect=true
autoconnect-priority=$PRIORITA
autoconnect-retries=0

[wifi]
mode=infrastructure
ssid=$SSID

[wifi-security]
key-mgmt=wpa-psk
psk=$PSK

[ipv4]
method=auto

[ipv6]
method=auto
addr-gen-mode=default
"

$SUDO mkdir -p "$NM_DIR"
# umask prima della scrittura: il file non deve esistere nemmeno per un istante
# con i permessi sbagliati.
( umask 077; printf '%s' "$CONTENUTO" | $SUDO tee "$FILE" >/dev/null )
$SUDO chmod 600 "$FILE"
$SUDO chown root:root "$FILE" 2>/dev/null || true
unset PSK CONTENUTO

# Con sudo: `nmcli connection reload` tocca la configurazione di sistema e
# senza i diritti di root risponde «access denied». Il 19/11 e' andata cosi':
# file scritto, rete non vista da NetworkManager, e lo script morto li' per via
# di `set -e` -- saltando anche l'elenco finale, che avrebbe mostrato il guaio.
$SUDO nmcli connection reload

echo
echo "Fatto. Le reti che la scatoletta conosce, in ordine di preferenza:"
# Se qui compaiono DUE righe con lo stesso SSID, una e' il profilo scritto da
# Raspberry Pi Imager (si chiama `preconfigured`): non e' un guasto, ma tienine
# una sola, per non inseguire due priorita' diverse.
nmcli -f NAME,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY connection show 2>/dev/null \
  | grep -i -E 'NAME|wifi' || true
echo
echo "Da adesso aggancia da se' quella che trova. Nessun comando da dare,"
echo "nessun tasto da premere: anche quando il camper e' chiuso."
