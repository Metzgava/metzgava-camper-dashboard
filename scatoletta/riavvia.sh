#!/bin/bash
# Riavvia l'agente della scatoletta. Si lancia DAL MAC, dentro questa cartella:
#
#     bash riavvia.sh
#
# Perche' esiste. Il 19/11/2026 l'indirizzo della scatoletta e' cambiato quattro
# volte in due ore -- .163, .166, .172, .173 -- perche' col segnale al 30% il
# WiFi si stacca e si riattacca, e il router gliene da' uno nuovo ogni volta.
# Ogni volta il proprietario ha dovuto ribattere a mano una riga diversa con
# l'indirizzo giusto dentro; due volte la password e' finita scritta in chiaro
# nel terminale per un errore di tempismo, e due volte il comando e' andato in
# timeout dopo che l'aveva battuta.
#
# Battere comandi e' la parte piu' faticosa, per lui. Quindi la riga si accorcia
# a una parola e l'indirizzo lo cerca lo script.
#
# **Come NON si cerca: dalla tabella ARP.** E' stata la prima stesura, ed era
# sbagliata: ARP vive dentro una sola sottorete. Il Mac sta su 10.10.2.x e la
# scatoletta su 10.10.3.x, e quella tabella mostra il MAC del router al posto
# del suo. Lo script diceva «non la trovo» mentre la scatoletta era
# raggiungibile e mandava dati.
#
# Si cerca invece chi risponde sulla porta SSH, e poi **gli si chiede come si
# chiama**: cosi' l'identita' e' verificata e non indovinata. Su una rete di
# casa ci sono stampanti, dischi di rete, televisori; riavviare «il primo che
# risponde sulla 22» e' il modo di scoprire di aver riavviato qualcos'altro.
# E la domanda passa dalla nostra chiave, che quegli altri non hanno.
#
# Il rimedio definitivo resta un altro: riservare l'indirizzo sul router
# legandolo all'impronta della radio, 98:fe:54:9e:a9:09. Finche' non e' fatto,
# questo lo supplisce.
set -uo pipefail

RETE="${RETE:-10.10.3}"
UTENTE="${UTENTE:-metz}"
NOME="${NOME:-bergava-scatoletta}"
SSH_ZITTO=(-o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new)

echo "== Riavvio dell'agente della scatoletta =="
echo "Cerco chi risponde su $RETE.x ..."

# Prima chi ha la porta aperta. In parallelo, a gruppi: aprire 253 processi in
# una volta su macOS fa inciampare la shell.
# Prima chi ha la porta aperta. In parallelo a gruppi: aprire 253 processi in
# una volta su macOS fa inciampare la shell.
CANDIDATI=$(
  for gruppo in 0 1 2 3 4; do
    INIZIO=$((gruppo * 51 + 2))
    for n in $(seq "$INIZIO" $((INIZIO + 50))); do
      [ "$n" -gt 254 ] && continue
      ( nc -z -G 2 "$RETE.$n" 22 >/dev/null 2>&1 && echo "$RETE.$n" ) &
    done
    wait
  done | sort -u
)

if [ -z "${CANDIDATI// }" ]; then
  echo "!! Nessuno risponde su $RETE.x: non riavvio niente." >&2
  echo "   Da controllare: che la scatoletta sia alimentata, e che il Mac sia" >&2
  echo "   sulla WiFi di casa." >&2
  exit 1
fi

# Poi chi di loro e' lei. Si chiede, non si indovina.
TROVATA=""
for IND in $CANDIDATI; do
  COME=$(ssh "${SSH_ZITTO[@]}" "$UTENTE@$IND" hostname 2>/dev/null | tr -d '\r' | head -1)
  if [ "$COME" = "$NOME" ]; then TROVATA="$IND"; break; fi
done

if [ -z "$TROVATA" ]; then
  echo "!! Ho trovato qualcuno sulla rete, ma nessuno di nome $NOME:" >&2
  echo "   non riavvio niente. Un riavvio mandato alla cieca e' il modo di" >&2
  echo "   scoprire di aver riavviato il televisore." >&2
  echo >&2
  echo "   Quasi sempre vuol dire che il suo WiFi era giu' in questo istante:" >&2
  echo "   rilancia fra un minuto." >&2
  exit 1
fi

echo "Trovata: $TROVATA  ($NOME)"
echo "Ora chiede la password di $UTENTE. Non si vedra' mentre la batti."
echo
# `-t` perche' sudo la password la chiede su un terminale vero: senza, lo
# script muore senza spiegare e sembra un guasto della scatoletta.
ssh -t "$UTENTE@$TROVATA" sudo systemctl restart scatoletta || {
  echo "!! Il riavvio non e' andato. Se ha detto «timed out», il collegamento" >&2
  echo "   era giu' in quell'istante: rilancia." >&2
  exit 1
}

echo
echo "Riavviata. Da adesso rilegge config.json a ogni giro, quindi i cambiamenti"
echo "di configurazione non chiedono piu' ne' riavvii ne' password."
