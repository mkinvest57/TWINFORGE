# TWINFORGE — Une décision. Deux futurs.

Un chariot déclenche une chaîne de collisions. Vous pouvez agir une seule fois : freiner, dévier, ou attendre. Twinforge calcule les conséquences de chaque commande, cherche la plus petite intervention admissible et montre les deux futurs côte à côte.

[Ouvrir la démo](https://mkinvest57.github.io/TWINFORGE/) · [Journal Meta vérifiable](assets/causal-meta-session.json) · [Dossier concours](docs/SUBMISSION.md) · [Caméra mobile](https://mkinvest57.github.io/TWINFORGE/scan.html)

## Une décision dont on peut vérifier les conséquences

Trois épreuves civiles : réaction en chaîne, intersection aveugle et passage critique. La page compare **37 commandes** sur un horizon de **12 secondes simulées**. L’utilisateur peut choisir une autre commande, changer la vitesse initiale, retarder l’intervention, relire les branches au même instant et exporter les données.

Les trajectoires sont calculées et figées **avant le rejeu**. Le curseur lit ces données; il ne dessine pas une prévision réajustée sur la position suivante. Les deux branches partagent l’état initial et le modèle physique; seule la commande change.

Le scénario `cascade`, graine `20261104`, vitesse `100 %`, action à `0,25 s` donne :

| Choix | Choc maximal sur la charge protégée | Impulsion de commande |
|---|---:|---:|
| Ne rien changer | 116,562 J | 0 N·s |
| Meilleure commande parmi les 37 testées : déviation +0,20 rad | **0 J** | **39,190 N·s** |
| Proposition Meta retenue : déviation −0,32 rad | **4,564 J** | **62,540 N·s** |

Le seuil de **8 J** est un critère arbitraire de cette expérience, fixé avant le calcul. Ce n’est pas un seuil industriel de dommage ou une certification de sécurité. Le score mesure l’énergie cinétique normale relative avant contact, maximale parmi les contacts impliquant la charge protégée; il ne signifie pas « zéro collision dans tout l’entrepôt ».

Dans cette cascade, la grille des retards trouve une commande admissible à `0,25 s`, mais aucune à `0,50 s`. La recherche couvre neuf retards de `0` à `2 s` par pas de `0,25 s` : elle ne prouve pas une frontière continue exacte.

La sensibilité reste visible. La commande nominale est réévaluée avec la vitesse du chariot à `95 %`, `100 %` et `105 %`. La cascade passe les trois essais; le meilleur choix nominal de l’intersection n’en passe qu’un. Trois essais ne sont ni une probabilité de succès ni une garantie physique.

[Benchmark reproductible des trois épreuves](validation/runs/causal-benchmark-2026-11-04.json) · [Revue du moteur](validation/runs/causal-engine-review-2026-11-04.json)

## Meta propose, la physique vérifie

Une session réelle de **Muse Spark 1.3**, exécutée le 4 novembre 2026, a produit trois propositions. Spark reçoit la géométrie, les paramètres et le menu d’actions admissibles. Après chaque appel, le solveur mesure la proposition; seul cet historique est transmis à l’appel suivant. Les scores de la recherche exhaustive ne lui sont pas montrés.

| Appel | Proposition à 0,25 s | Choc maximal mesuré | Critère 8 J |
|---|---|---:|---|
| 1 | Dévier de −0,16 rad | 104,609 J | Échec |
| 2 | Dévier de −0,36 rad | 8,485 J | Échec |
| 3 | Dévier de −0,32 rad | 4,564 J | Réussi dans ce modèle |

**3 appels, 37,86 secondes, 0,028276 USD** selon les usages conservés. Les réponses originales, reçus, hashes et évaluations sont dans le [journal public](assets/causal-meta-session.json). L’interface identifie sa relecture comme une session enregistrée; les nouvelles études passent par le serveur Python local.

La recherche exhaustive locale fait mieux sur ce petit espace de 37 actions : moins de choc et moins d’effort. Le résultat démontré est une boucle de **proposition, contradiction numérique et révision**, pas une supériorité de Meta sur le solveur. Le simulateur calcule les conséquences; Meta ne produit pas les chiffres affichés.

## Modèle et limites

Les positions, vitesses, masses et coefficients sont fournis. Des corps rigides circulaires se déplacent dans un plan; la vue 3D représente leurs enveloppes de contact. Le moteur utilise un amortissement linéaire, des impulsions de collision sans frottement tangent et un pas de calcul de `1/240 s`. Une commande est un changement instantané et borné de vitesse ou de direction; la dynamique d’un actionneur réel n’est pas modélisée.

C’est une comparaison contrefactuelle dans **un modèle connu**. Elle ne démontre ni apprentissage de lois à partir d’une vidéo, ni précision prédictive indépendante, ni contrôle d’un robot physique. La caméra mobile est un outil distinct de suivi et d’extrapolation **2D en pixels**; elle ne reconstruit pas ces scènes industrielles.

Les contrôles du moteur couvrent conservation d’énergie et de quantité de mouvement lors d’un contact élastique, restitution, solution analytique de l’amortissement, séparation des corps, bornes des commandes, métriques issues des contacts et immutabilité des trajectoires. Le pas divisé par deux conserve l’admissibilité des trois commandes sélectionnées; la variation des pics d’énergie de référence reste sous 3 % sur ces trois cas.

## Lancer et vérifier

Python 3.9+ et Node.js. La simulation, la recherche locale et la relecture du journal fonctionnent sans clé. Les clés nécessaires à de nouveaux appels Meta restent côté serveur.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python server.py
```

Ouvrir `http://localhost:8000`. Le serveur écoute uniquement sur la machine locale.

```bash
# Recherche numérique gratuite : aucun appel de modèle
.venv/bin/python -m twinforge_runtime.causal_lab --out output/causal-local.json

# Benchmark de physique et des trois scénarios
node validation/causal_benchmark.mjs output/causal-benchmark.json

# Vérifications complètes pour les sources courantes
.venv/bin/python validation/run_checks.py --out output/software-checks-causal.json
```

Pour une nouvelle étude payante, cocher l’option Meta de l’interface ou ajouter `--models` à la commande de l’étude. Maximum trois propositions, **plafond de 0,12 USD par étude**, sous le plafond persistant de **0,50 USD pour la scène `causal`**. Une erreur ne déclenche pas de nouvel essai automatique. Les garde-fous HTTP refusent les origines externes, les hôtes non locaux, les champs inconnus et les corps JSON trop grands.

## Vérifications de cette refonte

**221 tests passent : 114 Python et 107 JavaScript.** Le [rapport complet](validation/runs/software-checks-causal-release-2026-11-04.json) couvre les sources de la livraison. Le [parcours navigateur](validation/runs/causal-browser-2026-11-04/browser-review.json) vérifie la lecture, les échecs, les exports, la session Meta enregistrée, une nouvelle étude gratuite et les largeurs 320, 390, 768 et 1280 pixels. Les [corrections de l’atelier](validation/runs/legacy-repair-2026-11-04/) ont leurs propres preuves.

## Périmètre de la présentation

Le laboratoire causal remplace la cuve en page d’accueil. La cuve et l’orbite ne font plus partie du parcours de présentation. Les essais historiques et leurs preuves restent archivés; ils ne deviennent pas des résultats de cette nouvelle expérience. L’atelier du pendule et la caméra gardent leur portée propre.

[Script FR de trois minutes](docs/VOICEOVER_3MIN_FR.txt) · [English script](docs/VOICEOVER_3MIN_EN.txt) · [Storyboard](docs/VIDEO_3MIN_STORYBOARD.json) · [Sous-titres FR provisoires](docs/CAUSAL_DEMO_SUBTITLES_FR.srt)

Ces fichiers préparent le montage. Ils ne prouvent pas encore la production de la voix ni le rendu d’une nouvelle vidéo finale. Le [dossier PDF historique](docs/PROMPT_COMPLIANCE.md) conserve ses exigences et ses lacunes; une expérience logicielle ne remplace pas rétroactivement ses exigences physiques.

[Historique de la première version](docs/archive/README_PRE_PROCESS_2026-11-04.md) · [Version intermédiaire archivée](docs/archive/README_PROCESS_2026-11-04.md) · [Licences](docs/THIRD_PARTY.md)
