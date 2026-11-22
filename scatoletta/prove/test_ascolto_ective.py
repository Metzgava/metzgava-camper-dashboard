"""Quanto si sta in ascolto di una batteria Ective.

Disegno: docs/superpowers/specs/2026-11-22-ascolto-ective-design.md

Il programma si collegava a ogni batteria e poi **aspettava venti secondi a
prescindere**: non che i dati arrivassero, proprio venti secondi. Per due
batterie fanno quaranta secondi, piu' otto di ricerca -- ed e' quasi tutto il
giro lento. Il proprietario lo vede come ritardo della percentuale di carica
rispetto all'app Ective, che invece parla alle batterie direttamente dal
telefono.

La batteria manda il suo record in continuazione, non una volta sola. Quindi
non c'e' niente da aspettare oltre il primo record intero: appena c'e', ci si
stacca.

**Non si baratta niente.** Di solito «piu' svelto» si paga in corrente; qui no,
perche' oggi la radio resta accesa ad aspettare a vuoto. Staccarsi prima
consuma **meno**.

I venti secondi restano come **tetto**: una batteria che non risponde ferma il
giro li', come adesso.
"""
import asyncio
import sys
import unittest
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))

import agente  # noqa: E402


class Finto:
    """Un orologio e una pausa che non fanno passare tempo vero.

    Le prove non devono durare venti secondi per provare che qualcosa dura
    venti secondi.
    """

    def __init__(self, arrivi=None):
        self.ora = 0.0
        self.attese = []
        self.arrivi = dict(arrivi or {})   # {secondo: testo che arriva}
        self.flusso = {"testo": ""}

    def orologio(self):
        return self.ora

    async def pausa(self, secondi):
        self.attese.append(secondi)
        self.ora += secondi
        for quando, testo in sorted(self.arrivi.items()):
            if quando <= self.ora and testo is not None:
                self.flusso["testo"] += testo
                self.arrivi[quando] = None


def record(carica=77):
    """Un record intero come lo manda la batteria.

    I campi stanno a **offset di carattere** dentro la stringa esadecimale,
    non uno di seguito all'altro: e' cosi' che li legge `_le`.
    """
    p = ["0"] * 64

    def metti(i, valore, byte, signed=False):
        g = valore.to_bytes(byte, "little", signed=signed).hex().upper()
        for k, ch in enumerate(g):
            p[i + k] = ch

    metti(0, 13200, 2)          # 13,2 V
    metti(8, 5000, 4, True)     # 5 A in carica
    metti(16, 100000, 4)        # 100 Ah
    metti(24, 123, 2)           # cicli
    metti(28, carica, 2)
    metti(32, 2981, 2)          # 25,0 gradi
    for i in range(4):
        metti(44 + i * 4, 3300, 2)
    return "^" + "".join(p)


class ProveRecordComeArriva(unittest.TestCase):

    def test_se_il_record_c_e_gia_non_si_aspetta_niente(self):
        f = Finto()
        f.flusso["testo"] = record()
        d, durata = asyncio.run(agente.ascolta_ective(
            f.flusso, 20, pausa=f.pausa, orologio=f.orologio))
        self.assertIsNotNone(d)
        self.assertEqual(d["carica"], 77)
        self.assertEqual(f.attese, [], "ha aspettato con il record gia' in mano")
        self.assertEqual(durata, 0.0)

    def test_ci_si_stacca_appena_il_record_e_intero(self):
        # Arriva al secondo 1: si deve tornare li', non al ventesimo.
        f = Finto(arrivi={1.0: record(42)})
        d, durata = asyncio.run(agente.ascolta_ective(
            f.flusso, 20, pausa=f.pausa, orologio=f.orologio))
        self.assertEqual(d["carica"], 42)
        self.assertLess(durata, 2.0, f"si e' staccato dopo {durata}s invece che a uno")

    def test_una_batteria_muta_ferma_il_giro_al_tetto(self):
        f = Finto()
        d, durata = asyncio.run(agente.ascolta_ective(
            f.flusso, 20, pausa=f.pausa, orologio=f.orologio))
        self.assertIsNone(d, "si e' inventata un record da un flusso vuoto")
        self.assertGreaterEqual(durata, 20)

    def test_il_tetto_non_si_sfora(self):
        # Il verso prudente: meglio staccarsi un po' prima che restare
        # attaccati piu' a lungo di quanto si e' promesso. La radio accesa
        # costa corrente alla batteria servizi.
        f = Finto()
        _d, durata = asyncio.run(agente.ascolta_ective(
            f.flusso, 20, fetta_s=7, pausa=f.pausa, orologio=f.orologio))
        self.assertLessEqual(durata, 21, f"e' rimasto attaccato {durata}s su un tetto di 20")

    def test_un_flusso_spezzato_non_conta_come_record(self):
        # Mezzo record non e' un record: si continua ad aspettare.
        f = Finto(arrivi={2.0: record(55)})
        f.flusso["testo"] = record()[:40]
        d, _durata = asyncio.run(agente.ascolta_ective(
            f.flusso, 20, pausa=f.pausa, orologio=f.orologio))
        self.assertEqual(d["carica"], 55)


class ProveCablaggio(unittest.TestCase):
    """Che il giro vero la usi: e' li' che stava il difetto."""

    def test_il_giro_non_aspetta_piu_un_tempo_fisso(self):
        sorgente = (QUI.parent / "agente.py").read_text(encoding="utf-8")
        i = sorgente.index("async def giro_bluetooth")
        corpo = sorgente[i:i + 2600]
        self.assertIn("ascolta_ective", corpo,
                      "il giro non usa l'ascolto che si ferma quando basta")
        self.assertNotIn('asyncio.sleep(conf.get("secondi_ective"', corpo,
                         "il giro aspetta ancora un tempo fisso")

    def test_si_scrive_nel_registro_quanto_c_e_voluto(self):
        # Senza questo numero, la prossima volta si ragiona di nuovo a naso su
        # un tempo scelto quando il programma e' nato.
        sorgente = (QUI.parent / "agente.py").read_text(encoding="utf-8")
        i = sorgente.index("async def giro_bluetooth")
        corpo = sorgente[i:i + 2600]
        self.assertRegex(corpo, r"log\.(info|debug)\([^)]*%\.1fs|log\.(info|debug)\([^)]*secondi",
                         "non si registra quanto ci ha messo la batteria")


if __name__ == "__main__":
    unittest.main()
