#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genere engine.js : le moteur Python embarque dans un fichier JavaScript.

Pourquoi embarquer plutot que fetch()
-------------------------------------
La version precedente telechargeait engine/*.py au demarrage. Un seul chemin
faux et le serveur renvoie une page d'erreur HTML avec un statut 404 -- que
fetch().text() retourne sans broncher. Cette page HTML etait ensuite ecrite
dans bridge.py et executee comme du Python :

    File "/home/pyodide/bridge.py", line 14
      .container { margin: 50px auto 40px auto; ... }
    SyntaxError: invalid decimal literal

Ce n'est pas un cas tordu : c'est ce qui arrive des que l'arborescence n'est
pas exactement celle attendue. Embarquer le source supprime la classe entiere
de pannes -- plus de chemin relatif, plus de 404, plus rien a mettre en cache,
plus de dependance a la maniere dont les fichiers ont ete deposes.

Et l'unicite de l'implementation ?
----------------------------------
engine.js est un ARTEFACT DE BUILD, pas une seconde implementation. Il est
regenere depuis les fichiers canoniques, et ce script verifie par empreinte
SHA-256 que le contenu embarque est bit pour bit celui des .py de reference.
Si tu modifies energie.py, relance ce script.

    python build.py
"""

import hashlib
import json
import os
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(ICI, "engine")
SORTIE = os.path.join(ICI, "engine.js")
MODULES = ["stats", "energie", "perfs", "bridge"]

# Fichiers canoniques : ceux que l'application Mac importe reellement.
# Le moteur doit etre identique des deux cotes, et on le prouve.
CANONIQUES = {
    "stats": os.path.join(ICI, "..", "stats.py"),
    "energie": os.path.join(ICI, "..", "energie.py"),
    "perfs": os.path.join(ICI, "..", "perfs.py"),
}


def sha(txt):
    return hashlib.sha256(txt.encode("utf-8")).hexdigest()


def main():
    sources, empreintes = {}, {}
    for m in MODULES:
        p = os.path.join(SOURCE, m + ".py")
        if not os.path.exists(p):
            print(f"ERREUR : {p} introuvable")
            return 1
        with open(p, encoding="utf-8") as fh:
            src = fh.read()
        sources[m] = src
        empreintes[m] = sha(src)

    # Verification d'identite avec les fichiers de l'application Mac.
    print("Verification moteur Mac <-> iPhone")
    ecarts = 0
    for m, chemin in CANONIQUES.items():
        chemin = os.path.normpath(chemin)
        if not os.path.exists(chemin):
            print(f"  ? {m:8s} canonique absent ({chemin})")
            continue
        with open(chemin, encoding="utf-8") as fh:
            ref = sha(fh.read())
        if ref == empreintes[m]:
            print(f"  = {m:8s} identique  ({ref[:12]}…)")
        else:
            print(f"  ! {m:8s} DIVERGENT")
            print(f"      Mac    : {ref[:16]}…")
            print(f"      iPhone : {empreintes[m][:16]}…")
            ecarts += 1
    if ecarts:
        print(f"\n{ecarts} divergence(s). Recopie les fichiers canoniques dans "
              f"engine/ avant de builder.")
        return 1

    # json.dumps produit un litteral de chaine JS valide : il echappe les
    # guillemets, les antislashes, les sauts de ligne et l'unicode. Ecrire
    # l'echappement a la main serait une source de bugs gratuite.
    lignes = [
        "/* engine.js — GENERE PAR build.py, NE PAS EDITER A LA MAIN.",
        " *",
        " * Le moteur Python embarque. Aucun fetch, donc aucun chemin relatif",
        " * a se tromper et aucune page 404 qui finirait interpretee comme du",
        " * Python. Regenere avec : python build.py",
        " */",
        "window.ENGINE = {",
        "  modules: " + json.dumps(MODULES) + ",",
        "  sha: " + json.dumps(empreintes, indent=4) + ",",
        "  src: {",
    ]
    for m in MODULES:
        lignes.append(f"    {m}: {json.dumps(sources[m])},")
    lignes += ["  }", "};", ""]

    with open(SORTIE, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lignes))

    taille = os.path.getsize(SORTIE)
    print(f"\nengine.js genere : {taille / 1024:.1f} Ko, {len(MODULES)} modules")
    for m in MODULES:
        print(f"  {m:8s} {len(sources[m]):6d} car.  sha {empreintes[m][:12]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
