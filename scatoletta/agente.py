#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
La scatoletta: quel che sta in camper e racconta fuori.

Legge gli apparecchi che parlano solo da vicino e manda le misure a Camper
Servizi. Gira su un Raspberry Pi Zero 2 W alimentato da una presa a 12 V.

Tre regole, che sono le stesse della pagina:

1. **Un valore che non si sa non si inventa.** Un apparecchio che non risponde
   viene saltato: non manda zeri.
2. **Una lettura fuori scala non si spedisce.** Quasi sempre vuol dire che un
   decodificatore ha perso un byte, e il server la rifiuterebbe comunque.
3. **Quel che non si riesce a spedire si tiene in tasca.** Il 4G del camper
   cade: una lettura in coda e' una lettura salvata.

Il giro completo dura meno di due minuti e si ripete. Fra un giro e l'altro la
radio tace: non serve tenere connessioni aperte, e meno radio vuol dire meno
corrente e meno occasioni di impuntarsi.
"""

import asyncio
import datetime
import json
import logging
import os
import socket
import sys
import time
from pathlib import Path

QUI = Path(__file__).resolve().parent
CONFIG = Path(os.environ.get("AGENTE_CONFIG", QUI / "config.json"))

from blink import leggi_blink  # noqa: E402  (dopo QUI, che gli serve)
CODA = Path(os.environ.get("AGENTE_CODA", QUI / "coda.jsonl"))
CODA_MAX = 5000                      # righe: oltre, si buttano le piu' vecchie

log = logging.getLogger("scatoletta")


# ----------------------------------------------------------------------------
# Victron: gli annunci cifrati
# ----------------------------------------------------------------------------
#
# I Victron non si fanno interrogare: gridano. Dentro l'annuncio Bluetooth,
# sotto l'identificativo 0x02E1, c'e' un pacchetto cifrato in AES-128-CTR con
# una chiave che si legge una volta dall'app VictronConnect.
#
# Il byte 9 e' la salvaguardia: **deve essere uguale al primo byte della
# chiave**. Se non lo e', la chiave non e' di quell'apparecchio e non si
# stampa niente. Un valore sbagliato e' peggio di un valore assente, perche'
# sembra una misura.

VICTRON_ID = 0x02E1

def _nn(v, sentinella):
    return None if v == sentinella else v

def victron_decifra(dati: bytes, chiave_hex: str):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    if len(dati) < 10 or dati[0] != 0x10:
        return None                                   # non e' il lettore istantaneo
    modello = int.from_bytes(dati[2:4], "little")
    tipo = dati[4]
    contatore = dati[5:7]
    verifica = dati[7]
    chiave = bytes.fromhex(chiave_hex)
    if len(chiave) != 16 or verifica != chiave[0]:
        return None                                   # chiave di un altro apparecchio
    iv = contatore + b"\x00" * 14
    c = Cipher(algorithms.AES(chiave), modes.CTR(iv)).decryptor()
    return modello, tipo, c.update(dati[8:]) + c.finalize()

STATI_VICTRON = {0: "spento", 2: "guasto", 3: "massa (bulk)", 4: "assorbimento",
                 5: "mantenimento", 7: "equalizzazione", 245: "in attesa", 247: "in avvio"}

def victron_solare(d: bytes):
    if len(d) < 12:
        return None
    volt = _nn(int.from_bytes(d[2:4], "little", signed=True), 0x7FFF)
    amp = _nn(int.from_bytes(d[4:6], "little", signed=True), 0x7FFF)
    return {
        "stato": STATI_VICTRON.get(d[0], f"codice {d[0]}"),
        "volt": None if volt is None else volt / 100,
        "ampere": None if amp is None else amp / 10,
        "resa_oggi_kwh": int.from_bytes(d[6:8], "little") / 100,
        "pannelli_w": int.from_bytes(d[8:10], "little"),
    }

def victron_orion(d: bytes):
    if len(d) < 10:
        return None
    a_v = _nn(int.from_bytes(d[2:4], "little", signed=True), 0x7FFF)
    a_a = _nn(int.from_bytes(d[4:6], "little", signed=True), 0x7FFF)
    b_v = _nn(int.from_bytes(d[6:8], "little", signed=True), 0x7FFF)
    b_a = _nn(int.from_bytes(d[8:10], "little", signed=True), 0x7FFF)
    return {
        "stato": STATI_VICTRON.get(d[0], f"codice {d[0]}"),
        # Il 16/11/2026, a motore acceso: il lato A stava a 14,21 V con 6,0 A e
        # il lato B a 13,87 V con 6,3 A. Dentro 87,4 W, fuori 85,3 W: rendimento
        # 97,6 %, che e' il dato di targa. Da li' si sa qual e' l'uscita.
        "uscita_volt": None if a_v is None else a_v / 100,
        "uscita_ampere": None if a_a is None else a_a / 10,
        "ingresso_volt": None if b_v is None else b_v / 100,
        "ingresso_ampere": None if b_a is None else b_a / 10,
    }


# ----------------------------------------------------------------------------
# I termometri: la via piu' facile di tutte
# ----------------------------------------------------------------------------
#
# Niente cavi, niente accoppiamento, niente che si colleghi: questi cosi
# **gridano** temperatura e umidita' ogni pochi secondi, e la scatoletta sta
# li' ad ascoltare mentre gia' ascolta i Victron. Stesso giro, zero lavoro in
# piu', e la pila dura un anno.
#
# Due formati, perche' due firmware:
#   - BTHome v2 (servizio 0xFCD2), quello attuale;
#   - ATC, il vecchio formato (servizio 0x181A), ancora diffusissimo.
# Entrambi in chiaro: nessuna chiave da gestire.

BTHOME = "0000fcd2-0000-1000-8000-00805f9b34fb"
ATC = "0000181a-0000-1000-8000-00805f9b34fb"

def bthome_leggi(d: bytes):
    """BTHome v2 non cifrato. Si cammina sugli oggetti, saltando quelli che non
    interessano: cosi' un firmware che ne aggiunge uno nuovo non rompe tutto."""
    if len(d) < 3 or (d[0] & 0x01):           # bit 0 acceso = cifrato
        return None
    LUNGH = {0x00: 1, 0x01: 1, 0x02: 2, 0x03: 2, 0x04: 3, 0x05: 3, 0x0C: 2, 0x2E: 1, 0x2F: 1}
    out, i = {}, 1
    while i < len(d):
        tipo = d[i]
        n = LUNGH.get(tipo)
        if n is None or i + 1 + n > len(d):
            break
        g = d[i + 1:i + 1 + n]
        if tipo == 0x02:
            out["temperatura"] = int.from_bytes(g, "little", signed=True) / 100
        elif tipo == 0x03:
            out["umidita"] = int.from_bytes(g, "little") / 100
        elif tipo == 0x2E:
            out["umidita"] = g[0]
        elif tipo == 0x01:
            out["pila"] = g[0]
        i += 1 + n
    return out or None

def atc_leggi(d: bytes):
    """Il formato ATC: 13 byte (pvvx, byte invertiti) o 15 (ATC1441)."""
    if len(d) == 13:
        return {"temperatura": int.from_bytes(d[6:8], "little", signed=True) / 100,
                "umidita": int.from_bytes(d[8:10], "little") / 100,
                "pila": d[12]}
    if len(d) == 15:
        return {"temperatura": int.from_bytes(d[6:8], "big", signed=True) / 10,
                "umidita": d[8], "pila": d[9]}
    return None


# ----------------------------------------------------------------------------
# SwitchBot: il termometro che parla da solo
# ----------------------------------------------------------------------------
#
# I SwitchBot trasmettono in chiaro, senza accoppiamento, senza account e
# senza cloud: la scatoletta li sente passando. E' il piu' facile di tutti gli
# apparecchi di questo camper, e nello stesso pacchetto arriva anche la carica
# della sua pila.
#
# L'Outdoor Meter (WoSensorTHO, modello W3400010) ha fama di essere
# l'eccezione della famiglia, e lo e' per i dati di SERVIZIO: gli altri Meter
# ci mettono temperatura e umidita', lui no. Ma nei dati del COSTRUTTORE sta
# come tutti gli altri — e la fama viene da come e' scritta la tabella.
#
# La documentazione di SwitchBot, nella sezione dell'Outdoor, indicizza i byte
# **contando anche i due byte dell'azienda** (0x6909), e scrive quindi
# data[10], data[11], data[12]. bleak invece consegna il payload con quei due
# byte gia' togliati, dove gli stessi campi stanno a 8, 9, 10: che sono
# esattamente gli offset della tabella generale dei Meter. Verificato sul
# campione pubblicato: 22,2 gradi e 55 %.
#
# La batteria sta nei dati di servizio. Anche li' la doc conta diversamente
# (dice «byte 5» includendo il tipo 0x16); con il payload che da' bleak e' il
# byte 2, che e' quel che dice la tabella generale.

SWITCHBOT_ID = 0x0969          # dal firmware Meter V2.7; prima era 0x0059
SWITCHBOT_ID_VECCHIO = 0x0059
SWITCHBOT_SRV = "0000fd3d-0000-1000-8000-00805f9b34fb"


def switchbot_leggi(costruttore, servizio=None):
    """Temperatura, umidita' e carica della pila di un termometro SwitchBot.

    `costruttore` e' manufacturer_data[0x0969] come lo da' bleak, cioe' senza
    i due byte dell'azienda. `servizio` e' service_data[fd3d], senza l'UUID:
    serve solo per la pila, e se manca si legge il resto.
    """
    if not costruttore or len(costruttore) < 11:
        return None
    # bit 3-0: i decimi di grado. bit 7 del byte dopo: il segno, dove 1 e'
    # positivo — al contrario di quasi tutti gli altri protocolli, e questo e'
    # il modo tipico di leggere -22 invece di +22.
    gradi = (costruttore[8] & 0x0F) * 0.1 + (costruttore[9] & 0x7F)
    if not costruttore[9] & 0x80:
        gradi = -gradi
    # bit 7 dell'umidita' dice in che unita' il DISPLAY mostra i gradi. Non
    # c'entra col valore: senza mascherarlo, un 55 % diventa 183 %.
    letto = {"temperatura": round(gradi, 1), "umidita": costruttore[10] & 0x7F}
    if servizio and len(servizio) >= 3:
        letto["pila"] = servizio[2] & 0x7F
    return letto


# ----------------------------------------------------------------------------
# Ective: il testo che arriva a pezzi
# ----------------------------------------------------------------------------
#
# Le batterie **non** parlano il protocollo binario JBD, che era la prima
# ipotesi e la piu' naturale. Mandano da sole, senza che si chieda niente,
# pezzetti di TESTO sulla caratteristica FFE4: cifre esadecimali scritte come
# lettere ASCII. Rimessi in fila formano un record che comincia con «^».
#
# Trappola costata mezz'ora: il nome Bluetooth delle Ective contiene un byte
# invisibile (0x11) dopo le cifre. Un confronto che pretende il nome esatto
# non trova niente.

FFE4 = "0000ffe4-0000-1000-8000-00805f9b34fb"


# La scala credibile di quel che manda un termometro. Sono gli stessi limiti
# che il server applica in `AMMESSE` (servizi/src/routes/ingresso.js): la
# scatoletta non deve essere piu' severa di lui, o scarterebbe letture che
# l'archivio prenderebbe.
#
# Perche' il controllo serve anche qui, se il server ce l'ha. Perche' lui lo fa
# a meta': rifiuta la misura fuori scala nello storico e scrive comunque
# l'istantanea, che e' quel che l'app mostra nel riquadro «adesso». Il 19/11 un
# sensore diceva 127.0 gradi -- il valore che quei sensori mandano quando non
# hanno una lettura -- e se fosse stato uno dei nostri sarebbe finito sotto gli
# occhi. La regola 2 dice che una lettura fuori scala non si spedisce: questa e'
# la riga che la scrive.
SCALA = {
    "temperatura": (-40, 90),
    "umidita": (0, 100),
    "pila": (0, 100),
    "rssi": (-120, 0),
}


def fuori_scala(letto):
    """Le grandezze di questa lettura che dicono cose impossibili.

    Torna una lista di `(grandezza, valore)`, vuota se la lettura e' credibile.
    Una grandezza senza scala non ferma niente: i sensori mandano anche cose
    che non spediamo, e non avere un limite per loro non e' un motivo per
    buttare la temperatura.
    """
    fuori = []
    for grandezza, valore in letto.items():
        limiti = SCALA.get(grandezza)
        if not limiti:
            continue
        try:
            v = float(valore)
        except (TypeError, ValueError):
            fuori.append((grandezza, valore))
            continue
        if v < limiti[0] or v > limiti[1]:
            fuori.append((grandezza, valore))
    return fuori


def termometri_scelti(sentiti, nomi):
    """Divide i termometri sentiti in tre: nostri, estranei, assurdi.

    `sentiti` e' quel che arriva dall'ascolto: indirizzo -> (nome, letture).
    `nomi` e' l'elenco di `config.json`: indirizzo -> come lo chiami tu.

    Si spediscono solo quelli in elenco. Gli altri non si buttano in silenzio:
    tornano fra gli `estranei` per finire nel diario, perche' quando comprerai
    i tuoi termometri l'unico modo di scoprire il loro indirizzo e' sentirli.

    Gli `assurdi` sono i nostri che dicono cose impossibili: tornano come
    `(indirizzo, etichetta, letto, fuori)` dove `fuori` elenca le grandezze
    sbagliate e il loro valore -- nel diario «fuori scala» senza il numero non
    dice se e' il sensore che tace o il decodificatore che ha perso un byte.

    Di un assurdo si butta **tutta** la lettura, non solo il valore sbagliato:
    un byte perso sposta i byte dopo, e l'umidita' di un pacchetto con la
    temperatura sbagliata non e' piu' attendibile di lei.

    Un estraneo che dice assurdita' resta un estraneo: e' il caso vero del
    19/11, e «non e' tuo» e' il motivo piu' utile da leggere nel diario.
    """
    elenco = {k.lower(): v for k, v in (nomi or {}).items()}
    nostri, estranei, assurdi = [], [], []
    for indirizzo, (nome, letto) in sentiti.items():
        etichetta = elenco.get(indirizzo.lower())
        if not etichetta:
            estranei.append((indirizzo, nome or indirizzo, letto))
            continue
        fuori = fuori_scala(letto)
        if fuori:
            assurdi.append((indirizzo, etichetta, letto, fuori))
        else:
            nostri.append((indirizzo, etichetta, letto))
    return nostri, estranei, assurdi

def pacco_termometro(indirizzo, etichetta, letto, forza):
    """Il pacchetto di un termometro, come lo aspetta il server.

    **Il tipo e il nome si scrivono due volte**, e non e' una ripetizione per
    sbaglio: nell'istantanea il server conserva soltanto `dati`, e l'istantanea
    e' quel che l'app mostra nel riquadro «adesso». Un `tipo` scritto solo
    accanto a `dati` serve allo storico e **non arriva mai in pagina**.

    Il 19/11/2026 e' costato una sezione «Temperature» che diceva «nessun
    termometro in elenco» mentre i tre termometri mandavano regolarmente: il
    filtro della pagina cercava `dati.tipo`, che non c'era. Blink lo scrive due
    volte dal primo giorno; i termometri no, e nessuno se ne era accorto perche'
    nessuna pagina li guardava ancora.

    In `misure` vanno solo i numeri da mettere in archivio: `tipo` e `nome` non
    sono grandezze, e il server li scarterebbe con una riga negli eventi a ogni
    giro -- com'e' successo all'umidita' per settimane.
    """
    misure = {k: v for k, v in letto.items()
              if k in ("temperatura", "umidita", "pila")}
    dati = dict(letto, tipo="termometro", nome=etichetta)
    if forza is not None:
        dati["rssi"] = forza
        misure["rssi"] = forza
    return {
        "id": "term-" + indirizzo.replace(":", "").lower(),
        "nome": etichetta,
        "tipo": "termometro",
        "dati": dati,
        "misure": misure,
    }


def _le(h: str, i: int, n: int, signed=False):
    """n byte a partire dal carattere i, byte invertiti."""
    b = bytes.fromhex(h[i:i + n * 2])
    return int.from_bytes(b, "little", signed=signed)

def ective_leggi(flusso: str):
    """Dal flusso di testo al record. None se non c'e' un record intero."""
    pezzi = [p for p in flusso.split("^")[1:] if len(p) >= 64]
    if not pezzi:
        return None
    p = pezzi[-1]
    try:
        celle = [_le(p, 44 + i * 4, 2) for i in range(4)]
        d = {
            "volt": _le(p, 0, 2) / 1000,
            "ampere": _le(p, 8, 4, signed=True) / 1000,
            "capacita_ah": _le(p, 16, 4) / 1000,
            "cicli": _le(p, 24, 2),
            "carica": _le(p, 28, 2),
            "temperatura": round(_le(p, 32, 2) / 10 - 273.15, 1),
            "celle_mv": celle,
            "celle_scarto_mv": max(celle) - min(celle),
        }
    except ValueError:
        return None
    d["watt"] = round(d["volt"] * d["ampere"], 1)
    # Una carica fuori da 0-100 o celle a zero vogliono dire che il flusso si e'
    # spezzato nel punto sbagliato: meglio buttare il record che crederci.
    if not (0 <= d["carica"] <= 100) or min(celle) == 0:
        return None
    return d


# ----------------------------------------------------------------------------
# Il giro della radio
# ----------------------------------------------------------------------------

async def ascolta_annunci(conf, secondi=None):
    """Solo ascolto: chi grida i suoi dati a chiunque passi.

    Victron e termometri mandano annunci ogni pochi secondi e non vanno
    interrogati. Questa fase non si collega a niente, e per questo puo' durare
    pochi secondi -- e' la base del giro svelto.
    """
    from bleak import BleakScanner

    trovati = {}
    chiavi = {k.lower(): v for k, v in (conf.get("victron") or {}).items()}
    prefissi_ective = conf.get("ective_prefissi") or ["NWJ"]

    # --- 1. gli annunci: passivi, senza collegarsi a niente ---
    annunci = {}

    termometri = {}

    # Quanto forte si sente ciascuno. Non e' una curiosita': e' il dato che
    # dice dove va montato il Raspberry. Un apparecchio che si sente a -90 dBm
    # oggi funziona e domani no, e senza misurarlo lo si scopre il giorno in
    # cui serviva. Si manda come tutto il resto, e la pagina lo mostra.
    potenze = {}

    def senti(dispositivo, dati):
        # getattr: nelle bleak vecchie il campo stava sul dispositivo, non
        # sull'annuncio. Senza, si perde la potenza e non il resto.
        forza = getattr(dati, "rssi", None)
        if forza is not None:
            potenze[dispositivo.address] = forza
        grezzo = (dati.manufacturer_data or {}).get(VICTRON_ID)
        if grezzo:
            annunci.setdefault(dispositivo.address, (dispositivo.name or "", grezzo))
        # I termometri: ultimo annuncio sentito, che e' il piu' fresco
        servizi = dati.service_data or {}
        costruttori = dati.manufacturer_data or {}
        letto = None
        if BTHOME in servizi:
            letto = bthome_leggi(servizi[BTHOME])
        elif ATC in servizi:
            letto = atc_leggi(servizi[ATC])
        else:
            # SwitchBot e' il solo che tiene temperatura e umidita' nei dati
            # del costruttore e la pila in quelli di servizio: vanno guardati
            # tutti e due, ed e' per questo che sta in un ramo suo.
            sb = costruttori.get(SWITCHBOT_ID) or costruttori.get(SWITCHBOT_ID_VECCHIO)
            if sb:
                letto = switchbot_leggi(sb, servizi.get(SWITCHBOT_SRV))
        if letto and "temperatura" in letto:
            termometri[dispositivo.address] = (dispositivo.name or "", letto)

    scanner = BleakScanner(detection_callback=senti)
    await scanner.start()
    # Quanto si ascolta. Il giro lento si prende i suoi dodici secondi; quello
    # svelto ne chiede meno, perche' deve stare dentro un passo da dieci. Si
    # perde qualche annuncio, ma chi grida ogni due o tre secondi lo si
    # risente al giro dopo -- che adesso e' fra dieci secondi, non fra due
    # minuti.
    await asyncio.sleep(secondi or conf.get("secondi_annunci", 12))
    await scanner.stop()

    for indirizzo, (nome, grezzo) in annunci.items():
        chiave = chiavi.get(indirizzo.lower()) or chiavi.get((nome or "").lower())
        if not chiave:
            log.info("annuncio Victron da %s senza chiave: lo lascio stare", nome or indirizzo)
            continue
        esito = victron_decifra(grezzo, chiave)
        if not esito:
            log.warning("%s: la chiave non e' sua, oppure il record non e' il lettore istantaneo", nome)
            continue
        _modello, tipo, chiaro = esito
        if tipo == 0x01:
            d = victron_solare(chiaro)
            misure = {k: d[k] for k in ("volt", "ampere", "pannelli_w", "resa_oggi_kwh") if d and d[k] is not None}
        elif tipo == 0x0F:
            d = victron_orion(chiaro)
            misure = {}
            if d:
                if d["uscita_volt"] is not None:
                    misure["volt"] = d["uscita_volt"]
                if d["uscita_ampere"] is not None:
                    misure["ampere"] = d["uscita_ampere"]
        else:
            log.info("%s: record 0x%02x non ancora letto", nome, tipo)
            continue
        if d:
            forza = potenze.get(indirizzo)
            if forza is not None:
                d = dict(d, rssi=forza)
                misure["rssi"] = forza
            trovati[nome or indirizzo] = {"id": nome or indirizzo, "nome": nome or indirizzo,
                                          "tipo": "victron", "dati": d, "misure": misure}

    # --- i termometri sentiti nello stesso ascolto ---
    # Solo i nostri: i sensori BTHome e ATC trasmettono in chiaro a chiunque
    # passi, e il primo giro col Bluetooth acceso ha raccolto quello di un
    # vicino. Gli estranei si scrivono nel diario e si scartano.
    nostri, estranei, assurdi = termometri_scelti(termometri,
                                                  conf.get("termometri"))
    for indirizzo, etichetta, _letto, fuori in assurdi:
        log.warning("lettura fuori scala, non spedita: %s (%s) — %s",
                    indirizzo, etichetta,
                    ", ".join(f"{g}={v}" for g, v in fuori))
    for indirizzo, nome, letto in estranei:
        t = letto.get("temperatura")
        log.info("termometro non in elenco, scartato: %s%s%s — se e' tuo, "
                 "aggiungilo a «termometri» in config.json",
                 indirizzo,
                 f" ({nome})" if nome and nome != indirizzo else "",
                 f" {t} gradi" if t is not None else "")
    for indirizzo, etichetta, letto in nostri:
        # `pila` entra nello storico insieme alle altre: una tensione che scende
        # e' quel che dice di cambiare la batteria prima che il sensore taccia.
        trovati[etichetta] = pacco_termometro(indirizzo, etichetta, letto,
                                              potenze.get(indirizzo))

    return trovati, potenze


async def giro_bluetooth(conf):
    """Il giro intero: gli annunci, poi le Ective -- che vanno interrogate."""
    from bleak import BleakScanner, BleakClient
    trovati, potenze = await ascolta_annunci(conf)
    prefissi_ective = conf.get("ective_prefissi") or ["NWJ"]

    # --- 2. le Ective: collegarsi e stare ad ascoltare ---
    vicini = await BleakScanner.discover(timeout=conf.get("secondi_ricerca", 8))
    for dispositivo in vicini:
        nome = (dispositivo.name or "").strip()
        if not any(nome.startswith(p) for p in prefissi_ective):
            continue
        pulito = "".join(ch for ch in nome if ch.isprintable())
        flusso = {"testo": ""}
        try:
            async with BleakClient(dispositivo, timeout=20) as cliente:
                def pezzo(_c, dati: bytearray):
                    flusso["testo"] += dati.decode("latin1")
                await cliente.start_notify(FFE4, pezzo)
                await asyncio.sleep(conf.get("secondi_ective", 20))
                await cliente.stop_notify(FFE4)
        except Exception as e:                        # noqa: BLE001
            log.warning("%s non si e' fatta leggere: %s", pulito, e)
            continue
        d = ective_leggi(flusso["testo"])
        if not d:
            log.warning("%s: nessun record intero in questo giro", pulito)
            continue
        trovati[pulito] = {
            "id": pulito, "nome": pulito, "tipo": "ective", "dati": d,
            "misure": {k: d[k] for k in ("carica", "volt", "ampere", "watt", "temperatura",
                                         "cicli", "capacita_ah", "celle_scarto_mv")},
        }

    return list(trovati.values())


# ----------------------------------------------------------------------------
# L'allarme, sulla rete di casa
# ----------------------------------------------------------------------------
#
# La centrale si legge in locale, protocollo 3.5. Il campo che conta e' il 32:
# «normal» oppure «alarm». In locale manda sempre gli stessi 21 campi e **il
# messaggio con la zona non c'e'**: quello la centrale lo spinge al cloud
# quando succede qualcosa.

def giro_allarme(conf):
    a = conf.get("allarme") or {}
    if not a.get("id") or not a.get("chiave"):
        return []
    try:
        import tinytuya
    except ImportError:
        log.info("tinytuya non installata: l'allarme si salta")
        return []
    indirizzo = a.get("ip") or trova_per_mac(a.get("mac"))
    if not indirizzo:
        log.warning("allarme: non trovo il suo indirizzo sulla rete")
        return []
    try:
        d = tinytuya.Device(a["id"], indirizzo, a["chiave"])
        d.set_version(float(a.get("protocollo", 3.5)))
        d.set_socketTimeout(6)
        r = d.status()
    except Exception as e:                            # noqa: BLE001
        log.warning("allarme muto: %s", e)
        return []
    dps = (r or {}).get("dps")
    if not dps:
        return []
    stato = dps.get("32")
    return [{
        "id": "allarme", "nome": "Centrale d'allarme", "tipo": "allarme",
        "dati": {
            "inserito": dps.get("1") != "disarmed",
            "modo": dps.get("1"),
            "scattato": stato == "alarm",
            "stato": stato,
            "batteria": dps.get("16"),
            "a_rete": dps.get("15"),
            "sim": dps.get("23"),
        },
        "misure": {"carica": dps.get("16")} if isinstance(dps.get("16"), (int, float)) else {},
    }]

def trova_per_mac(mac):
    """L'indirizzo IP e' prestato dal router e domani puo' cambiare; il MAC no."""
    if not mac:
        return None
    try:
        import re, subprocess
        tabella = subprocess.run(["arp", "-an"], capture_output=True, text=True, timeout=10).stdout
    except Exception:                                 # noqa: BLE001
        return None
    voluto = mac.lower().replace("-", ":")
    corto = ":".join(p.lstrip("0") or "0" for p in voluto.split(":"))
    for riga in tabella.splitlines():
        if voluto in riga.lower() or corto in riga.lower():
            m = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", riga)
            if m:
                return m.group(1)
    return None


# ----------------------------------------------------------------------------
# La spedizione, e la tasca per quando non si puo'
# ----------------------------------------------------------------------------

def in_coda(pacco):
    try:
        righe = CODA.read_text().splitlines() if CODA.exists() else []
    except OSError:
        righe = []
    righe.append(json.dumps(pacco))
    CODA.write_text("\n".join(righe[-CODA_MAX:]) + "\n")
    log.info("in tasca: %d pacchi in attesa", min(len(righe), CODA_MAX))

def spedisci(conf, pacco):
    import urllib.request
    dati = json.dumps(pacco).encode()
    richiesta = urllib.request.Request(
        conf["server"].rstrip("/") + "/api/ingresso", data=dati, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + conf["chiave"]})
    try:
        with urllib.request.urlopen(richiesta, timeout=25) as r:
            esito = json.loads(r.read())
        if esito.get("scartate"):
            log.warning("il server ne ha scartate %d", esito["scartate"])
        # Si restituisce la risposta intera, non un si/no: il server ci parla
        # da dentro la risposta alla nostra bussata. Resta vera anche come
        # condizione, perche' un dizionario pieno vale True e None vale False.
        return esito
    except Exception as e:                            # noqa: BLE001
        log.warning("non spedito: %s", e)
        return None

def svuota_coda(conf) -> int:
    if not CODA.exists():
        return 0
    righe = [r for r in CODA.read_text().splitlines() if r.strip()]
    rimaste, mandati = [], 0
    for i, r in enumerate(righe):
        try:
            pacco = json.loads(r)
        except json.JSONDecodeError:
            continue
        # Se la rete e' ancora giu' si smette subito: inutile insistere su
        # cento pacchi quando il primo non passa.
        if rimaste or not spedisci(conf, pacco):
            rimaste = righe[i:]
            break
        mandati += 1
    if rimaste:
        CODA.write_text("\n".join(rimaste) + "\n")
    else:
        CODA.unlink(missing_ok=True)
    return mandati


# ----------------------------------------------------------------------------

# ----------------------------------------------------------------------------
# Il vivo: due ritmi invece di uno
# ----------------------------------------------------------------------------
#
# Disegno: docs/superpowers/specs/2026-11-19-dal-vivo-design.md
#
# Il fatto che decide tutto non e' software, e' aritmetica: un giro completo
# dura piu' di un minuto, e quasi tutto quel tempo se ne va nei due
# collegamenti alle Ective. **Un giro da dieci secondi che legge tutto non
# esiste.**
#
# Quindi due ritmi. Il giro svelto ascolta solo chi grida -- Victron e
# termometri mandano annunci a chiunque passi -- e non si collega a niente. Il
# giro lento resta quello di sempre, con le Ective, l'allarme e le Blink.

SVELTO_MINIMO = 6        # sotto, i giri si accavallano: l'ascolto dura comunque
SVELTO_MASSIMO = 120     # oltre, non e' «svelto»: e' un errore del server


def passo_dal_server(risposta):
    """Quanti secondi fra un giro svelto e l'altro, o None per il proprio passo.

    `None` non vuol dire «fermati»: vuol dire **tieni il tuo passo**, quello di
    `config.json`. Il server non possiede un numero che non gli appartiene.

    Ogni risposta strana porta al lento: il passo svelto costa corrente alla
    batteria servizi, e nessuno se ne accorgerebbe finche' il camper non resta
    al buio.
    """
    if not isinstance(risposta, dict):
        return None
    valore = risposta.get("secondi")
    if isinstance(valore, bool) or not isinstance(valore, (int, float)):
        return None
    if valore != valore or valore <= 0 or valore > SVELTO_MASSIMO:   # NaN compreso
        return None
    return max(int(valore), SVELTO_MINIMO)


async def giro_svelto(conf, secondi_ascolto=5):
    """Un giro corto: solo gli annunci, e via.

    Non si collega a niente e non tocca ne' le webcam ne' la centrale: quelle
    stanno nel giro lento. Un giro svelto che si collegasse non si romperebbe
    -- rallenterebbe -- e un passo da dieci secondi con un minuto di
    collegamenti dentro vuol dire giri accavallati, radio sempre accesa e
    batteria che si svuota in silenzio.
    """
    trovati, _potenze = await ascolta_annunci(conf, secondi=secondi_ascolto)
    apparecchi = list(trovati.values())
    if not apparecchi:
        return None
    pacco = {"fonte": conf.get("nome", "scatoletta"), "apparecchi": apparecchi}
    return spedisci(conf, pacco)


async def un_giro(conf):
    apparecchi = []
    try:
        apparecchi += await giro_bluetooth(conf)
    except Exception as e:                            # noqa: BLE001
        log.error("il Bluetooth e' andato storto: %s", e)
    try:
        apparecchi += giro_allarme(conf)
    except Exception as e:                            # noqa: BLE001
        log.error("l'allarme e' andato storto: %s", e)
    # Le webcam Blink: una volta la settimana, e `leggi_blink` decide da se' se
    # e' ora — il piu' delle volte risponde con una lista vuota e non tocca la
    # rete. Sta nel suo `try` come le altre due, e il motivo qui conta piu'
    # che altrove: il Bluetooth e' la ragione per cui la scatoletta esiste,
    # Blink e' un extra. Un extra che facesse saltare il giro si porterebbe
    # via l'essenziale — e lo farebbe in silenzio, perche' un giro che non
    # manda niente non si vede.
    #
    # E le Blink non entrano nella taratura: quella stringe il passo fino a
    # cinque secondi, e una telecamera a batteria interrogata cosi' si scarica.
    # Non serve un paletto in piu': il freno dei sette giorni sta dentro
    # `leggi_blink`.
    try:
        # Con un tetto di tempo, non solo dentro un try. Il `try` ferma le
        # ECCEZIONI, non un blocco: se il cloud di Blink accetta la
        # connessione e poi tace, il giro si fermerebbe qui e le letture
        # Bluetooth gia' fatte non arriverebbero nemmeno in coda, perche'
        # `spedisci` sta piu' sotto. Due minuti sono larghi per una richiesta
        # settimanale e stretti rispetto al giro da cinque minuti.
        apparecchi += await asyncio.wait_for(leggi_blink(conf), 120)
    except asyncio.TimeoutError:
        log.error("Blink non ha risposto entro due minuti: lascio stare e tiro avanti")
    except Exception as e:                            # noqa: BLE001
        log.error("Blink e' andato storto: %s", e)

    if not apparecchi:
        log.info("niente da mandare in questo giro")
        return

    pacco = {"fonte": conf.get("nome", socket.gethostname()),
             "quando": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
             "apparecchi": apparecchi}
    log.info("letti %d apparecchi: %s", len(apparecchi), ", ".join(a["nome"] for a in apparecchi))
    risposta = spedisci(conf, pacco)
    if not risposta:
        in_coda(pacco)
        return None
    n = svuota_coda(conf)
    if n:
        log.info("recuperati %d pacchi dalla tasca", n)
    return risposta


# ----------------------------------------------------------------------------
# La taratura: leggere piu' spesso, per poco
# ----------------------------------------------------------------------------
#
# Durante una serata di taratura si accende un carico per volta e si guarda lo
# scalino nella corrente. Con un giro ogni cinque minuti non si vede: il
# campione arriva quando la luce e' gia' spenta. Il server, rispondendo alla
# nostra spedizione, puo' chiedere di stringere il passo.
#
# Si obbedisce, ma con due paletti nostri: **mai sotto cinque secondi** e **mai
# una scadenza piu' lontana di un'ora e mezza**. Un comando sbagliato dall'altra
# parte non deve poter tenere la radio accesa per giorni: consuma corrente dalle
# batterie e scrive sulla scheda di memoria, che e' il pezzo che si consuma.

TARATURA_MINIMO = 5
TARATURA_ORIZZONTE = 90 * 60

def passo_taratura(risposta):
    """I secondi fra un giro e l'altro chiesti dal server, o None."""
    t = (risposta or {}).get("taratura") or {}
    if not t.get("attiva"):
        return None
    try:
        scade = datetime.datetime.fromisoformat(str(t["scade"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        log.warning("taratura: scadenza illeggibile, la ignoro")
        return None
    resta = (scade - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
    if resta <= 0:
        return None
    if resta > TARATURA_ORIZZONTE:
        log.warning("taratura: scadenza troppo lontana (%.0f min), la ignoro", resta / 60)
        return None
    secondi = max(TARATURA_MINIMO, min(int(t.get("secondi") or 10), 60))
    log.info("taratura attiva: giro ogni %ds, ancora %.0f minuti", secondi, resta / 60)
    return secondi


# ----------------------------------------------------------------------------
# La configurazione, riletta a ogni giro
# ----------------------------------------------------------------------------
#
# Si leggeva una volta sola, all'avvio. Ogni cambiamento -- un termometro in
# piu', un nome da correggere, il passo da accorciare -- chiedeva un riavvio del
# servizio; un riavvio chiede `sudo`, e `sudo` chiede la password.
#
# Il 19/11/2026 questo e' costato due volte la stessa cosa: la password del
# proprietario finita scritta in chiaro nel terminale, battuta un istante prima
# o un istante dopo la richiesta. Non e' un difetto suo. E' un difetto di un
# apparecchio che pretende un riavvio per rileggere venti righe di testo.
#
# Rileggere costa una lettura di file ogni cinque minuti, cioe' niente. Ma una
# configurazione rotta non deve buttare via quella buona: il file si riscrive a
# mano, e un `{` dimenticato a meta' spedizione fermerebbe la scatoletta in
# camper, lontano da chi puo' sistemarla. Si tira avanti con l'ultima che
# funzionava, e lo si scrive nel diario.

PASSO_RISERVA = 300


def passo_di(conf):
    """Secondi fra un giro e l'altro, da `minuti`.

    Uno zero o un numero negativo vorrebbe dire radio sempre accesa e batteria
    servizi consumata in un giorno: si torna alla riserva invece di obbedire a
    un errore di battitura.
    """
    try:
        secondi = int(conf.get("minuti", 5)) * 60
    except (TypeError, ValueError):
        return PASSO_RISERVA
    return secondi if secondi > 0 else PASSO_RISERVA


def configurazione_fresca(precedente):
    """Rilegge `config.json`. Se non si puo', torna quella di prima."""
    try:
        letta = json.loads(CONFIG.read_text())
        if not isinstance(letta, dict):
            raise ValueError("non e' un oggetto")
        # Senza `server` o senza `chiave` non si saprebbe dove mandare le
        # letture: rotta quanto un JSON malformato, e si rifiuta allo stesso
        # modo.
        for necessaria in ("server", "chiave"):
            if not letta.get(necessaria):
                raise ValueError(f"manca «{necessaria}»")
    except Exception as e:                            # noqa: BLE001
        log.warning("config.json non si rilegge (%s): tiro avanti con "
                    "l'ultima buona", e)
        return precedente
    return letta


# La radio e' una sola: i due ritmi non possono scandire insieme. Chi arriva
# mentre l'altro ascolta **salta il proprio turno** invece di mettersi in coda:
# un giro svelto in ritardo di un minuto non e' piu' svelto, e accodarlo
# vorrebbe dire una raffica di giri arretrati appena la radio si libera.
RADIO = None


def chiede_il_vivo(conf):
    """Quanti secondi di passo chiede il server, o None.

    Una richiesta minuscola ogni quindici secondi. Il WiFi e' gia' acceso e
    una riga di HTTP e' una frazione di quel che costa una scansione
    Bluetooth -- ma il traffico lo paga il 4G del camper, quindi la risposta
    deve restare una riga.
    """
    import urllib.request
    indirizzo = conf["server"].rstrip("/") + "/api/ingresso/ritmo"
    richiesta = urllib.request.Request(
        indirizzo, headers={"Authorization": "Bearer " + conf["chiave"]})
    try:
        with urllib.request.urlopen(richiesta, timeout=8) as r:
            return passo_dal_server(json.loads(r.read()))
    except Exception:                                 # noqa: BLE001
        # Muto. **Si sbaglia verso il lento**: un guasto di rete non deve
        # lasciare la radio al massimo mentre il camper e' lontano.
        return None


async def ciclo_svelto(conf_viva):
    """Chiede ogni quindici secondi se qualcuno guarda, e se si' va svelto."""
    acceso = False
    while True:
        conf = conf_viva()
        passo = await asyncio.get_running_loop().run_in_executor(
            None, chiede_il_vivo, conf)
        if passo is None:
            if acceso:
                log.info("nessuno guarda piu': torno al passo normale")
            acceso = False
            await asyncio.sleep(15)
            continue
        if not acceso:
            log.info("qualcuno guarda: passo svelto, un giro ogni %d secondi", passo)
            acceso = True
        if RADIO.locked():
            # Il giro lento sta usando la radio: si salta, non si accoda.
            await asyncio.sleep(passo)
            continue
        async with RADIO:
            try:
                await giro_svelto(conf)
            except Exception as e:                    # noqa: BLE001
                log.warning("giro svelto fallito: %s", e)
        await asyncio.sleep(passo)


async def main():
    global RADIO
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not CONFIG.exists():
        log.error("manca %s: copia config.json.esempio e riempilo", CONFIG)
        sys.exit(1)
    RADIO = asyncio.Lock()
    conf = json.loads(CONFIG.read_text())
    passo = passo_di(conf)
    log.info("scatoletta avviata, un giro ogni %d minuti verso %s", passo // 60, conf["server"])
    # Il giro svelto vive a parte e non aspetta quello lento. Gli si passa una
    # funzione invece della configurazione, cosi' vede anche i cambiamenti
    # riletti dal giro lento senza doverseli passare a mano.
    asyncio.create_task(ciclo_svelto(lambda: conf))
    while True:
        inizio = time.time()
        risposta = None
        # Prima del giro, non dopo: cosi' un termometro aggiunto adesso entra
        # nel giro che comincia, e non in quello successivo.
        prima = passo
        conf = configurazione_fresca(conf)
        passo = passo_di(conf)
        if passo != prima:
            log.info("passo cambiato: un giro ogni %d minuti", passo // 60)
        try:
            async with RADIO:
                risposta = await un_giro(conf)
        except Exception as e:                        # noqa: BLE001
            log.exception("giro fallito: %s", e)
        # Il passo e' fra un inizio e l'altro, non fra una fine e l'altra:
        # cosi' un giro lento non sposta in avanti tutti quelli dopo.
        adesso = passo_taratura(risposta) or passo
        await asyncio.sleep(max(TARATURA_MINIMO, adesso - (time.time() - inizio)))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
