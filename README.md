# Suivi — panneau (PWA iPhone)

Le moteur d'analyse tourne **dans Safari**, en Python compile en WebAssembly.
Aucun serveur, aucun compte, aucune donnee qui sort du telephone.

## Mise en ligne (5 minutes, gratuit, sans maintenance)

Une PWA a besoin d'une URL **https** : iOS refuse d'installer un service worker
depuis un `file://`. « Pas de serveur » ne veut pas dire « pas d'URL » — mais
un hebergement statique n'est pas un serveur : rien a mettre a jour, rien a
surveiller, rien qui tombe.

1. **Decompresse `suivi-pwa.zip`** — l'arborescence compte, ne recopie pas les
   fichiers un par un.
2. Cree un depot GitHub, par exemple `suivi`.
3. Depose **tout le contenu decompresse** a la racine du depot. `index.html`,
   `app.js`, `engine.js` et `.nojekyll` doivent etre a la racine.
4. Settings → Pages → Source : `Deploy from a branch`, branche `main`, dossier `/`.
5. Attends ~1 min : `https://<ton-pseudo>.github.io/suivi/`

Verification rapide : ouvre `https://<...>/engine.js` dans un navigateur. Tu
dois voir du JavaScript. Si tu vois une page « 404 », les fichiers ne sont pas
a la racine.

Depot **prive** si tu veux : GitHub Pages sert alors le site publiquement mais
le code reste prive. De toute facon aucune donnee n'est dans le depot — elles
vivent uniquement dans le navigateur de ton telephone.

## Installation sur l'iPhone

1. Ouvre l'URL dans **Safari** (pas Chrome : iOS ne laisse que Safari installer
   une PWA).
2. Partager → **Sur l'ecran d'accueil**.
3. Lance depuis l'icone : plein ecran, sans barre d'adresse.

Au premier passage sur l'onglet Analyse, Pyodide se telecharge (~6 Mo) puis
reste en cache. Ensuite tout fonctionne hors-ligne, y compris en mode avion.

## Charger tes donnees

Saisie → Importer → choisis `suivi_coach_data.json`.
33 jours et 24 seances arrivent d'un coup.

## Sauvegarde — a ne pas negliger

iOS peut vider le stockage local d'une web app quand l'espace manque. Le
bouton **Exporter** ecrit un `.json` dans Fichiers : c'est ta seule sauvegarde,
et il se reimporte tel quel dans l'application Mac. Le format est identique
des deux cotes.

## Architecture

    index.html + app.js      interface, saisie instantanee en JS pur
    engine.js                le moteur Python embarque (genere par build.py)
    engine/bridge.py         adaptateur JSON <-> moteur, zero logique metier
    engine/energie.py        \
    engine/perfs.py           >  identiques a l'application Mac (verifie en SHA-256)
    engine/stats.py          /
    build.py                 regenere engine.js depuis engine/*.py

Le moteur est **embarque dans engine.js**, pas telechargee au demarrage. La
premiere version faisait `fetch("engine/bridge.py")` sans verifier le statut
HTTP : au moindre chemin faux, le serveur renvoyait une page d'erreur HTML que
le code ecrivait dans `bridge.py`, et Pyodide essayait d'executer du CSS comme
du Python. Embarquer supprime la classe entiere de pannes.

Si tu modifies `engine/*.py`, relance `python build.py` : il regenere
`engine.js` et verifie par empreinte que le moteur reste identique a celui de
l'application Mac.

Pyodide n'est charge **que** si tu ouvres Analyse ou Perfs : la saisie
quotidienne ne paie jamais le cout de demarrage du moteur.

Le moteur est en stdlib pure — c'est pour ca que numpy a ete retire. Sans lui,
Pyodide fait ~6 Mo et demarre en 1-2 s ; avec, ~15 Mo et 5-10 s. Et surtout :
`energie.py` et `perfs.py` sont les **memes fichiers** sur Mac et sur iPhone.
Une seule implementation, donc aucune divergence possible.
