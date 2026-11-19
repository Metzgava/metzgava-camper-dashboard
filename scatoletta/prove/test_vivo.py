"""Le prove del giro svelto: dal vivo mentre qualcuno guarda.

Disegno: docs/superpowers/specs/2026-11-19-dal-vivo-design.md

Il fatto che decide tutto non e' software, e' aritmetica: un giro completo
dura piu' di un minuto, e quasi tutto quel tempo se ne va nei due
collegamenti alle Ective. Un giro da dieci secondi che legge tutto **non
esiste**.

Quindi due ritmi. Il giro svelto ascolta solo chi **grida** -- le Victron e i
termometri mandano annunci a chiunque passi -- e non si collega a niente. Il
giro lento resta quello di oggi.

La regola che governa i casi strani e' una sola, e vale per ogni prova qui
sotto: **si sbaglia verso il lento**. Il passo svelto costa corrente alla
batteria servizi del camper, e nessuno se ne accorgerebbe finche' non resta al
buio.
"""
import asyncio
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

import agente  # noqa: E402


class ProvePasso(unittest.TestCase):
    """Che passo tenere, leggendo quel che risponde il server."""

    def test_il_server_dice_svelto(self):
        self.assertEqual(agente.passo_dal_server({"secondi": 10}), 10)

    def test_null_vuol_dire_tieni_il_tuo_passo(self):
        # Non «fermati»: il ritmo lento lo decide la scatoletta, e il server
        # non possiede un numero che non gli appartiene.
        self.assertIsNone(agente.passo_dal_server({"secondi": None}))

    def test_una_risposta_senza_la_voce_non_accelera(self):
        self.assertIsNone(agente.passo_dal_server({}))

    def test_una_risposta_illeggibile_non_accelera(self):
        for brutta in (None, "svelto", [], {"secondi": "dieci"}, {"secondi": float("nan")}):
            self.assertIsNone(agente.passo_dal_server(brutta), brutta)

    def test_un_passo_assurdo_non_si_prende(self):
        # Uno zero o un negativo vorrebbe dire radio senza respiro. E un
        # numero enorme non e' «svelto»: e' un errore, e si ignora.
        for assurdo in (0, -5, 100000):
            self.assertIsNone(agente.passo_dal_server({"secondi": assurdo}), assurdo)

    def test_sotto_il_minimo_si_alza_al_minimo(self):
        # Il server chiede due secondi: un giro svelto non ci sta, perche'
        # deve comunque ascoltare la radio. Si obbedisce fin dove si puo'.
        self.assertEqual(agente.passo_dal_server({"secondi": 1}), agente.SVELTO_MINIMO)


class ProveGiroSvelto(unittest.TestCase):
    """Cosa fa e cosa NON fa il giro svelto.

    Si legge il testo della funzione invece di lanciarla, come per
    `installa.sh` e per la stessa ragione: il difetto da evitare e' che il
    giro svelto **faccia qualcosa in piu'** -- e un giro svelto che si collega
    alle Ective non si rompe, rallenta. Dieci secondi di passo con un minuto
    di collegamenti dentro vuol dire giri che si accavallano, radio sempre
    accesa e batteria che si svuota, in silenzio.
    """

    def setUp(self):
        testo = (QUI.parent / "agente.py").read_text()
        inizio = testo.index("async def giro_svelto")
        fine = testo.index("\nasync def ", inizio + 10)
        self.corpo = testo[inizio:fine]

    def test_non_si_collega_alle_ective(self):
        for vietato in ("BleakClient", "ective", "Ective"):
            self.assertNotIn(vietato, self.corpo,
                             f"il giro svelto non deve nominare {vietato}")

    def test_non_tocca_blink_ne_l_allarme(self):
        for vietato in ("blink", "Blink", "allarme"):
            self.assertNotIn(vietato, self.corpo)

    def test_ascolta_gli_annunci(self):
        self.assertIn("ascolta_annunci", self.corpo)


class ProveDueRitmi(unittest.IsolatedAsyncioTestCase):
    """I due ritmi condividono una radio sola.

    Se il giro svelto si mettesse **in coda** dietro a quello lento, al
    termine di un giro lento da un minuto partirebbe una raffica di giri
    arretrati: radio sempre accesa, batteria servizi che si svuota, e nessun
    dato in piu' -- perche' un giro svelto in ritardo di un minuto non e' piu'
    svelto. Quindi salta il proprio turno.
    """

    async def asyncSetUp(self):
        self.fatti = []
        self.vero_giro = agente.giro_svelto
        self.vero_chiede = agente.chiede_il_vivo

        async def finto_giro(conf, secondi_ascolto=5):
            self.fatti.append(1)

        agente.giro_svelto = finto_giro
        agente.chiede_il_vivo = lambda conf: agente.SVELTO_MINIMO
        agente.RADIO = asyncio.Lock()

    async def asyncTearDown(self):
        agente.giro_svelto = self.vero_giro
        agente.chiede_il_vivo = self.vero_chiede

    async def lancia_un_attimo(self, secondi=0.4):
        compito = asyncio.create_task(agente.ciclo_svelto(lambda: {"server": "x", "chiave": "y"}))
        await asyncio.sleep(secondi)
        compito.cancel()
        try:
            await compito
        except asyncio.CancelledError:
            pass

    async def test_con_la_radio_libera_il_giro_svelto_parte(self):
        await self.lancia_un_attimo()
        self.assertGreaterEqual(len(self.fatti), 1)

    async def test_con_la_radio_occupata_salta_invece_di_accodarsi(self):
        await agente.RADIO.acquire()
        try:
            await self.lancia_un_attimo()
        finally:
            agente.RADIO.release()
        self.assertEqual(self.fatti, [],
                         "si e' accodato: alla fine del giro lento partirebbe una raffica")


if __name__ == "__main__":
    unittest.main()
