# Batterie delle webcam Blink — piano di attuazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Camper Servizi mostra sempre lo stato delle batterie delle telecamere Blink, lette dalla scatoletta una volta la settimana.

**Architecture:** Blink si legge **dalla scatoletta** con `blinkpy`, non dal server. Lo stato entra per il canale che la scatoletta ha gia' (`POST /api/ingresso` con la sua chiave), quindi il server non cambia e non vede mai la password Blink. Nel modulo nuovo le parti **pure** — che forma dare al pacco, se e' ora di leggere, come ripulire una telecamera — stanno separate dalla chiamata a `blinkpy`, che si importa **dentro** la funzione: cosi' le prove girano senza avere `blinkpy` installato, e il modulo si carica anche su una scatoletta appena preparata.

**Tech Stack:** Python 3.11 (la scatoletta), `blinkpy`, prove con `unittest` della libreria standard. Lato pagina: JS a mano, come il resto di `public/app.js`.

**Spec:** `docs/superpowers/specs/2026-11-17-blink-batterie-design.md` — **leggere anche la correzione del 17/11/2026 ore 09:50 in fondo**, che e' quella che decide questa forma. Il piano precedente, che leggeva Blink dal server, e' in `2026-11-17-blink-batterie-via-server-SUPERATO.md`: e' caduto perche' Blink ha ritirato `grant_type=password`.

## Global Constraints

- **La password Blink non si scrive mai**: non in un file, non nei log, non in un pacco. Si digita una volta sola alla preparazione, con `getpass` (che non la mostra a schermo), e quel che resta e' il gettone di `blinkpy`.
- I segreti della scatoletta stanno in `scatoletta/segreti/` — da aggiungere a `.gitignore` se non c'e' gia'.
- **Niente `BLINK_EMAIL` ne' `BLINK_PASSWORD` su Railway.** La correzione del disegno le annulla.
- **Una sola chiamata a `refresh()`**, dalla nostra parte. ATTENZIONE: il disegno e la prima stesura di questo piano dicevano «mai una chiamata per telecamera», e **non e' vero**. Letto in `blinkpy` (ramo `dev`): `SyncModule.refresh()` interroga i sensori telecamera per telecamera, e per quelle a batteria passa da `.../camera/<id>/signals` — proprio l'indirizzo che il disegno aveva escluso per nome. Una volta la settimana il costo e' accettabile, ma l'affermazione era falsa e qualcuno un giorno ci si appoggerebbe.
- Ritmo: **sette giorni**, e la data dell'ultima lettura sta in un **file**, non in memoria.
- Le Blink **non entrano nella taratura**: `passo_taratura` stringe il giro fino a cinque secondi, e una telecamera a batteria interrogata cosi' si scarica. Il freno dei sette giorni basta: non va aggiunto nient'altro, ma non va nemmeno aggirato.
- `battery_voltage` di `blinkpy` e' in **centesimi di volt** (165 = 1,65 V). `temperature` e' in **Fahrenheit**.
- La potenza del segnale va in `dati["segnale"]`, **non** in `dati["rssi"]`: la scheda del segnale della pagina pesca ogni istantanea con `dati.rssi`, ed e' per gli apparecchi del camper. Nelle `misure` invece `rssi` va bene, perche' quelle sono storia.
- Un guasto Blink **non deve far perdere le letture Bluetooth**: sta nel suo `try`, come le altre sorgenti di `un_giro`.

## Review Focus

Cose che il disegno implica, che nessuna attivita' proverebbe da se', e che darebbero fastidio a chi usa l'app.

1. **Blink irraggiungibile o gettone scaduto**: il giro della scatoletta continua e manda comunque le letture Bluetooth. → Task 4.
2. **Una telecamera senza batteria** (Mini, alimentata a filo): `battery` e `battery_voltage` assenti. Non si mostra 0,00 V ne' «scarica». → Task 1.
3. **Il ritmo settimanale dopo un riavvio della scatoletta**: la data sta in un file, quindi un riavvio non fa interrogare le telecamere. → Task 2.
4. **La password in chiaro**: nessun file scritto dalla preparazione la contiene, e il log non la nomina. → Task 3.
5. **Lettura vecchia di piu' di due settimane** (telecamera spenta, o gettone morto): la riga dice che e' vecchia, invece di far credere che sia di adesso. → Task 5.

---

## Struttura dei file

| File | Di che risponde |
|---|---|
| `scatoletta/blink.py` (nuovo) | le parti pure (forma del pacco, ritmo, pulizia di una telecamera) e la lettura vera con `blinkpy`, importato dentro la funzione. |
| `scatoletta/blink-accedi.py` (nuovo) | l'accesso una volta sola, da lanciare a mano sulla scatoletta. |
| `scatoletta/prove/test_blink.py` (nuovo) | le prove, `unittest` della libreria standard. |
| `scatoletta/agente.py` (modifica) | la terza sorgente dentro `un_giro`, nel suo `try`. |
| `scatoletta/config.json.esempio` (modifica) | le voci `blink` nella configurazione. |
| `scatoletta/README.md` (modifica) | i passi della preparazione. |
| `servizi/public/app.js` (modifica) | la scheda delle telecamere. |
| `.gitignore` (modifica, se serve) | `scatoletta/segreti/`. |

Il server non cambia: `POST /api/ingresso` accetta gia' `volt`, `rssi` e `temperatura`.

---

### Task 1: le parti pure del lettore Blink

**Files:**
- Create: `scatoletta/blink.py`
- Create: `scatoletta/prove/test_blink.py`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `serve_lettura(ultima, ora, giorni=7) -> bool` — `ultima` e' un `datetime` o `None`
  - `pulisci_telecamera(c) -> dict` — da un dizionario di attributi di una telecamera `blinkpy` a `{id, nome, batteria, volt, segnale, temperatura_c}`
  - `in_forma_ingresso(telecamere) -> list[dict]` — la lista `apparecchi` per `POST /api/ingresso`

- [ ] **Step 1: scrivere le prove che falliscono**

```python
import datetime, unittest
from blink import serve_lettura, pulisci_telecamera, in_forma_ingresso

UNA = {"camera_id": 7, "name": "Ingresso", "battery": "ok",
       "battery_voltage": 165, "temperature": 68, "wifi_strength": -52}
ORA = datetime.datetime(2026, 11, 17, 9, 0, tzinfo=datetime.timezone.utc)

class ProveRitmo(unittest.TestCase):
    def test_mai_letto_vuol_dire_adesso(self):
        self.assertTrue(serve_lettura(None, ORA))

    def test_ieri_non_si_rilegge(self):
        self.assertFalse(serve_lettura(ORA - datetime.timedelta(days=1), ORA))

    def test_otto_giorni_si_rilegge(self):
        self.assertTrue(serve_lettura(ORA - datetime.timedelta(days=8), ORA))

class ProvePulizia(unittest.TestCase):
    def test_volt_in_centesimi_e_gradi_da_fahrenheit(self):
        self.assertEqual(pulisci_telecamera(UNA),
            {"id": 7, "nome": "Ingresso", "batteria": "ok",
             "volt": 1.65, "segnale": -52, "temperatura_c": 20.0})

    # Review Focus 2
    def test_senza_batteria_non_diventa_zero(self):
        t = pulisci_telecamera({"camera_id": 8, "name": "Mini", "temperature": 68})
        self.assertIsNone(t["volt"])
        self.assertIsNone(t["batteria"])
        self.assertEqual(t["temperatura_c"], 20.0)

class ProveForma(unittest.TestCase):
    def test_il_pacco_ha_la_forma_che_ingresso_vuole(self):
        a = in_forma_ingresso([pulisci_telecamera(UNA)])
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0]["id"], "blink-7")
        self.assertEqual(a[0]["nome"], "Ingresso")
        self.assertEqual(a[0]["dati"]["tipo"], "telecamera")
        self.assertEqual(a[0]["dati"]["segnale"], -52)
        self.assertNotIn("rssi", a[0]["dati"])       # la scheda segnale e' per il camper
        self.assertEqual(a[0]["misure"], {"volt": 1.65, "rssi": -52, "temperatura": 20.0})

    def test_una_telecamera_senza_misure_non_manda_misure_finte(self):
        a = in_forma_ingresso([pulisci_telecamera({"camera_id": 8, "name": "Mini"})])
        self.assertEqual(a[0]["misure"], {})

    def test_nessuna_telecamera_nessun_apparecchio(self):
        self.assertEqual(in_forma_ingresso([]), [])
```

- [ ] **Step 2: far girare le prove e vederle fallire**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'blink'`

- [ ] **Step 3: scrivere `scatoletta/blink.py` con le tre funzioni**

`blinkpy` **non** si importa in cima al file: serve solo nella lettura vera (Task 2), e importarlo qui farebbe cadere le prove su una macchina che non l'ha. `temperatura_c` arrotondata a un decimale. `volt` = `battery_voltage / 100`, `None` se il campo manca. In `misure` entrano solo i campi presenti.

- [ ] **Step 4: far girare le prove e vederle passare**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: PASS, tutte.

- [ ] **Step 5: commit**

```bash
git add scatoletta/blink.py scatoletta/prove/test_blink.py
git commit -m "Le parti pure del lettore Blink, provate senza blinkpy installato"
```

---

### Task 2: la lettura vera, e il ritmo che sopravvive al riavvio

**Files:**
- Modify: `scatoletta/blink.py`
- Modify: `scatoletta/prove/test_blink.py`

**Interfaces:**
- Consumes: le tre funzioni della Task 1.
- Produces:
  - `quando_ultima(percorso) -> datetime | None` — legge la data dal file; `None` se non c'e' o e' illeggibile
  - `segna_lettura(percorso, ora) -> None`
  - `async leggi_blink(conf, fabbrica=None) -> list[dict]` — la lista `apparecchi` pronta, o `[]` se non e' ora. `fabbrica` e' una funzione senza argomenti che restituisce un oggetto con `.cameras` (dizionario nome → telecamera, ciascuna con `.attributes`) e `await .refresh()`; se e' `None`, si costruisce il vero `blinkpy`.

`conf` legge da `config.json`: `blink.segreti` (dove sta il gettone, predefinito `segreti/blink.json`), `blink.ultima` (il file della data, predefinito `segreti/blink-ultima.txt`), `blink.giorni` (predefinito 7), `blink.attivo`.

- [ ] **Step 1: scrivere le prove che falliscono**

```python
class FintaBlink:
    def __init__(self, telecamere, spacca=False):
        self.cameras = {t["name"]: type("T", (), {"attributes": t})() for t in telecamere}
        self.spacca = spacca
        self.refreshes = 0
    async def refresh(self, **k):
        self.refreshes += 1
        if self.spacca: raise RuntimeError('Blink non risponde')

class ProveLettura(unittest.TestCase):
    # Review Focus 3
    def test_il_ritmo_sopravvive_al_riavvio(self):
        # con la data di ieri nel file: leggi_blink torna [] e la fabbrica
        # NON viene mai chiamata
        chiamate = []
        conf = self.conf_con_ultima(ORA - datetime.timedelta(days=1))
        got = asyncio.run(leggi_blink(conf, fabbrica=lambda: chiamate.append(1)))
        self.assertEqual(got, [])
        self.assertEqual(chiamate, [])

    def test_quando_e_ora_legge_e_segna_la_data(self):
        # file vuoto -> due telecamere diventano due apparecchi, e dopo la
        # lettura quando_ultima() non e' piu' None
        ...

    def test_una_data_illeggibile_vale_come_mai_letto(self):
        # il file contiene "pasticcio" -> quando_ultima torna None
        ...

    def test_un_guasto_non_segna_la_data(self):
        # fabbrica che solleva -> leggi_blink solleva, e quando_ultima resta
        # None: altrimenti un guasto farebbe saltare una settimana di letture
        ...

    def test_spento_nella_configurazione_non_legge(self):
        # blink.attivo = false -> [] e nessuna chiamata
        ...
```

- [ ] **Step 2: far girare le prove e vederle fallire**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: FAIL — `ImportError: cannot import name 'leggi_blink'`

- [ ] **Step 3: scrivere le tre funzioni in `scatoletta/blink.py`**

La data si scrive **solo dopo** una lettura riuscita. L'import di `blinkpy` sta dentro il ramo che costruisce la cosa vera.

- [ ] **Step 4: far girare le prove e vederle passare**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: PASS, tutte.

- [ ] **Step 5: commit**

```bash
git add scatoletta/blink.py scatoletta/prove/test_blink.py
git commit -m "La lettura Blink, col ritmo settimanale in un file"
```

---

### Task 3: l'accesso una volta sola

**Files:**
- Create: `scatoletta/blink-accedi.py`
- Modify: `scatoletta/README.md`
- Modify: `.gitignore` (se `scatoletta/segreti/` non c'e' gia')
- Modify: `scatoletta/prove/test_blink.py`

**Interfaces:**
- Consumes: niente dalle altre attivita'.
- Produces: uno script da lanciare a mano; nessuno lo importa.

- [ ] **Step 1: la prova che riguarda la password**

```python
# Review Focus 4
class ProvePassword(unittest.TestCase):
    def test_la_password_si_chiede_con_getpass_e_non_si_scrive(self):
        testo = (QUI / 'blink-accedi.py').read_text()
        self.assertIn('getpass', testo)
        # nessuna scrittura di una variabile che contenga la password
        self.assertNotRegex(testo, r'write.*password|password.*write|json\.dump.*password')
        # e non finisce in un log
        self.assertNotRegex(testo, r'(log|print)\([^)]*password')
```

Una prova sul sorgente e' debole, e si sa: serve a impedire la ricaduta, non a dimostrare la correttezza. Quel che la dimostra e' leggere lo script, che resta corto per questo.

- [ ] **Step 2: far girare la prova e vederla fallire**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: FAIL — `blink-accedi.py` non esiste.

- [ ] **Step 3: scrivere `scatoletta/blink-accedi.py`**

Chiede l'email con `input()`, la password con `getpass.getpass()`, e il codice usa-e-getta quando `blinkpy` lo chiede. Salva il gettone dove dice `blink.segreti`, con permessi `0600`, e stampa **solo** quante telecamere ha trovato e i loro nomi.

- [ ] **Step 4: le istruzioni nel README**

Nell'ordine, col perche' di ciascun passo: installare `blinkpy`, lanciare `blink-accedi.py`, digitare il codice che arriva, controllare l'elenco delle telecamere, mettere `blink.attivo` a `true`. E la riga che dice di **non** mettere niente su Railway.

- [ ] **Step 5: far girare le prove e vederle passare**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: PASS, tutte.

- [ ] **Step 6: commit**

```bash
git add scatoletta/blink-accedi.py scatoletta/README.md scatoletta/prove/test_blink.py .gitignore
git commit -m "L'accesso Blink una volta sola, sulla scatoletta"
```

---

### Task 4: la terza sorgente dentro il giro

**Files:**
- Modify: `scatoletta/agente.py` (dentro `un_giro`, dopo `giro_allarme`)
- Modify: `scatoletta/config.json.esempio`
- Modify: `scatoletta/prove/test_blink.py`

**Interfaces:**
- Consumes: `leggi_blink` dalla Task 2.
- Produces: niente di nuovo.

- [ ] **Step 1: la prova che un guasto Blink non porta via il resto**

```python
# Review Focus 1
class ProveGiro(unittest.TestCase):
    def test_un_guasto_blink_non_fa_perdere_le_letture_bluetooth(self):
        # un_giro con giro_bluetooth che restituisce un apparecchio e
        # leggi_blink che solleva -> il pacco spedito contiene l'apparecchio
        # Bluetooth, e un solo errore nel log
        ...
```

- [ ] **Step 2: far girare la prova e vederla fallire**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: FAIL — `un_giro` non chiama ancora Blink.

- [ ] **Step 3: aggiungere la sorgente in `un_giro`**

Nel suo `try`, con `log.error` come le altre due. `leggi_blink` decide da se' se e' ora, e il piu' delle volte restituisce `[]`.

- [ ] **Step 4: le voci nuove in `config.json.esempio`**

```json
"blink": { "attivo": false, "giorni": 7,
           "segreti": "segreti/blink.json", "ultima": "segreti/blink-ultima.txt" }
```

`attivo: false` nell'esempio: chi non ha le Blink non deve ritrovarsi un errore a ogni giro.

- [ ] **Step 5: far girare le prove e vederle passare**

Run: `cd scatoletta && python3 -m unittest discover -s prove -t . -v`
Expected: PASS, tutte.

- [ ] **Step 6: commit**

```bash
git add scatoletta/agente.py scatoletta/config.json.esempio scatoletta/prove/test_blink.py
git commit -m "Blink come terza sorgente del giro, nel suo try"
```

---

### Task 5: la scheda in pagina

**Files:**
- Modify: `servizi/public/app.js` — una `vistaTelecamere()` accanto a `vistaSegnale()` (riga ~388), richiamata da `vistaAdesso()`

**Interfaces:**
- Consumes: il campo `istantanee` di `GET /stato`, filtrato su `r.dati?.tipo === 'telecamera'`.
- Produces: niente.

- [ ] **Step 1: la scheda**

Una riga per telecamera: nome, batteria tradotta (`ok` → «buona», `low` → «scarsa», assente → «—»), volt a due decimali, segnale, temperatura. Un campo assente e' sempre «—», mai zero.

In testa: **«letto lunedi' 17»**, dalla `quando` piu' recente fra le telecamere.

Se non c'e' nessuna telecamera, **la scheda non compare**: a differenza della Bluetti, qui non c'e' niente da collegare dalla pagina, e una scheda vuota con un invito che non si puo' seguire dal telefono darebbe solo fastidio.

- [ ] **Step 2: la lettura vecchia**

Review Focus 5: se la `quando` piu' recente ha piu' di quattordici giorni, la data va col bollo `incompleto` e la nota dice che la scatoletta non parla da un po'.

- [ ] **Step 3: guardarla**

Avviare l'anteprima con dei dati finti per entrambi i casi (campi assenti, lettura vecchia) e controllare che la colonna non vada a capo sul telefono.

- [ ] **Step 4: commit**

```bash
git add servizi/public/app.js
git commit -m "Le batterie delle webcam in pagina, con la data della lettura"
```

---

## Dopo l'ultima attivita'

Il codice e' pronto e aspetta la scatoletta. Quando arriva, nell'ordine: `pip install blinkpy`, `python3 blink-accedi.py`, il codice usa-e-getta, `blink.attivo` a `true`, e al primo giro le telecamere compaiono in pagina. Niente da fare su Railway.
