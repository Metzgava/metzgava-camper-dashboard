#!/bin/bash
# Si esegue UNA VOLTA sul Raspberry. Mette in piedi tutto e avvia il servizio.
#
# E' scritto per essere rieseguibile senza danni: se trova le cose gia' fatte,
# le lascia dove sono. Uno script d'installazione che si puo' solo lanciare una
# volta e' uno script che non si puo' correggere.
set -euo pipefail

DOVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UTENTE="${SUDO_USER:-$(id -un)}"

echo "== Scatoletta del camper: installazione in $DOVE per l'utente $UTENTE =="

if [ ! -f "$DOVE/config.json" ]; then
  echo "!! Manca $DOVE/config.json."
  echo "   Copia config.json.esempio, mettici indirizzo e chiavi, e rilancia."
  exit 1
fi

# --- 1. il sistema ---
# python3-venv non c'e' sempre su Raspberry Pi OS Lite, e senza quello il
# resto si ferma a meta'.
echo "-- pacchetti di sistema"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-pip bluez

# Il Bluetooth deve essere acceso e restare acceso anche dopo un riavvio.
sudo systemctl enable --now bluetooth

# --- 2. l'ambiente Python ---
# In un ambiente a parte, non nel Python di sistema: su Raspberry Pi OS quello
# e' protetto apposta, e mescolarci dentro roba e' il modo classico per
# rompere l'aggiornamento successivo.
echo "-- librerie Python (bleak per il Bluetooth, tinytuya per l'allarme)"
if [ ! -d "$DOVE/ambiente" ]; then
  python3 -m venv "$DOVE/ambiente"
fi
"$DOVE/ambiente/bin/pip" install --quiet --upgrade pip
"$DOVE/ambiente/bin/pip" install --quiet bleak cryptography tinytuya

# --- 3. il servizio ---
# Restart=always e RestartSec: se cade, torna su da solo. In camper nessuno
# va a rilanciarlo a mano.
echo "-- servizio di sistema"
sudo tee /etc/systemd/system/scatoletta.service >/dev/null <<SERVIZIO
[Unit]
Description=Scatoletta del camper
After=network-online.target bluetooth.target
Wants=network-online.target

[Service]
Type=simple
User=$UTENTE
WorkingDirectory=$DOVE
ExecStart=$DOVE/ambiente/bin/python $DOVE/agente.py
Restart=always
RestartSec=30
# Il diario non deve riempire la scheda di memoria: le schede si consumano a
# forza di scritture, ed e' il guasto piu' comune di un Raspberry in veicolo.
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVIZIO

# Lo stesso motivo: il diario di sistema sta in memoria e non su disco.
if ! grep -q '^Storage=volatile' /etc/systemd/journald.conf 2>/dev/null; then
  echo "-- diario di sistema in memoria, per non consumare la scheda"
  sudo sed -i 's/^#*Storage=.*/Storage=volatile/' /etc/systemd/journald.conf
  sudo sed -i 's/^#*RuntimeMaxUse=.*/RuntimeMaxUse=16M/' /etc/systemd/journald.conf
  sudo systemctl restart systemd-journald || true
fi

sudo systemctl daemon-reload
sudo systemctl enable --now scatoletta.service

echo
echo "== Fatto. =="
echo "   Come sta:        systemctl status scatoletta"
echo "   Cosa sta dicendo: journalctl -u scatoletta -f"
echo "   Riavvialo:       sudo systemctl restart scatoletta"
echo
echo "Il primo giro parte entro un minuto. Se la rete non c'e', le letture"
echo "restano in coda.jsonl e partono appena torna."
