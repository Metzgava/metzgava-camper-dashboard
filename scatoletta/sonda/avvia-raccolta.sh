#!/bin/bash
# Lancia la raccolta e la lascia andare anche se la sessione cade.
#
# Ferma la precedente leggendo un file di PID, non cercandola per nome. Il nome
# e' una trappola: `pkill -f raccolta.sh` trova «raccolta.sh» anche dentro
# «avvia-raccolta.sh», cioe' dentro il comando che si sta battendo, e uccide la
# propria sessione. Il trucco delle parentesi quadre salva dal cercare se
# stessi, non dal cercare chi ci contiene. Un PID non ha omonimi.
cd "$(dirname "$0")" || exit 1

if [ -f raccolta.pid ] && kill -0 "$(cat raccolta.pid)" 2>/dev/null; then
  echo "fermo la raccolta precedente (PID $(cat raccolta.pid))"
  kill "$(cat raccolta.pid)"
  sleep 2
fi

setsid nohup ./raccolta.sh > raccolta.log 2>&1 < /dev/null &
echo $! > raccolta.pid
disown

sleep 3
echo "--- processo $(cat raccolta.pid) ---"
ps -o pid,etime,cmd -p "$(cat raccolta.pid)" 2>/dev/null || echo "non e' partita"
