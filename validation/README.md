# Validation et préparation du paquet

Le préflight vérifie des contrats et la cohérence des preuves. Il ne transforme pas un test unitaire, un bouton ou une présence de fichier en réussite empirique. **Un paquet incomplet peut être produit pour revue; il garde son état incomplet et n’est jamais envoyé.**

```bash
python3 validation/preflight.py --json output/validation/preflight.json --provenance output/validation/provenance.json --package output/twinforge-review.zip
```

Code de sortie 0 : contrats complets pour une revue, sans certification scientifique. Code 1 : lacunes listées. Le préflight ne publie rien, n’appelle aucun modèle et ne lit pas les clés. L’archive suit une liste de types autorisés, exclut `.env`, `.git`, dépendances et sorties d’archives, puis inclut hashes, commit, état dirty et résultat du préflight. Une alerte de secret masque la valeur et bloque le paquet.

## Profil logiciel sans caméra ni dispositif physique

`--profile strict-pdf` reste la valeur par défaut : les 71 exigences ne sont pas affaiblies. `--profile simulation-only` vérifie le [périmètre logiciel explicite](../docs/SIMULATION_SCOPE.md) : cinq familles, expériences indépendantes, rejeu, perception comparée, budgets/adaptateurs, navigateur, dépendances locales et médias. Il garde `strict_pdf_satisfied=false` même en cas de réussite.

```bash
node validation/simulation_benchmark.mjs --out validation/runs/simulation-benchmark-new.json --seed 20261104
python3 validation/pin_simulation_evidence.py
python3 validation/preflight.py --profile simulation-only --json output/validation/preflight-simulation.json --provenance output/validation/provenance.json --package output/twinforge-simulation-review.zip
```

Le benchmark retourne 0 si tous ses critères numériques passent, 1 si une mesure échoue; une erreur de processus est distincte. Il conserve les observations brutes à côté du rapport. `simulation-manifest.json` désigne l’exécution examinée; changer ce chemin explicitement pour un nouveau run. L’épinglage conserve seulement les hashes des fichiers existants : il ne modifie aucun résultat, ne produit aucune preuve manquante et ne transforme pas une présence de fichier en validation.

`simulation-thresholds.json` fixe les critères avant mesure. Les premières exécutions échouées restent archivées, avec leurs raisons. Le préflight vérifie de nouveau les nombres et critères, les splits, les tests nommés et les sources courantes. Les erreurs du vieux rejeu restent visibles; l’acceptation d’exactitude utilise le jeu 3D indépendant, sans présenter ce jeu nouveau comme une réparation des anciennes images.

Pour conserver une preuve des tests logiciels sur les sources exactes, une fois les changements stabilisés :

```bash
.venv/bin/python validation/run_checks.py --out validation/runs/software-checks-2026-11-04.json
```

Ce lanceur exécute les tests Python et JavaScript, conserve sorties/codes retour et hashes des sources avant/après. Une modification pendant les tests invalide ce relevé; des tests logiciels qui passent ne valident pas les scènes réelles. Node.js est requis pour que la suite soit complète.

## Les preuves à enregistrer

`requirements.json` est la matrice des 71 exigences couvrant les neuf prompts; la version lisible est `docs/PROMPT_COMPLIANCE.md`. Chaque état `met` exige méthode de vérification et références. Les échéances historiques non satisfaites restent `not_met`.

Après modification des états et preuves dans le JSON, régénérer la version lisible avec `python3 validation/render_matrix.py`. Une exigence complète ne se déduit jamais d’une simple nouvelle référence de fichier.

`gauntlet-report.json` est initialement **un modèle non exécuté**. `gauntlet.schema.json` décrit la forme d’un rapport exécuté. Exporter les résultats de la scène puis conserver le journal brut dans un fichier séparé, avant de calculer son hash. Une preuve est un objet `{"path":"validation/runs/run.json","sha256":"…"}`; chemin relatif au dépôt, contenu immuable pour ce hash.

Dans l’état livré du 4 novembre, le rapport courant contient le parcours UI de simulation `14dede2b-5183-4756-8a26-9fb5e71e81c9`, couvrant les cinq scènes avec résultats partiels; ce n’est plus le modèle vierge. Chaque scène garde `validated=false`. Le parcours de la vidéo `79588c74-3899-45d3-8f7b-903060272b46` reste archivé séparément.

- Scènes, dans l’ordre : `hoop`, `multi`, `chaos`, `liquid`, `orbit`.
- Tests, dans l’ordre : `launch`, `bounce`, `hoop_passage`, `net`, `ghost_ahead`, `induction`, `control`.
- `pass` : exécution datée, méthode explicite, mesures non vides et preuves hashées. Le champ `induction` doit préciser « calibration L3 » dans cette version, sans revendiquer une induction libre.
- `not_applicable` : uniquement passage/filet/contrôle absent d’une scène sans ces éléments, avec raison. Une fonctionnalité cassée n’est pas « non applicable ».
- `blocked`, `fail` et `not_run` conservent la cause. `validated=true` n’est pas admis avec un test applicable incomplet.
- Métriques : erreur fantôme moyenne, verdicts corrects/total, collisions. `null` signifie non mesuré; zéro ne remplace pas une absence.

Les résultats de simulation restent `mode=simulation`. Ils ne valident ni la vidéo réelle, ni le rig. Le préflight strict attend la preuve réelle séparément dans `submission.json`.

Pour importer l’objet JSON renvoyé par `Twinforge.exportEvidence()` avec ses fichiers bruts et hashes : `python3 validation/import_run.py --input /chemin/browser-export.json --set-current`. Les preuves sont archivées sous `validation/runs/<run_id>/`, les références réécrites vers ces chemins sans altérer leur contenu, et le rapport courant remplacé seulement avec `--set-current`. L’import refuse un hash incorrect ou l’écrasement d’un run existant. Il garde tous les états bloqués et retourne 1 si le gauntlet est incomplet.

`ablations.json` conserve les comparaisons prescrites et sépare les compléments synthétiques : SAM contre suivi naïf, et modèle L3 calibré contre prior non ajusté. Cette seconde comparaison n’est pas l’induction libre contre moteur pré-fitté demandée par le PDF. Il faut deux valeurs, une métrique/unité, les IDs communs, les traces et hashes. Deux prompts SAM différents ne constituent pas une ablation de tracking.

`submission.json` garde les états des médias, liens, règles, licences, track/thème, preuve réelle et reçu portail. Ne renseigner `reviewed` qu’avec la méthode et l’étendue de la revue; une inspection par images clés et contrôles automatiques doit rester explicitement distincte d’un visionnage intégral. Ne renseigner `verified` qu’après le contrôle indiqué et son enregistrement. Une configuration de clé ou un HTTP 200 n’atteste pas la qualité fonctionnelle de la démo.

## Capturer la vidéo et le GIF

Lancer la version locale et enregistrer **150 secondes continues de l’application réellement exécutée**, suivant `docs/VIDEO_SCRIPT.md`. Utiliser une capture GPU réelle ou le navigateur automatisé; conserver la capture brute et les logs de la session. Ne pas réutiliser 27 secondes en boucle pour fabriquer 2 min 30. Montrer l’étiquette simulation et les limites.

Les sous-titres fournis sont un point de départ calé sur le script; les adapter à la prise réelle si le déroulement diffère. L’utilitaire n’invente aucun événement, n’allonge pas la durée et ne modifie pas la vitesse :

```bash
.venv/bin/python -m pip install imageio-ffmpeg
.venv/bin/python validation/media.py --input output/media/capture-raw.webm --subtitles docs/DEMO_SUBTITLES_FR.srt --output output/media/twinforge-demo.mp4 --gif output/media/ghost.gif
```

Il utilise `ffmpeg` ou le binaire `imageio-ffmpeg` de l’environnement, refuse une capture hors de 140–160 secondes, vérifie la couverture temporelle SRT, incruste les sous-titres et l’étiquette, puis produit un fichier de provenance. Le GIF extrait huit secondes de la séquence fantôme à partir de 35 s; ajuster `--gif-start` après revue.

Si l’application a déjà incrusté ses sous-titres et étiquettes dans la capture, remplacer `--subtitles ...` par `--already-captioned` pour éviter tout doublon. Ce mode conserve le contenu et la vitesse; la couverture réelle des sous-titres reste à vérifier au visionnage.

**La conversion seule garde le statut `produced_not_reviewed`.** Documenter ensuite la méthode de revue : textes, résultats, labels et synchronisation. Un visionnage intégral en muet reste le contrôle le plus complet; si la revue porte sur des images clés et contrôles automatiques, le préciser et garder `full_watch=false`. Les chiffres à l’écran doivent correspondre aux logs de cette prise. Ne pas afficher une illustration Muse Image comme capture physique.
