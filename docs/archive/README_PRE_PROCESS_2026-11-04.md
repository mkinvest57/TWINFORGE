Lance une balle vers un cerceau vertical. Obtiens son simulateur. Prédis si ça rentre — avant que la balle retombe.

# TWINFORGE

Meta Global AI Developer Hackathon 2026 · **Indie** · **Push the Frontier**

**État déclaré le 4 novembre 2026 : L3 — sélection et calibration de modèles physiques connus. L1 réel non démontré.** La démo navigateur simule la scène; elle ne commande aucun dispositif physique. Le pipeline vidéo doit être exécuté avec une acquisition réelle calibrée avant toute affirmation de validation dans le monde réel.

[Dépôt public](https://github.com/mkinvest57/TWINFORGE) · [Démo interactive publiée](https://mkinvest57.github.io/TWINFORGE/) · [Matrice des 9 prompts](docs/PROMPT_COMPLIANCE.md) · [Correction du statut historique](docs/STATUS_ADDENDUM_2026-11-04.md)

[Caméra mobile — HTTPS](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/scan.html) · [Page locale](scan.html) · [Utilisation sur téléphone](docs/MOBILE.md). Ce parcours suit un objet et prévoit brièvement son mouvement **dans le plan de l’image**; il ne reconstruit pas une scène physique 3D à partir d’une photo. Le site mobile statique HTTPS fonctionne sans serveur de modèles et sans clé API. Les preuves mobiles sont séparées de l’archive de simulation ci-dessous.

La version mobile passe **148 tests logiciels (87 Python, 61 JavaScript)** sur des sources stables; son [rapport](validation/runs/software-checks-mobile-2026-11-04.json) ne remplace pas les anciennes preuves de simulation. L’aperçu HTTPS est privé et peut demander la connexion au même compte ChatGPT. Les parcours ont été vérifiés localement avec des fenêtres mobiles et des flux synthétiques; l’exécution distante après connexion et une caméra de téléphone physique restent non vérifiées.

La version publiée peut être antérieure aux modifications locales. Le préflight exige de vérifier la révision finale sans connexion avant soumission. [Vidéo locale de simulation — 2 min 30](output/media/twinforge-demo-current.mp4) · [Provenance des médias](output/media/twinforge-demo-current.mp4.provenance.json).

![Fantôme +0,5 s dans la démonstration L3 en simulation](output/media/ghost-current.gif)

## Le projet

TWINFORGE vise un jumeau numérique à partir d’une vidéo : observer la scène, calibrer sa dynamique, prévoir la suite et évaluer des commandes. L’architecture comporte quatre étapes :

1. **Observer** : SAM 3.1 segmente les concepts; extraction déterministe, suivi des IDs, exclusions FP-01/FP-02 et calibration documentée. Une vidéo monoculaire sans profondeur ne devient pas artificiellement une mesure 3D.
2. **Calibrer — L3** : sélectionner un moteur connu et ajuster les paramètres observables. Les paramètres non identifiables restent des priors déclarés. Le fit n’est pas présenté comme l’écriture autonome d’une nouvelle physique.
3. **Prévoir** : fantôme à +0,5 s, trajectoire, incertitude Monte-Carlo, verdict verrouillé et erreur mesurée au bon instant.
4. **Contrôler en simulation** : planification MPC avec corrections chiffrées. Le contrôle sim-to-real est hors du périmètre démontré : aucun rig réel n’est présent.

Le thème « Push the Frontier » est la compréhension et la prévision des systèmes physiques. La conformité aux exigences ambitieuses du PDF reste mesurée exigence par exigence; elle ne se déduit pas du nombre de boutons de la démo.

## Stack Meta et preuves

| Brique | État de preuve |
|---|---|
| SAM 3.1 | Pipeline et artefacts d’un appel sur une vidéo générée par la scène 3D. Cela prouve une exécution API sur données synthétiques, pas un essai physique. |
| Muse Spark / Wonder | Muse Spark 1.3 a exécuté un [test de connexion](validation/runs/provider-smoke-2026-11-04.json) puis une [calibration L3 journalisée](validation/runs/scientist-live-2026-11-04.bundle.json) sur observations synthétiques. Aucune preuve d’exécution Wonder ni de test réel indépendant. |
| Muse Image | Une [illustration a été générée](validation/runs/muse-image-2026-11-04.json) avec Muse Image 1.0; elle ne prouve aucune trajectoire. |
| Muse Glimmer | Adaptateurs local et Together testés par contrats; aucune exécution Glimmer attestée faute d’endpoint/clé disponible. L’analyse locale déterministe fonctionne et porte son propre nom. |
| Muse Code | [Revue en lecture seule exécutée](validation/runs/muse-code-review-2026-11-04.json), terminée avec le modèle `muse-spark-1.3-contributor`; réponse finale et usage conservés. |

Les appels attestés ici utilisent Muse Spark 1.3 et son modèle contributor. La mention **Built with Muse Spark Open** ne s’appliquerait qu’à une exécution effectivement attestée de `meta-models/muse-spark-open-1026`, pas à sa simple configuration. Les clés restent côté serveur, dans l’environnement ou `.env` ignoré par Git.

## Statut et validation

Les artefacts historiques du 27–29 octobre portent sur une simulation et une vidéo synthétique. Le rapport SAM historique indique 35/39 frames détectées et un ID stable pendant le vol, mais plusieurs IDs après le passage. Ces résultats ne sont pas des performances sur vidéo téléphone.

Le périmètre logiciel **sans caméra ni dispositif physique** dispose maintenant d’un [profil de validation distinct](docs/SIMULATION_SCOPE.md). Il exige des expériences indépendantes, le rejeu causal, les adaptateurs et budgets, les cinq scènes, une capture de l’application et des sources hashées. Le profil PDF strict reste conservé et incomplet.

**Archive de simulation avant l’ajout mobile : 118 tests passent (84 Python, 34 JavaScript), avec sources stables et préflight `simulation-only` sans écart sur cette version.** Le [parcours navigateur archivé](validation/runs/6ef874e6-0f94-4e6d-bf45-958444d399e6/report.json) mesure lancement et fantôme dans les cinq scènes. Le [paquet de cette version](output/twinforge-simulation-review.zip) reste inchangé. Les modifications mobiles ont leurs propres preuves; les anciens hashes ne sont pas présentés comme ceux de la nouvelle version. La réussite du périmètre logiciel archivé ne vaut ni validation physique ni conformité intégrale au PDF.

Sur un [nouveau jeu 3D synthétique indépendant](induction/benchmarks/independent-3d-2026-11-04/benchmark.json), généré par RK4 avec bruit de mesure de 2 mm puis ajusté par un autre intégrateur, le fantôme causal à +0,5 s atteint **1,016 cm de moyenne**, **2,299 cm au maximum**, sur **30/30 prédictions évaluables sous 5 cm**. Il y a 48 instants planifiés, 45 prévisions émises et 15 cibles après la fin des observations; leur absence de score reste explicite. Les tirs d’entraînement, validation et test sont distincts. Ce capteur numérique n’est ni SAM, ni une caméra réelle.

Le [benchmark des cinq familles](validation/runs/simulation-benchmark-exact-clock-2026-11-04.json) identifie des paramètres masqués à partir de préfixes, gèle les modèles puis évalue d’autres épisodes. Il mesure les contrefactuels, les contacts sol/planche/arceau/filet, l’incertitude, le bilan de liquide et la recalibration orbitale. Le MPC réussit les trois tirs et un détour autour d’un obstacle qui intercepte le tir sans contrôle, avec trois corrections au plus, espacées exactement de 120 ms. Ces familles sont connues et les observations de ce benchmark sont sans bruit; les très petites erreurs ne sont pas une performance de vision.

Une [comparaison SAM contre suivi naïf](validation/runs/synthetic-perception-comparison-cone-v2.json) évalue les mêmes 24 frames synthétiques : SAM détecte 23/24, le suivi naïf 24/24. Sur leurs 23 détections communes, l’erreur de centre est de **0,163 px pour SAM et 0,186 px pour le naïf**, mais l’erreur 3D est de **12,60 cm contre 6,50 cm**. SAM ne gagne donc pas sur la profondeur. Les sorties ont été gelées avant lecture de la vérité; le recalage de 0,5 px suit la convention WebGL, il ne constitue pas un gain du réseau. Les **1,016 cm du capteur numérique** ci-dessus ne sont pas une performance SAM.

La géométrie de reconstruction sphérique est testée séparément sur [24 cas analytiques](validation/runs/sphere-geometry-analytic-v2.json) : **0,521 cm en moyenne, 2,166 cm au maximum**, avec silhouettes idéales. Les erreurs de segmentation/profondeur de la vidéo restent dans le rapport : SAM passe de 12,48 à 12,60 cm sur ce clip, une légère régression explicitement conservée.

Les [nouveaux contrôles du 4 novembre](validation/runs/api-calibration-2026-11-04.json) séparent trois tirs **synthétiques** d’entraînement, validation et test, et refusent leur recouvrement. Sur le même tir de test indépendant, la [comparaison numérique](validation/runs/ablation-calibrated-vs-prior-2026-11-04.json) mesure **0,810 cm** d’erreur moyenne pour le moteur L3 calibré, contre **6,509 cm** pour le prior non ajusté. Ce résultat logiciel n’est ni une mesure physique, ni une ablation d’induction libre contre moteur pré-fitté.

Le [premier essai SAM du 4 novembre](validation/runs/sam-perception-2026-11-04.json) reste archivé : **32/37 frames traitées**, arrêt HTTP 503 après 37/64 frames prévues, non calibré. La nouvelle comparaison complète sur 24 frames est décrite ci-dessus; ses résultats ne réécrivent pas cet essai partiel.

Le « GO L1 » historique est conservé comme archive et **n’est plus utilisé pour affirmer L1 réel**. Le chiffre historique 8,4 cm est la moyenne affichée pour le dernier tir, pas une moyenne validée sur toute la série. Voir [l’addendum daté](docs/STATUS_ADDENDUM_2026-11-04.md).

Les cinq scènes ont été exercées dans un [parcours UI de simulation enregistré](validation/runs/14dede2b-5183-4756-8a26-9fb5e71e81c9/report.json), avec source et événements hashés. Le lancer et le fantôme passent dans les cinq scènes; passage au cerceau et filet passent pour le panier. Les tests de rebond non exécutés, le contrôle de ce parcours non exécuté et la calibration indépendante bloquée restent visibles. **Aucune des cinq scènes n’est déclarée entièrement validée.** Le [rapport courant](validation/gauntlet-report.json) conserve ces états et les [ablations](validation/ablations.json) séparent les comparaisons synthétiques des expériences originales manquantes.

Le moteur partagé inclut les contacts et un filet physique; le MPC évalue des séquences candidates et journalise aussi son temps de calcul et les dépassements de cadence. Le compteur d’erreur distingue la moyenne de session de celle d’un enregistrement importé. L’export de la démo fournit rapport, événements et hashes; les scènes sans calibration indépendante restent bloquées. Le liquide est un modèle de bilan de volume, pas un solveur CFD validé.

La capture finale, sa durée, les événements et la méthode de revue sont consignés dans [le manifeste des médias](validation/submission.json). Le [premier parcours filmé](validation/runs/79588c74-3899-45d3-8f7b-903060272b46/report.json) reste archivé avec 6/7 verdicts corrects et 2,324 cm de moyenne session; ces chiffres historiques ne sont pas réutilisés pour une nouvelle prise.

La [nouvelle prise](validation/runs/23119d61-07be-492d-a370-9f996c889760/report.json) dure **149,833 s** et conserve **6/7 verdicts corrects**, **2,044 cm** de moyenne session et six corrections MPC, dont une dégradation visible. Les 13 sections ont été inspectées sur images clés et les 3 596 frames décodées contrôlées automatiquement; aucun visionnage sémantique intégral n’est revendiqué. Les événements de tirs/contrefactuels/MPC ont été récupérés et hashés; le journal précis des changements de sous-titres n’a pas été sauvegardé et n’est pas reconstitué artificiellement.

Manquent encore pour satisfaire intégralement les prompts : preuve réelle calibrée de bout en bout, validation empirique du gauntlet, contrôle physique (coupé), séquences de tir réel, validation de la publication et preuve de soumission. Les échéances historiques manquées ne sont pas antidatées.

## Lancer

Python 3.9+ (version utilisée pour les tests), Node.js pour les masques et tests JavaScript. Three.js est [embarqué avec sa licence MIT et ses hashes](assets/vendor/three/manifest.json) : la simulation n’exige plus de CDN. Ne pas exposer ce serveur de développement sur Internet.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm install --prefix perception
.venv/bin/python server.py
```

Ouvrir `http://localhost:8000`. La scène de simulation fonctionne sans clé. Pour les modèles, créer `.env` depuis `.env.example` si nécessaire et renseigner les variables documentées, puis relancer le serveur. Ne jamais copier une clé dans le navigateur, un journal ou la soumission.

Perception et calibration vidéo :

```bash
.venv/bin/python perception/sam_perception.py --help
.venv/bin/python induction/induce.py --help
```

Exemple après acquisition d’un tir réel et de sa calibration :

```bash
.venv/bin/python perception/sam_perception.py --video /chemin/tir.mp4 --calibration /chemin/calibration.json --source-kind real --out perception/runs/tir-a
.venv/bin/python induction/induce.py --train perception/runs/tir-a/trajectories.json --test perception/runs/tir-b/trajectories.json --out-json induction/current/induced_twin.json --out-journal induction/current/induction_journal.md --bundle induction/current/bundle.json
```

`tir-b` doit être un tir distinct, traité au préalable par le même pipeline. Aucun score sur fenêtre du tir d’entraînement n’est annoncé comme performance sur des tirs indépendants. Lire [le guide perception](perception/README.md) pour le contrat de calibration et les limites observables.

Le [nouvel exemple de l’interface](assets/calibrated-synthetic-bundle.json) contient un tir de test 3D synthétique bruité et un modèle calibré sur d’autres tirs. Le [bundle historique](induction/current/bundle.json) reste disponible avec sa portée propre et ses limitations. Les [templates de calibration](perception/calibration_templates/plane.json) doivent être remplacés par des mesures; les exemples sont volontairement refusés tant que leur marqueur `example_only` reste actif.

Le [contrôle initial du rejeu historique](validation/runs/browser-review-2026-11-04.json) affichait 46,7 cm. L’estimation d’état a été corrigée pour n’utiliser que le passé, avec traitement explicite des discontinuités et contacts. Le [diagnostic sur les mêmes frames brutes](induction/current/replay_diagnostic.json) conserve **39,165 cm sur toutes les 7 prévisions évaluables de sa grille fixe**, contre 48,947 cm avant correction aux mêmes instants. Les 3,788 cm du sous-ensemble supporté ne remplacent pas cette moyenne globale. Le vieux montage et sa calibration plane ne permettent pas de reconstruire rétrospectivement une mesure 3D exacte; le nouveau benchmark indépendant est présenté séparément.

## Vérifier et préparer le paquet

```bash
.venv/bin/python validation/run_checks.py --out validation/runs/software-checks-mobile-2026-11-04.json
```

Le parcours mobile conserve son propre relevé et son propre paquet, décrits dans [le guide mobile](docs/MOBILE.md). Les rapports et le ZIP de simulation précédents restent des archives. Ne pas écraser leur relevé ni réépingler leurs preuves après une modification des sources : une nouvelle campagne de simulation nécessite de réexécuter ses expériences et son parcours UI.

Les préflights de simulation et du PDF restent disponibles dans [le guide de validation](validation/README.md). Chaque profil retourne **1 tant que ses exigences restent ouvertes**. Épingler les hashes n’ajoute aucun statut de réussite. Le profil strict PDF reste la valeur par défaut et demeure incomplet pour les preuves physiques et historiques. Aucun préflight ne publie ni ne soumet le projet.

[Guide de validation et médias](validation/README.md) · [Brouillon de soumission](docs/SUBMISSION.md) · [Script vidéo 2 min 30](docs/VIDEO_SCRIPT.md) · [Licences tierces inspectées](docs/THIRD_PARTY.md)
