#!/usr/bin/env bash
# Quale registro accende e spegne il Charger 2.
#
# Il metodo e' quello gia' usato per i registri della Bluetti, ed e' l'unico
# onesto: **non si scrive niente al buio, si guarda cosa fa l'app ufficiale.**
# Si fotografano i registri una volta al minuto mentre il proprietario preme il
# tasto nell'app, e poi si confronta. Il registro che si muove insieme al tasto
# e' quello: non e' una deduzione, e' il costruttore che lo fa davanti a noi.
#
# Perche' non si ascolta in diretta: su Bluetooth comanda **un cliente alla
# volta**. Se la scatoletta tiene aperto il collegamento, l'app non entra -- ed
# e' esattamente la lezione del 20/11, quando un collegamento rimasto aperto da
# una sonda morta male faceva sembrare la Bluetti spenta. Quindi si alternano:
# lei fotografa, lui preme, lei rifotografa.
#
# Per la stessa ragione la raccolta lenta si ferma per la durata della prova e
# riparte da se' alla fine.
#
#   ./prova-charger.sh              sedici scatti, uno al minuto
#   GIRI=24 PASSO=45 ./prova-charger.sh
set -u
cd "$(dirname "$0")" || exit 1
PY="$HOME/scatoletta/ambiente/bin/python"
GIRI=${GIRI:-16}
PASSO=${PASSO:-60}

echo "Fermo la raccolta lenta: due clienti sulla stessa radio si danno fastidio."
systemctl --user stop raccolta 2>/dev/null

echo
echo "Scatto $GIRI volte, una ogni $PASSO secondi. Da fare mentre gira:"
echo "  1. aspetta due scatti senza toccare niente"
echo "  2. spegni il Charger dall'app, e aspetta tre minuti"
echo "  3. riaccendilo, e aspetta tre minuti"
echo
g=1
while [ "$g" -le "$GIRI" ]; do
  echo "$(date +%H:%M:%S)  scatto $g di $GIRI"
  "$PY" fotografia-bluetti.py CHARGER >> prova-charger.txt 2>&1
  if [ "$g" -lt "$GIRI" ]; then sleep "$PASSO"; fi
  g=$((g + 1))
done

echo
echo "Finito. Rimetto in moto la raccolta lenta."
systemctl --user start raccolta 2>/dev/null
echo
echo "I registri che si sono mossi durante la prova:"
"$PY" confronta.py charger "$GIRI"
