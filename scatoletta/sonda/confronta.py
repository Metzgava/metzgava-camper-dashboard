# Confronta tutte le fotografie di un apparecchio e mostra solo i registri che
# si muovono.
#
# E' lo strumento che identifica i registri. Un registro fermo non dice niente:
# puo' essere un numero di serie, una costante, o una potenza che resta a zero
# perche' non entra corrente. Un registro che cambia fra uno scatto e l'altro si
# puo' invece mettere accanto a quel che e' cambiato nel mondo — motore acceso,
# colonnina attaccata, 220 accesa — e quello e' l'unico modo onesto di dargli un
# nome.
#
#   confronta.py el300        tutti gli scatti dell'Elite 300
#   confronta.py charger      tutti gli scatti del caricatore
#   confronta.py el300 6      solo gli ultimi sei scatti
import glob
import json
import os
import sys

CARTELLA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "foto")


def carica(prefisso, ultimi=None):
    """Le fotografie di un apparecchio, in ordine di tempo."""
    percorsi = sorted(glob.glob(os.path.join(CARTELLA, f"{prefisso}-*.json")))
    if ultimi:
        percorsi = percorsi[-ultimi:]
    scatti = []
    for p in percorsi:
        with open(p) as f:
            d = json.load(f)
        # Le chiavi di un JSON sono stringhe: i registri tornano numeri.
        registri = {int(k): v for k, v in d.get("registri", {}).items()}
        scatti.append((d.get("quando", os.path.basename(p)), registri))
    return scatti


def main():
    if len(sys.argv) < 2:
        print("serve il nome dell'apparecchio: el300 oppure charger")
        return 1
    prefisso = sys.argv[1].lower()
    ultimi = int(sys.argv[2]) if len(sys.argv) > 2 else None

    scatti = carica(prefisso, ultimi)
    if len(scatti) < 2:
        print(f"servono almeno due fotografie di {prefisso}: ne ho {len(scatti)}")
        return 1

    # Un registro interessa se non ha lo stesso valore in tutti gli scatti. Chi
    # manca in uno scatto conta come assente, non come zero: la differenza fra
    # «non risponde» e «risponde zero» e' esattamente quel che stiamo cercando.
    tutti = sorted({r for _, reg in scatti for r in reg})
    mossi = [r for r in tutti
             if len({reg.get(r, "-") for _, reg in scatti}) > 1]

    print(f"{len(scatti)} fotografie di {prefisso}, "
          f"dalle {scatti[0][0][11:19]} alle {scatti[-1][0][11:19]}")
    print(f"{len(tutti)} registri visti, {len(mossi)} si muovono\n")
    if not mossi:
        print("nessun registro si e' mosso: le condizioni non sono cambiate")
        return 0

    ore = [q[11:16] for q, _ in scatti]
    print("reg   " + "".join(f"{o:>8}" for o in ore))
    print("-" * (6 + 8 * len(ore)))
    for r in mossi:
        valori = [reg.get(r) for _, reg in scatti]
        celle = "".join(f"{'-' if v is None else v:>8}" for v in valori)
        print(f"{r:<6}{celle}")
    return 0


sys.exit(main())
