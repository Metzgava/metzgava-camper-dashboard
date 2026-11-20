#!/bin/bash
# Fotografa Bluetti e Charger a intervalli regolari, e tiene ogni scatto.
#
# Perche' da sola: i registri delle potenze stanno a zero quando non entra
# niente, e uno zero non si distingue da un registro che non esiste. Per
# trovarli serve uno scatto preso *mentre carica* — cioe' mentre il camper e'
# in marcia o attaccato alla colonnina, che e' esattamente quando non si puo'
# chiedere al proprietario di fermarsi a leggere un display.
#
# Si lancia con avvia-raccolta.sh. Il passo e il numero di giri si possono
# cambiare da fuori:  PASSO=300 GIRI=12 ./raccolta.sh
cd "$(dirname "$0")" || exit 1
PY="$HOME/scatoletta/ambiente/bin/python"
PASSO=${PASSO:-600}
GIRI=${GIRI:-60}

for ((giro = 1; giro <= GIRI; giro++)); do
  for apparecchio in EL300 CHARGER; do
    {
      echo "--- giro $giro delle $(date '+%H:%M:%S') ---"
      "$PY" fotografia-bluetti.py "$apparecchio"
      echo
    } >> "raccolta-${apparecchio}.txt" 2>&1
  done
  sleep "$PASSO"
done
