#!/bin/bash
# Riavvia l'agente della scatoletta. Si lancia DAL MAC, dentro questa cartella:
#
#     bash riavvia.sh
#
# Perche' esiste. Il 19/11/2026 l'indirizzo della scatoletta e' cambiato quattro
# volte in due ore -- .163, .166, .172, .173 -- perche' col segnale al 30% il
# WiFi si stacca e si riattacca, e il router gliene da' uno nuovo ogni volta.
# Ogni volta il proprietario ha dovuto ribattere a mano una riga diversa, con
# l'indirizzo giusto dentro; e due volte la password e' finita scritta in chiaro
# nel terminale, battuta un istante prima o un istante dopo la richiesta.
#
# Battere comandi e' la parte piu' faticosa, per lui. Quindi la riga si
# accorcia a una parola e l'indirizzo lo cerca lo script.
#
# Come lo cerca: l'impronta della radio e' fissa anche quando l'indirizzo
# cambia. Si sveglia la rete con un giro di ping -- senza, la tabella ARP del
# Mac non sa niente degli apparecchi con cui non ha parlato di recente -- e poi
# si cerca quell'impronta. Funziona solo col Mac attaccato alla rete 10.10.3.x
# o a una che il router instrada verso di lei; `.local` non serve, perche' mDNS
# non attraversa le sottoreti.
#
# Il rimedio definitivo non e' questo script: e' riservare l'indirizzo sul
# router legandolo all'impronta. Finche' non e' fatto, questo lo supplisce.
set -uo pipefail

IMPRONTA="98:fe:54:9e:a9"      # wlan0 del Raspberry della scatoletta
RETE="10.10.3"
UTENTE="metz"

echo "== Riavvio dell'agente della scatoletta =="
echo "La cerco sulla rete $RETE.x ..."

# Il ping serve a riempire la tabella ARP, non a sapere chi risponde: molti
# apparecchi non rispondono al ping e si vedono comunque in ARP.
for n in $(seq 2 254); do ping -c 1 -W 80 "$RETE.$n" >/dev/null 2>&1 & done
wait 2>/dev/null

# L'impronta si confronta senza badare alle maiuscole, e senza pretendere gli
# zeri davanti: `arp` su macOS stampa 9e:a9:9 dove il sistema ne direbbe
# 9e:a9:09. Cercare la forma con lo zero non troverebbe niente.
TROVATA=$(arp -an 2>/dev/null | grep -i "$IMPRONTA" | sed -n 's/.*(\([0-9.]*\)).*/\1/p' | head -1)

if [ -z "$TROVATA" ]; then
  echo "!! Non la trovo sulla rete $RETE.x: non riavvio niente." >&2
  echo "   Un indirizzo vecchio appartiene magari a un altro apparecchio," >&2
  echo "   e un riavvio mandato alla cieca e' il modo di scoprire di aver" >&2
  echo "   riavviato il televisore." >&2
  echo >&2
  echo "   Da controllare: che la scatoletta sia alimentata, e che il Mac stia" >&2
  echo "   sulla WiFi di casa e non su un'altra rete." >&2
  exit 1
fi

echo "Trovata: $TROVATA"
echo "Ora chiede la password di $UTENTE. Non si vedra' mentre la batti."
echo
# `-t` perche' sudo la password la chiede su un terminale vero: senza, lo
# script muore senza spiegare e sembra un guasto della scatoletta.
ssh -t "$UTENTE@$TROVATA" sudo systemctl restart scatoletta || {
  echo "!! Il riavvio non e' andato. Se ha detto «timed out», il collegamento" >&2
  echo "   WiFi era giu' in quell'istante: rilancia." >&2
  exit 1
}

echo
echo "Riavviata. Rilegge config.json a ogni giro, quindi da adesso i cambiamenti"
echo "di configurazione non chiedono piu' ne' riavvii ne' password."
