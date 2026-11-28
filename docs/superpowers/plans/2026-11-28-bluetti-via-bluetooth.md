# La Bluetti via Bluetooth — piano di attuazione

> **Per chi esegue:** SOTTO-SKILL RICHIESTA: usare superpowers:executing-plans
> (esecuzione nativa, scelta dal proprietario per i due piani precedenti) per
> attuare questo piano attività per attività. I passi usano le caselle
> (`- [ ]`).

**Obiettivo:** la scatoletta legge dalla Bluetti via Bluetooth carica, watt in
ingresso e watt in uscita; la pagina li usa come riserva del cloud dichiarando
la fonte, e ne ricava la durata sulla media misurata.

**Architettura:** un lettore puro dei registri in Python (nessuna radio, tutto
provabile), una lettura via radio dentro `giro_bluetooth` con la disciplina
dei collegamenti già costruita in `collegamenti.py`, e sul server un ripiego
**per campo** che non mescola mai un totale Bluetooth dove il cloud dà un
ramo.

**Tecnologie:** Python 3.13 + bleak sulla scatoletta; Node 22 + Express +
Postgres sul server; nessuna dipendenza nuova (`encryption.py` è già in
`scatoletta/terze-parti/`).

**Disegno:** `docs/superpowers/specs/2026-11-28-bluetti-via-bluetooth-design.md`

## Vincoli globali

- **Solo registri verificati diventano misure**: `[102]` carica, `[146]`
  entra, `[142]` esce. Tutto il resto viaggia in `dati`.
- **I nomi delle grandezze sono `bt_carica`, `bt_entra_w`, `bt_esce_w`** —
  distinti da quelli del cloud, perché `/storia` disegna una linea per
  apparecchio.
- **`[148]` non è un cancello**: il disaccordo si scrive, non blocca.
- **La Bluetti non entra nel pacco delle Ective** (`usciteDelPacco` fa il
  netto come meno la somma: ci sommerebbe due impianti diversi).
- **Le Ective hanno la precedenza sulla radio.** La Bluetti non parte se il
  giro lento ha già speso più della metà del suo passo, e non parte mai
  durante la taratura né nel giro svelto.
- **Dopo ogni lettura, `hcitool con` pulito.** Tre strati come in `e6dd33a`.
- **`bt_esce_w` non si usa mai dove è attesa `uscita_ac_w`.**
- Nessun segreto nei registri; `config.json` resta fuori dal versionamento.

## Attenzione della revisione

Classi di ingresso che il disegno implica e che nessuna prova delle attività
esercita, in ordine di quanto farebbero male:

1. **La Bluetti si annuncia ma il collegamento viene rifiutato a metà** —
   l'app del telefono l'ha presa. Il giro non deve morire né lasciare un
   collegamento appeso. *Prova aggiunta all'attività 3.*
2. **Un blocco non risponde** — succede di routine (il 20, il 40, il 60
   rispondono «nessuna risposta» in ogni fotografia vera). Un dizionario
   parziale non deve produrre uno zero. *Prova aggiunta all'attività 1.*
3. **`[149]` assente mentre il flusso è positivo** — visto il 28/11: in
   erogazione il registro alto non compare affatto, perché vale zero e lo
   strumento gli zeri non li stampa. Il numero a 32 bit va composto con
   l'alto mancante = 0, o il flusso in uscita diventa gigantesco. *Prova
   aggiunta all'attività 1.*
4. **Una scatoletta vecchia manda `bt_esce_w` senza `bt_entra_w`** — i conti
   che vogliono entrambi devono tacere, non sommare un `undefined`. *Prova
   aggiunta all'attività 5.*
5. **Il cloud torna fresco mentre il Bluetooth sta sostituendo** — il
   passaggio da una fonte all'altra non deve produrre un salto non
   dichiarato. *Prova aggiunta all'attività 5.*

---

### Attività 1: Il lettore dei registri, senza radio

**File:**
- Creare: `scatoletta/bluetti_registri.py`
- Prova: `scatoletta/prove/test_bluetti_registri.py`

**Interfacce:**
- Consuma: niente.
- Produce: `leggi_registri(registri: dict[int, int]) -> dict | None` e la
  costante `TOLLERANZA_CONTROPROVA_W = 30`.

Il risultato, quando c'è: `{"carica": int, "entra_w": int, "esce_w": int,
"stato": int | None, "concorda": bool | None, "dati": dict}`. `None` quando
manca `[102]` o mancano entrambi `[142]` e `[146]`: senza quelli non c'è
niente da dire.

Le fotografie vere del 28/11 sono le prove. Si copiano nel file come
costanti, con la loro ora:

    RIPOSO   = {1: 769, 100: 1024, 101: 4, 102: 100, 104: 39250, 152: 226,
                167: 32000, 169: 230, 170: 5000, 171: 32, 188: 2}
    CARICA   = {100: 1023, 101: 566, 102: 90, 104: 32, 142: 0, 146: 646,
                148: 64909, 149: 65535, 152: 230, 161: 2, 167: 32500}
    EROGA    = {100: 948, 101: 1986, 102: 88, 104: 83, 142: 1733, 146: 0,
                148: 1708, 152: 231, 161: 1, 167: 32670}

- [ ] **Passo 1: scrivere le prove che falliscono**

```python
def test_a_riposo_entra_ed_esce_sono_zero(self):
    # Il registro che non compare vale zero: lo strumento gli zeri non li
    # stampa. Un `None` qui direbbe «non so», che e' un'altra affermazione.
    letto = bluetti_registri.leggi_registri(RIPOSO)
    self.assertEqual(letto["entra_w"], 0)
    self.assertEqual(letto["esce_w"], 0)
    self.assertEqual(letto["carica"], 100)

def test_in_carica_i_watt_sono_quelli_dell_app(self):
    letto = bluetti_registri.leggi_registri(CARICA)
    self.assertEqual(letto["entra_w"], 646)   # app: 647
    self.assertEqual(letto["esce_w"], 0)
    self.assertEqual(letto["carica"], 90)
    self.assertEqual(letto["stato"], 2)

def test_in_erogazione_il_flusso_alto_manca_e_non_fa_un_numero_gigante(self):
    # Attenzione della revisione 3. In erogazione `[149]` non compare: vale
    # zero. Comporlo male darebbe 0xFFFF06AC watt.
    letto = bluetti_registri.leggi_registri(EROGA)
    self.assertEqual(letto["esce_w"], 1733)
    self.assertLess(abs(letto["dati"]["flusso_w"]), 3000)
    self.assertGreater(letto["dati"]["flusso_w"], 0)   # positivo: esce

def test_in_carica_il_flusso_ha_il_segno_negativo(self):
    # [148]=64909 con [149]=65535 e' -627 a 32 bit.
    self.assertEqual(bluetti_registri.leggi_registri(CARICA)["dati"]["flusso_w"], -627)

def test_la_controprova_concorda_entro_la_tolleranza(self):
    for fotografia in (CARICA, EROGA):
        self.assertTrue(bluetti_registri.leggi_registri(fotografia)["concorda"])

def test_un_disaccordo_si_scrive_e_non_blocca(self):
    # **Il punto del vincolo globale.** Anche quando non concorda, i watt
    # verificati escono lo stesso: un silenzio causato da una nostra ipotesi
    # sbagliata sul registro non verificato sarebbe il guasto peggiore.
    storto = dict(EROGA, 148=1)   # scrivere: {**EROGA, 148: 1}
    letto = bluetti_registri.leggi_registri(storto)
    self.assertFalse(letto["concorda"])
    self.assertEqual(letto["esce_w"], 1733)

def test_senza_controprova_concorda_e_none_non_false(self):
    # `False` vorrebbe dire «ho controllato e non torna». Qui non si e'
    # potuto controllare, ed e' un'altra cosa.
    self.assertIsNone(bluetti_registri.leggi_registri(
        {102: 90, 142: 100})["concorda"])

def test_un_blocco_che_non_risponde_non_diventa_uno_zero(self):
    # Attenzione della revisione 2. Se manca **tutto** il blocco 140 non si
    # puo' dire «esce 0»: non si sa.
    self.assertIsNone(bluetti_registri.leggi_registri({102: 90, 161: 1}))

def test_senza_la_carica_non_si_legge_niente(self):
    self.assertIsNone(bluetti_registri.leggi_registri({142: 100, 146: 0}))

def test_una_carica_fuori_scala_rifiuta_la_lettura(self):
    # Un blocco letto storto da' numeri plausibili in posti sbagliati: 0-100
    # e' l'unico controllo gratuito che abbiamo.
    self.assertIsNone(bluetti_registri.leggi_registri(dict(CARICA, **{102: 227})))

def test_i_registri_probabili_viaggiano_ma_non_fra_le_misure(self):
    letto = bluetti_registri.leggi_registri(EROGA)
    for chiave in ("minuti", "volt_pacco", "watt_batteria", "flusso_w"):
        self.assertIn(chiave, letto["dati"])
    self.assertNotIn("minuti", letto)
```

- [ ] **Passo 2: eseguirle e vederle fallire**

Eseguire: `cd scatoletta && python3 -m unittest prove.test_bluetti_registri -v`
Atteso: FALLISCE con `ModuleNotFoundError: No module named 'bluetti_registri'`

- [ ] **Passo 3: scrivere `leggi_registri` in `scatoletta/bluetti_registri.py`**

`flusso_w` si compone come intero con segno a 32 bit da `[148]` (parola
bassa) e `[149]` (parola alta, assente = 0). `concorda` confronta
`abs(flusso_w)` con `entra_w` o `esce_w` secondo il segno, entro
`TOLLERANZA_CONTROPROVA_W`, e vale `None` quando `[148]` manca. Il confronto
si fa **solo dentro il blocco 140**, che è una domanda sola: `[161]` sta nel
160 e non è dello stesso istante.

- [ ] **Passo 4: eseguirle e vederle passare**

Eseguire: `cd scatoletta && python3 -m unittest prove.test_bluetti_registri -v`
Atteso: PASSA, 11 prove

- [ ] **Passo 5: la verifica di mutazione**

Rompere il codice in tre modi e controllare che le prove se ne accorgano:
comporre `flusso_w` senza segno; usare `or 0` invece di «registro assente =
0» anche per il blocco intero mancante; far tornare `False` invece di `None`
quando la controprova non c'è. Ripristinare.
Atteso: almeno una prova rossa per ciascuna.

- [ ] **Passo 6: commit**

```bash
git add scatoletta/bluetti_registri.py scatoletta/prove/test_bluetti_registri.py
git commit -m "Dai registri della Bluetti ai tre numeri verificati"
```

---

### Attività 2: Quando tocca alla Bluetti

**File:**
- Creare: `scatoletta/quando_bluetti.py`
- Prova: `scatoletta/prove/test_quando_bluetti.py`

**Interfacce:**
- Consuma: niente.
- Produce: `tocca_alla_bluetti(*, stato_scorso, da_quanto_s, passo_s,
  in_taratura, chiesta, speso_s, passo_fermo_s=600) -> bool`

Il perché di ogni argomento sta nelle prove.

- [ ] **Passo 1: scrivere le prove che falliscono**

```python
def test_quando_lavora_si_legge_a_ogni_giro(self):
    # [161] diverso da 0: c'e' qualcosa da misurare, e la durata ha bisogno
    # di campioni fitti -- la media recente vuole il 50% di copertura.
    self.assertTrue(quando(stato_scorso=1, da_quanto_s=120, passo_s=120))

def test_quando_e_ferma_si_rallenta(self):
    self.assertFalse(quando(stato_scorso=0, da_quanto_s=120, passo_s=120))

def test_quando_e_ferma_si_legge_comunque_ogni_dieci_minuti(self):
    # Rallentare non e' smettere: e' l'unico modo di accorgersi che ha
    # ricominciato.
    self.assertTrue(quando(stato_scorso=0, da_quanto_s=600, passo_s=120))

def test_la_prima_volta_si_legge(self):
    self.assertTrue(quando(stato_scorso=None, da_quanto_s=0, passo_s=120))

def test_durante_la_taratura_non_si_legge_mai(self):
    # La taratura porta il giro a 5-60 secondi e tiene `RADIO`: una lettura
    # da dieci secondi dentro un giro da cinque ferma anche il giro svelto.
    self.assertFalse(quando(stato_scorso=2, da_quanto_s=9999,
                            passo_s=10, in_taratura=True))

def test_se_il_giro_ha_gia_speso_meta_passo_si_salta(self):
    # Le Ective hanno la precedenza: una lettura in meno della Bluetti e' un
    # buco, una lettura in meno delle Ective e' la pagina che si svuota.
    self.assertFalse(quando(stato_scorso=1, da_quanto_s=600,
                            passo_s=120, speso_s=70))

def test_il_server_puo_chiederla_e_allora_si_legge_subito(self):
    # Il passo lento guarda il [161] **precedente**: accendere la Truma --
    # l'istante in cui la domanda nasce -- si saprebbe dieci minuti dopo. Il
    # server sa che la pagina e' aperta e cosa dice il cloud.
    self.assertTrue(quando(stato_scorso=0, da_quanto_s=30,
                           passo_s=120, chiesta=True))

def test_nemmeno_su_richiesta_si_calpesta_la_taratura(self):
    self.assertFalse(quando(stato_scorso=0, da_quanto_s=30, passo_s=120,
                            chiesta=True, in_taratura=True))
```

- [ ] **Passo 2: eseguirle e vederle fallire**

Eseguire: `cd scatoletta && python3 -m unittest prove.test_quando_bluetti -v`
Atteso: FALLISCE con `ModuleNotFoundError`

- [ ] **Passo 3: scrivere `tocca_alla_bluetti`**

Ordine delle regole: taratura e budget speso vincono su tutto; poi la
richiesta del server; poi lo stato precedente.

- [ ] **Passo 4: eseguirle e vederle passare**

Eseguire: `cd scatoletta && python3 -m unittest prove.test_quando_bluetti -v`
Atteso: PASSA, 8 prove

- [ ] **Passo 5: commit**

```bash
git add scatoletta/quando_bluetti.py scatoletta/prove/test_quando_bluetti.py
git commit -m "Quando tocca alla Bluetti, e quando le Ective vengono prima"
```

---

### Attività 3: La lettura via radio, e il pacco

**File:**
- Modificare: `scatoletta/agente.py` (`giro_bluetooth`, verso la fine)
- Prova: `scatoletta/prove/test_bluetti_pacco.py`

**Interfacce:**
- Consuma: `bluetti_registri.leggi_registri`, `quando_bluetti.tocca_alla_bluetti`,
  `collegamenti.libera` e `collegamenti.collegati_adesso`.
- Produce: `pacco_bluetti(letto, indirizzo, nome) -> dict` e
  `async leggi_bluetti(conf, dispositivo, apri)`.

`apri` è la fabbrica del cliente BLE, passata da fuori: è ciò che rende la
lettura provabile senza radio.

- [ ] **Passo 1: scrivere le prove che falliscono**

```python
def test_il_pacco_ha_tipo_e_nome_anche_dentro_dati(self):
    # Lezione del 19/11: nell'istantanea il server conserva solo `dati`, e
    # l'istantanea e' quel che la pagina mostra. Un `tipo` scritto solo
    # accanto non arriva mai in pagina.
    p = pacco_bluetti(LETTO, "90:70:69:35:76:F2", "EL3002605110301917")
    self.assertEqual(p["tipo"], "bluetti_bt")
    self.assertEqual(p["dati"]["tipo"], "bluetti_bt")

def test_nelle_misure_vanno_solo_le_tre_verificate(self):
    misure = pacco_bluetti(LETTO, IND, NOME)["misure"]
    self.assertEqual(set(misure), {"bt_carica", "bt_entra_w", "bt_esce_w"})

def test_lo_stato_e_i_probabili_restano_fuori_dalle_misure(self):
    # `stato` e' un codice 0/1/2: di «eroga» non si fa la media.
    p = pacco_bluetti(LETTO, IND, NOME)
    self.assertNotIn("stato", p["misure"])
    self.assertIn("stato", p["dati"])

def test_l_identificativo_non_cambia_fra_un_giro_e_l_altro(self):
    # E' la chiave primaria di `istantanee`: se cambiasse, ogni giro
    # creerebbe una riga nuova invece di aggiornare la sua.
    a = pacco_bluetti(LETTO, IND, NOME)["id"]
    b = pacco_bluetti(dict(LETTO, carica=50), IND, NOME)["id"]
    self.assertEqual(a, b)

def test_un_collegamento_rifiutato_non_fa_morire_il_giro(self):
    # Attenzione della revisione 1: l'app del telefono l'ha presa.
    async def apri_che_rifiuta(_d):
        raise OSError("le risorse non sono disponibili")
    letto = asyncio.run(leggi_bluetti(CONF, FINTO, apri_che_rifiuta))
    self.assertIsNone(letto)

def test_un_collegamento_rifiutato_non_lascia_niente_appeso(self):
    # Si registra che `stacca` e' stata chiamata per quell'indirizzo.
    ...
    self.assertIn(IND, staccati)
```

- [ ] **Passo 2: eseguirle e vederle fallire**

Eseguire: `cd scatoletta && python3 -m unittest prove.test_bluetti_pacco -v`
Atteso: FALLISCE, `module 'agente' has no attribute 'pacco_bluetti'`

- [ ] **Passo 3: scrivere `pacco_bluetti` e `leggi_bluetti` in `agente.py`**

`leggi_bluetti` si collega, legge i blocchi 100, 140 e 160 (venti registri
l'uno), si stacca, e in un `finally` chiama `collegamenti.stacca`. Il
dispositivo si trova nella scansione che `giro_bluetooth` fa già per le
Ective, per prefisso di nome, **senza scansione aggiuntiva**. Se
`encryption.py` non si importa, si salta e lo si dice una volta sola
(`_DETTI`, come per gli SwitchBot che non misurano).

- [ ] **Passo 4: eseguirle e vederle passare**

Eseguire: `cd scatoletta && python3 -m unittest prove.test_bluetti_pacco -v`
Atteso: PASSA, 6 prove

- [ ] **Passo 5: la suite intera della scatoletta**

Eseguire: `cd scatoletta && python3 -m unittest discover -s prove -t .`
Atteso: PASSA tutto tranne i 12 errori preesistenti di `test_taratura`

- [ ] **Passo 6: la prova sulla macchina vera**

Installare sulla scatoletta e guardare un giro nel diario. Poi
`hcitool con`: **deve essere pulito**.
Atteso: una riga «Bluetti letta», i tre numeri, e nessun collegamento.

- [ ] **Passo 7: commit**

```bash
git add scatoletta/agente.py scatoletta/prove/test_bluetti_pacco.py
git commit -m "La scatoletta legge la Bluetti, e si stacca sempre"
```

---

### Attività 4: La porta: le grandezze nuove

**File:**
- Modificare: `servizi/src/routes/ingresso.js` (`AMMESSE`, riga 22)
- Prova: `servizi/test/ingresso-bluetti-bt.test.js`

**Interfacce:**
- Consuma: `pacco_bluetti` dell'attività 3.
- Produce: le chiavi `bt_carica: [0, 100]`, `bt_entra_w: [0, 4000]`,
  `bt_esce_w: [0, 4000]` in `AMMESSE`.

I limiti: l'Elite 300 prende al massimo circa 1800 W dalla 220 e ne eroga
2400; 4000 lascia spazio senza accettare assurdità.

- [ ] **Passo 1: scrivere le prove che falliscono**

```js
test('le grandezze del Bluetooth passano la porta', () => {
  for (const g of ['bt_carica', 'bt_entra_w', 'bt_esce_w'])
    assert.ok(AMMESSE[g], `«${g}» verrebbe scartata a ogni giro con una riga negli eventi`);
});

test('i nomi non si sovrappongono a quelli del cloud', () => {
  // `/storia` disegna una linea per apparecchio: due serie della stessa
  // grandezza per la stessa batteria rifarebbero nel grafico l'anti
  // obiettivo numero uno.
  for (const g of ['bt_carica', 'bt_entra_w', 'bt_esce_w'])
    assert.notEqual(g, 'carica');
});

test('un valore assurdo viene rifiutato', () => {
  // 9000 W in ingresso vuol dire blocco letto storto, non una Bluetti veloce.
  assert.ok(9000 > AMMESSE.bt_entra_w[1]);
});
```

- [ ] **Passo 2: eseguirle e vederle fallire**

Eseguire: `cd servizi && node --test test/ingresso-bluetti-bt.test.js`
Atteso: FALLISCE, «bt_carica verrebbe scartata»

- [ ] **Passo 3: aggiungere le tre chiavi ad `AMMESSE`, con il commento del perché**

- [ ] **Passo 4: eseguirle e vederle passare**

Eseguire: `cd servizi && node --test test/ingresso-bluetti-bt.test.js`
Atteso: PASSA

- [ ] **Passo 5: commit**

```bash
git add servizi/src/routes/ingresso.js servizi/test/ingresso-bluetti-bt.test.js
git commit -m "Le tre grandezze della Bluetti via Bluetooth entrano dalla porta"
```

---

### Attività 5: Il ripiego per campo, e la fonte dichiarata

**File:**
- Creare: `servizi/src/lib/bluetti-bt.js`
- Modificare: `servizi/src/routes/stato.js` (riga 130-204)
- Prova: `servizi/test/bluetti-bt-ripiego.test.js`

**Interfacce:**
- Consuma: `statoBluetti` (cloud) e la riga di `istantanee` con
  `apparecchio` del tipo `bluetti_bt`.
- Produce: `scegliFonte(cloud, bt, adesso) -> { fonte: 'cloud'|'bluetooth'|
  'nessuna', carica, entra_w, esce_w, eta_minuti, perche }` e
  `ETA_MASSIMA_BT_MINUTI = 15`.

- [ ] **Passo 1: scrivere le prove che falliscono**

```js
test('col cloud fresco comanda il cloud, e si dice', () => {
  const s = scegliFonte(CLOUD_FRESCO, BT_FRESCO, ADESSO);
  assert.equal(s.fonte, 'cloud');
});

test('col cloud vecchio entra il Bluetooth', () => {
  assert.equal(scegliFonte(CLOUD_VECCHIO, BT_FRESCO, ADESSO).fonte, 'bluetooth');
});

test('un Bluetooth piu’ vecchio del cloud non lo sostituisce', () => {
  // Il passo a riposo e' dieci minuti e gli zeri del cloud si sopprimono a
  // cinque: una lettura Bluetooth puo' legittimamente essere piu' vecchia di
  // quella che sostituisce.
  assert.equal(scegliFonte(CLOUD_VECCHIO_5, BT_VECCHIO_20, ADESSO).fonte, 'cloud');
});

test('uno zero vecchio non si mostra come zero, qualunque sia la fonte', () => {
  // La regola del cloud vale identica per il Bluetooth: uno zero vecchio non
  // e' un valore vecchio, e' un'affermazione vecchia.
  const s = scegliFonte(null, { ...BT_FRESCO, esce_w: 0, eta_minuti: 9 }, ADESSO);
  assert.equal(s.esce_w, null);
});

test('quando sono vecchi tutti e due si mostra il piu’ fresco, con l’eta’', () => {
  const s = scegliFonte(CLOUD_VECCHIO_20, BT_VECCHIO_8, ADESSO);
  assert.equal(s.fonte, 'bluetooth');
  assert.equal(s.eta_minuti, 8);
});

test('senza nessuna delle due non si inventa niente', () => {
  const s = scegliFonte(null, null, ADESSO);
  assert.equal(s.fonte, 'nessuna');
  assert.equal(s.carica, null);
});

test('una scatoletta vecchia che manda solo «esce» non fa sommare un undefined', () => {
  // Attenzione della revisione 4.
  const s = scegliFonte(null, { esce_w: 100, eta_minuti: 1 }, ADESSO);
  assert.equal(s.entra_w, null);
  assert.notEqual(s.entra_w, 0);
});

test('i conti che vogliono un ramo tacciono, non ricevono un totale', async () => {
  // **La prova piu' importante dell'attivita'.** `bt_esce_w` e' il totale;
  // `catena` vuole la sola uscita in alternata. Dargliela gonfierebbe il
  // conto di tutto il ramo 12 V, con un bollino `stima` che nasconde
  // l'errore invece di mostrarlo.
  const c = await contiConSoloBluetooth();
  for (const k of ['catena', 'ingresso', 'alla_piena', 'flusso_bluetti'])
    assert.ok(c[k] == null || c[k].valore == null,
      `«${k}» ha ricevuto un totale dove voleva un ramo`);
});

test('il passaggio di fonte si dichiara, non si fa di nascosto', () => {
  // Attenzione della revisione 5.
  assert.match(scegliFonte(CLOUD_VECCHIO, BT_FRESCO, ADESSO).perche, /Bluetooth/);
  assert.match(scegliFonte(CLOUD_FRESCO, BT_FRESCO, ADESSO).perche, /cloud/);
});
```

- [ ] **Passo 2: eseguirle e vederle fallire**

Eseguire: `cd servizi && node --test test/bluetti-bt-ripiego.test.js`
Atteso: FALLISCE, `Cannot find module '../src/lib/bluetti-bt.js'`

- [ ] **Passo 3: scrivere `scegliFonte` e cablarla in `stato.js`**

In `stato.js` la riga 184 passa già `vecchia` accanto all'apparecchio: la
fonte viaggia allo stesso modo. I quattro conti che vogliono un ramo
continuano a ricevere **solo** il cloud.

- [ ] **Passo 4: eseguirle e vederle passare**

Eseguire: `cd servizi && node --test test/bluetti-bt-ripiego.test.js`
Atteso: PASSA, 9 prove

- [ ] **Passo 5: la suite intera**

Eseguire: `cd servizi && npm test`
Atteso: PASSA, nessun fallimento

- [ ] **Passo 6: commit**

```bash
git add servizi/src/lib/bluetti-bt.js servizi/src/routes/stato.js servizi/test/bluetti-bt-ripiego.test.js
git commit -m "Il ripiego della Bluetti e’ per campo, e la fonte si dichiara"
```

---

### Attività 6: La durata sulla media misurata

**File:**
- Modificare: `servizi/src/lib/consumo.js`, `servizi/src/lib/conti.js`
- Prova: `servizi/test/bluetti-bt-durata.test.js`

**Interfacce:**
- Consuma: le righe di `misure` con grandezza `bt_esce_w`.
- Produce: `consumoRecenteDiUno(righe, { da, a, apparecchio, grandezza })`,
  della stessa forma di `consumoRecente` — `{ watt, campioni, copertura,
  finestra_minuti }` — e il conto `tempo_residuo_bluetti_bt`.

- [ ] **Passo 1: scrivere le prove che falliscono**

```js
test('la durata si fa sulla media recente, non sull’istante', () => {
  // La lezione del 21/11, qui applicata alla Bluetti: aperta la pagina
  // mentre parte la Truma, l'autonomia crollerebbe; un minuto dopo direbbe
  // il triplo. Nessuno dei due e' sbagliato come misura e tutti e due sono
  // inutili come durata.
  const r = consumoRecenteDiUno(ALTERNATI, { ...FINESTRA, apparecchio: 'bt', grandezza: 'bt_esce_w' });
  assert.ok(Math.abs(r.watt - 900) < 50, `media: ${r.watt}`);
});

test('senza abbastanza campioni si ricade sull’istante E SI DICE', () => {
  const c = contiCon(POCHI_CAMPIONI);
  assert.match(c.tempo_residuo_bluetti_bt.perche, /in questo momento/);
});

test('la Bluetti non entra nel netto del pacco delle Ective', () => {
  // **La prova che protegge dall'errore peggiore.** `usciteDelPacco` fa il
  // netto come meno la somma delle medie: la Bluetti li' dentro sommerebbe
  // due impianti diversi in un bilancio solo.
  const conLei = consumoRecente(RIGHE_CON_BLUETTI, FINESTRA);
  const senza = consumoRecente(RIGHE_SENZA_BLUETTI, FINESTRA);
  assert.equal(conLei.watt, senza.watt);
});

test('la finestra si scrive accanto al numero', () => {
  assert.match(contiCon(TANTI).tempo_residuo_bluetti_bt.perche, /ultime/);
});

test('con la Bluetti ferma la durata non e’ infinita: non si calcola', () => {
  assert.equal(contiCon(TUTTI_ZERO).tempo_residuo_bluetti_bt.valore, null);
});
```

- [ ] **Passo 2: eseguirle e vederle fallire**

Eseguire: `cd servizi && node --test test/bluetti-bt-durata.test.js`
Atteso: FALLISCE, `consumoRecenteDiUno is not a function`

- [ ] **Passo 3: scrivere `consumoRecenteDiUno` e il conto**

Stessa forma di `consumoRecente`: soglie di campioni e copertura identiche,
intervalli di sola scarica, ripiego sull'istante **dichiarato**.

- [ ] **Passo 4: eseguirle e vederle passare**

Eseguire: `cd servizi && node --test test/bluetti-bt-durata.test.js`
Atteso: PASSA, 5 prove

- [ ] **Passo 5: commit**

```bash
git add servizi/src/lib/consumo.js servizi/src/lib/conti.js servizi/test/bluetti-bt-durata.test.js
git commit -m "La durata della Bluetti sulla media misurata, non sull’istante"
```

---

### Attività 7: In pagina: la fonte, e i tre stati della 220

**File:**
- Modificare: `servizi/public/app.js`
- Prova: `servizi/test/bluetti-bt-pagina.test.js`

**Interfacce:**
- Consuma: `fonte` e `perche` dall'attività 5, `tempo_residuo_bluetti_bt`
  dall'attività 6.
- Produce: niente che altri consumino.

- [ ] **Passo 1: scrivere le prove che falliscono**

```js
test('la scheda dichiara sempre la fonte, anche quando e’ il cloud', () => {
  // Un numero senza provenienza su una pagina che ne ha due e' il guasto
  // del 21/11 che torna.
  assert.match(sorgente, /c\.fonte|bluetti\.fonte/);
});

test('l’avviso sulla 220 ha tre stati, non due', () => {
  // La fa la Bluetti / la fa la colonnina / non si sa. Via Bluetooth la
  // divisione fra rete e fotovoltaico non esiste, e in sosta libera --
  // il caso per cui questo progetto esiste -- l'origine e' ignota.
  assert.match(sorgente, /non so da dove|non si sa/i);
});

test('la durata nuova non si confonde con le ore della Truma', () => {
  // Due risposte alla stessa domanda sono vietate. Queste sono due domande:
  // «quanto dura se la resistenza va di continuo» e «quanto dura alla media
  // misurata di adesso». Devono dirlo.
  assert.match(sorgente, /di continuo|resistenza accesa/);
});
```

- [ ] **Passo 2: eseguirle e vederle fallire**

Eseguire: `cd servizi && node --test test/bluetti-bt-pagina.test.js`
Atteso: FALLISCE

- [ ] **Passo 3: scrivere le righe in pagina**

- [ ] **Passo 4: eseguirle e vederle passare, e la suite intera**

Eseguire: `cd servizi && npm test`
Atteso: PASSA

- [ ] **Passo 5: guardare la pagina vera, a larghezza di telefono**

`preview_start` con `servizi-vero`, `resize_window` a `mobile`. **Serve
`preview_stop` prima**: il server calcola le impronte all'avvio.
Atteso: le righe si leggono, i bollini stanno in riga, la fonte si vede.

- [ ] **Passo 6: commit**

```bash
git add servizi/public/app.js servizi/test/bluetti-bt-pagina.test.js
git commit -m "In pagina si vede da dove viene il numero della Bluetti"
```

---

## Dopo l'ultima attività

Ritirare la raccolta a mano sulla scatoletta: il suo lavoro — prendere uno
scatto mentre caricava, per identificare i registri — è finito il 28/11. Il
suo servizio sta nei drop-in sulla scatoletta, fuori da git.

Poi superpowers:finishing-a-development-branch.
