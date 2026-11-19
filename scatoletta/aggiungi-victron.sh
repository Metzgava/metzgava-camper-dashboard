#!/bin/bash
# La chiave di cifratura di una Victron. Si lancia SULLA SCATOLETTA, una volta
# per apparecchio:
#
#     ./aggiungi-victron.sh
#
# Perche' esiste. Le Victron non trasmettono in chiaro come i termometri: ogni
# apparecchio annuncia i suoi dati cifrati con una chiave propria, che si legge
# una volta sola da VictronConnect sul telefono (impostazioni, tre puntini,
# informazioni prodotto, lettura istantanea). Senza quella chiave la scatoletta
# sente l'annuncio e lo lascia stare -- che e' la cosa giusta, ma vuol dire
# nessun dato.
#
# Tre scelte che sembrano dettagli e non lo sono.
#
# 1. **La chiave non passa dalla riga di comando.** Ne' come argomento di
#    questo script, ne' come argomento del python che scrive il file: `ps`
#    mostra gli argomenti dei processi a chiunque sia collegato in quel
#    momento. Viaggia nell'ambiente, che lo legge solo chi e' questo utente o
#    root, e non compare mai a schermo.
# 2. **L'indirizzo non si copia a mano.** La scatoletta sa gia' quali Victron
#    sente: le elenca numerate e si risponde col numero. Un MAC battuto a mano
#    e' diciassette caratteri di occasioni per sbagliare, e l'errore non si
#    vede -- si vede solo che l'apparecchio non compare mai.
# 3. **`config.json` non si riscrive a mano.** Dentro c'e' anche la chiave
#    della porta del server: perderla vuol dire che la scatoletta smette di
#    parlare col server, e il guasto sembra tutt'altro. Qui il file si rilegge,
#    si aggiunge una voce e si riscrive intero in modo atomico; se e'
#    illeggibile non si tocca per niente.
#
# Il riscritto perde l'impaginazione a mano (righe vuote, ordine delle voci):
# i commenti `_nota` restano, perche' sono voci JSON come le altre.
set -euo pipefail

DOVE="$(cd "$(dirname "$0")" && pwd)"
# Le stesse scavalcature che usa l'agente, cosi' le prove girano sul Mac:
# `AGENTE_CONFIG` per il file, `ELENCO` per il comando che elenca gli
# apparecchi (sulla scatoletta e' il python che ascolta la radio).
CONFIG="${AGENTE_CONFIG:-$DOVE/config.json}"
# Il Python dell'ambiente a parte, quello dove `installa.sh` ha messo `bleak`.
# Col `python3` di sistema `elenca-victron.py` muore per un import mancante,
# l'elenco torna vuoto e lo script direbbe «non sento nessuna Victron»:
# manderebbe ad avvicinare il camper per un guasto che non c'entra niente.
# Sul Mac, dove girano le prove, quell'ambiente non esiste e si ripiega.
PYTHON="$DOVE/ambiente/bin/python"
[ -x "$PYTHON" ] || PYTHON=python3
ELENCO="${ELENCO:-$PYTHON $DOVE/elenca-victron.py}"

echo "== La chiave di una Victron =="

if [ ! -f "$CONFIG" ]; then
  echo "!! Non trovo $CONFIG: non so dove scrivere." >&2
  exit 1
fi
# Prima di qualunque domanda: se il file e' rotto, riscriverlo vorrebbe dire
# perdere tutto il resto. Meglio fermarsi con il file intatto.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$CONFIG" 2>/dev/null; then
  echo "!! $CONFIG non si legge come JSON: non lo tocco." >&2
  echo "   Correggilo a mano e rilancia. Niente e' stato cambiato." >&2
  exit 1
fi

echo "Ascolto la radio per qualche secondo..."
SENTITI="$($ELENCO || true)"
if [ -z "${SENTITI// }" ]; then
  echo "!! Non sento nessuna Victron." >&2
  echo "   Succede se la scatoletta e' lontana dal camper: gli annunci" >&2
  echo "   Bluetooth arrivano da pochi metri. Avvicinala e rilancia." >&2
  exit 1
fi

echo
echo "Le Victron che sento:"
INDIRIZZI=()
NOMI=()
N=0
while IFS=$'\t' read -r MAC NOME; do
  [ -z "$MAC" ] && continue
  N=$((N + 1))
  INDIRIZZI+=("$MAC")
  NOMI+=("$NOME")
  printf "  %d) %s   (%s)\n" "$N" "${NOME:-senza nome}" "$MAC"
done <<< "$SENTITI"

echo
read -r -p "Quale? Il numero: " SCELTA
# Un numero e basta: `[0-9]` e non `-gt`, perche' con una lettera `-gt` da'
# errore e con `set -e` lo script muore senza dire perche'.
case "$SCELTA" in
  ''|*[!0-9]*) echo "!! «$SCELTA» non e' un numero. Non ho scritto niente." >&2; exit 1 ;;
esac
if [ "$SCELTA" -lt 1 ] || [ "$SCELTA" -gt "$N" ]; then
  echo "!! Nell'elenco ci sono i numeri da 1 a $N. Non ho scritto niente." >&2
  exit 1
fi
MAC="$(printf '%s' "${INDIRIZZI[$((SCELTA - 1))]}" | tr 'A-Z' 'a-z')"
NOME="${NOMI[$((SCELTA - 1))]}"

echo
echo "Apparecchio scelto: ${NOME:-$MAC}"
read -r -s -p "Chiave di cifratura (non si vedra'): " CHIAVE
echo
# Gli spazi: la chiave si copia dal telefono e l'incollaggio porta spesso un
# ritorno a capo o uno spazio in coda.
CHIAVE="$(printf '%s' "$CHIAVE" | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
if ! [[ "$CHIAVE" =~ ^[0-9a-f]{32}$ ]]; then
  echo "!! Una chiave Victron e' lunga 32 caratteri esadecimali (le cifre e le" >&2
  echo "   lettere da a a f). Questa ne ha ${#CHIAVE}, o contiene altro." >&2
  echo "   Non ho scritto niente: ricopiala da VictronConnect e rilancia." >&2
  exit 1
fi

# La chiave arriva al python dall'ambiente, non dagli argomenti. E la scrittura
# e' atomica: file temporaneo accanto all'originale e poi `os.replace`, cosi'
# una scatoletta che perde corrente a meta' non si ritrova un config.json
# tagliato in due.
CHIAVE_VICTRON="$CHIAVE" MAC_VICTRON="$MAC" CONFIG_VICTRON="$CONFIG" python3 - <<'PYTHON'
import json
import os
import stat
from pathlib import Path

conf = Path(os.environ["CONFIG_VICTRON"])
dati = json.loads(conf.read_text())
dati.setdefault("victron", {})[os.environ["MAC_VICTRON"]] = os.environ["CHIAVE_VICTRON"]

try:
    modo = stat.S_IMODE(conf.stat().st_mode)
except OSError:
    modo = 0o600
temporaneo = conf.with_name(conf.name + ".nuovo")
temporaneo.write_text(json.dumps(dati, indent=2, ensure_ascii=False) + "\n")
os.chmod(temporaneo, modo)
os.replace(temporaneo, conf)
PYTHON
unset CHIAVE

echo
echo "Scritta. Le Victron configurate adesso:"
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for k in (d.get('victron') or {}):
    if not k.startswith('_'):
        print('  -', k)
" "$CONFIG"

# L'agente legge config.json una volta sola, all'avvio: senza riavvio la chiave
# nuova non la vede fino al prossimo riavvio della scatoletta.
if command -v systemctl >/dev/null 2>&1; then
  echo
  echo "L'agente legge la configurazione solo all'avvio: lo riavvio."
  sudo systemctl restart scatoletta && echo "   riavviato"
  echo
  echo "Fra un minuto il diario dira' se la chiave e' sua:"
  echo "   journalctl -u scatoletta -f"
fi
