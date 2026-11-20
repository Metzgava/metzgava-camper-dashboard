#!/bin/bash
# Avvia (o riavvia) la vigilia, staccata, e mostra la prima rilevazione.
#
# Esiste come script per una ragione concreta: un `pkill -f vigilia` lanciato
# da una riga di comando che *nomina* vigilia.py ammazza la sessione stessa.
# Questo script non ha quel nome nella propria riga di comando, quindi puo'
# fare pulizia senza suicidarsi.
cd "$(dirname "$0")" || exit 1
pkill -f '[v]igilia\.py'
sleep 2
setsid nohup "$HOME/scatoletta/ambiente/bin/python" vigilia.py \
       > vigilia.txt 2>&1 < /dev/null &
disown
sleep 22
echo "--- processo ---"
pgrep -af '[v]igilia\.py' || echo "NON PARTITA"
echo "--- prima rilevazione ---"
cat vigilia.txt
