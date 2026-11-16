# Camper Servizi

Gli impianti del camper, consultabili da lontano. Sta a parte dall'app dei
viaggi: quella racconta dove si è stati, questa risponde a *quanta corrente c'è
adesso e quanto durerà*. Il disegno completo è in
[`../docs/camper-servizi-disegno.md`](../docs/camper-servizi-disegno.md); quel
che si legge di ogni apparecchio e come, in
[`../docs/telemetria-camper.md`](../docs/telemetria-camper.md).

## Le due regole che la tengono in piedi

**Un valore che manca si scrive «—», mai zero.** Su una carica, zero vuol dire
*scarica*. Un cruscotto che riempie i buchi con degli zeri è peggio di un
cruscotto spento, perché sembra funzionare.

**Ogni conto dichiara la sua provenienza:** `misurato` se i numeri vengono dal
tuo impianto, `stima` se almeno uno viene da un catalogo, `incompleto` con
scritto *quale* dato manca. Il 16 novembre 2026 l'Orion XS dichiarava di
erogare 6 A mentre le batterie ne ricevevano 26, per via di un relè che nessun
depliant conosce: da lì viene questa regola.

## Cosa parla, e cosa no

| | come | da lontano |
|---|---|---|
| Bluetti Elite 300 | cloud Bluetti (OAuth2 + REST) | **sì** |
| Ective ×2, SmartSolar, Orion XS | Bluetooth | serve la scatoletta in camper |
| Centrale d'allarme | rete locale del camper | serve la scatoletta |
| Starlink | rete del piatto | serve la scatoletta |

Gli apparecchi non ancora collegati **compaiono lo stesso in pagina**, con
scritto perché tacciono. Non mostrano numeri: sarebbero vecchi di settimane.

## Come si configura

Variabili del servizio:

| | |
|---|---|
| `DATABASE_URL` | riferimento al PostgreSQL |
| `APP_SECRET` | segreto dei cookie di sessione |
| `LETTURE_MINUTI` | passo delle letture periodiche (15 di fabbrica, 0 le spegne) |

**I gettoni Bluetti non stanno fra le variabili.** Si preme *Collega la
Bluetti* dentro l'app: si apre la pagina di Bluetti, si dice «Agree», e il
gettone torna indietro e finisce in archivio. Così nessun segreto passa da una
configurazione, da una ripubblicazione o da una conversazione — e quando fra un
mese scade, si ricollega con un tasto invece che con un deploy.

La pagina di Bluetti dirà **HomeAssistant** e parlerà di controllo a voce: è la
porta pubblica che Bluetti tiene aperta per quell'integrazione, ed è l'unica
che esiste. Il permesso comprende anche il comando, non solo la lettura.

## Il primo avvio

La prima persona che apre l'app crea il proprio accesso; dopo, la registrazione
si chiude. Un'app con la registrazione aperta su internet prima o poi ospita
qualcuno che non hai invitato.

## Tre cose che non sono ovvie

1. **L'elenco degli apparecchi Bluetti restituisce i valori sempre a zero.** È
   il catalogo di cosa l'apparecchio *sa dire*, non i suoi numeri.
2. **I numeri arrivano solo dopo `bindDevices`.** Senza quel passaggio il cloud
   risponde «spento, lista vuota» e sembra un guasto. L'app lo fa da sola
   appena collegata.
3. **Il loro `bindDevices` risponde «OK» anche a un seriale inventato.** La
   prova che è andata è che dopo arrivino i numeri, non la risposta.

## Da fare quando arriva la scatoletta

Un Raspberry Pi Zero 2 W in camper, alimentato da una presa a 12 V esistente
(nessun intervento sull'impianto). Leggerà via Bluetooth le Ective, lo
SmartSolar e l'Orion XS, e in locale la centrale d'allarme, mandando qui le
misure. I decodificatori sono già scritti e provati sul campo: Ective e Victron
in `../docs/telemetria-camper.md`.
