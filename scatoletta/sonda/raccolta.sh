#!/bin/bash
# Fotografa Bluetti e Charger a intervalli regolari, e tiene ogni scatto.
#
# Perche' da sola: i registri delle potenze stanno a zero quando non entra
# niente, e uno zero non si distingue da un registro che non esiste. Per
# trovarli serve uno scatto preso *mentre carica* — cioe' mentre il camper e'
# in marcia o attaccato alla colonnina, che e' esattamente quando non si puo'
# chiedere al proprietario di fermarsi a leggere un display.
#
# Si lancia con avvia-raccolta.sh. Passo, giri e apparecchi si cambiano da
# fuori:  PASSO=180 GIRI=300 APPARECCHI=EL300 ./raccolta.sh
#
# **Chi fotografare conta.** Ogni scatto tiene la radio occupata una
# quarantina di secondi, e la radio e' una sola: mentre si fotografa, il giro
# della scatoletta non legge le Ective. Dal 21/11/2026 il Charger si puo'
# lasciare fuori -- gli abbiamo chiesto tutte e quattro le domande che MODBUS
# prevede, e i suoi 120 registri non si muovono nemmeno quando lo si spegne e
# riaccende. Fotografarlo e' tempo di radio speso per vedere sempre lo stesso
# quadro.
cd "$(dirname "$0")" || exit 1
PY="$HOME/scatoletta/ambiente/bin/python"
PASSO=${PASSO:-600}
GIRI=${GIRI:-60}
APPARECCHI=${APPARECCHI:-"EL300 CHARGER"}

for ((giro = 1; giro <= GIRI; giro++)); do
  for apparecchio in $APPARECCHI; do
    {
      echo "--- giro $giro delle $(date '+%H:%M:%S') ---"
      "$PY" fotografia-bluetti.py "$apparecchio"
      echo
    } >> "raccolta-${apparecchio}.txt" 2>&1
  done
  sleep "$PASSO"
done
