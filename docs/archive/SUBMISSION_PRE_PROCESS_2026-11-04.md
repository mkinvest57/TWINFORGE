# TWINFORGE — brouillon de soumission, non envoyé

**Track : Indie. Thème : Push the Frontier. Niveau déclaré le 4 novembre 2026 : L3, calibration de moteurs physiques connus. L1 réel non démontré.**

Lance une balle vers un cerceau vertical. Obtiens son simulateur. Prédis si ça rentre — avant que la balle retombe.

[Dépôt](https://github.com/mkinvest57/TWINFORGE) · [Démo interactive](https://mkinvest57.github.io/TWINFORGE/). Vérifier que ces liens servent la version finale après publication. Ce document ne constitue pas une confirmation de soumission Cerebral Valley.

## Ce qui est construit

Une scène 3D interactive, un pipeline SAM 3.1 de segmentation et de suivi, un système de calibration physique, une prévision fantôme et un contrôleur MPC en simulation. L’objectif est de rendre chaque prédiction contestable : modèle, paramètres, incertitudes, instant de verrouillage et erreur doivent être accessibles.

L’architecture est observer → calibrer un moteur connu → prévoir → contrôler en simulation. La calibration ne se présente pas comme de l’induction libre. La perception conserve la provenance et les limites de reconstruction; la métrique tenue à l’écart exige des tirs distincts des données d’ajustement et de sélection.

Le moteur du navigateur est partagé entre prévision et planification, avec contacts et filet dynamique. Le contrôleur utilise des séquences candidates; il expose corrections, coût, temps de calcul et éventuels dépassements de la cadence de 120 ms. L’export du gauntlet associe les assertions à leurs événements mesurés et à des fichiers hashés. Ces mécanismes logiciels ne transforment pas les explorations en expériences physiques validées.

SAM a été exécuté sur une vidéo générée par le simulateur; cela ne démontre pas un tir réel filmé de bout en bout. Il n’y a pas de rig physique. Les cinq familles disposent maintenant d’expériences de calibration et prédiction synthétiques distinctes de leur parcours UI; elles ne sont pas déclarées physiquement validées.

## Périmètre logiciel achevé sans matériel

Le [profil simulation-only](SIMULATION_SCOPE.md) exige des preuves numériques, les sources courantes, la séparation des tirs, les budgets et adaptateurs, la vidéo de l’application réellement exécutée et un parcours des cinq scènes. Sa réussite ne signifie pas la réussite du profil PDF strict.

Le nouveau capteur numérique 3D bruité (2 mm) utilise un plant RK4 indépendant de l’intégrateur d’ajustement. Son fantôme causal à +0,5 s mesure **1,016 cm en moyenne, 2,299 cm au maximum, 30/30 prévisions évaluables sous 5 cm**. Les trois tirs d’entraînement, deux de validation et trois de test sont distincts. 45 prévisions sont émises sur 48 instants planifiés; quinze cibles après la fin des observations ne reçoivent pas de score. Source : `induction/benchmarks/independent-3d-2026-11-04/benchmark.json`.

Le benchmark des cinq familles calibre des paramètres masqués à partir de préfixes, fige le modèle puis révèle les tests. Il exerce contacts, contrefactuels, bilan de liquide, divergence du pendule et recalibration orbitale. Le contrôle réussit trois tirs et un défi d’obstacle interceptant la trajectoire nominale; il applique au plus trois corrections à cadence exacte de 120 ms, avec **88,34 ms** de calcul maximal dans le rapport `validation/runs/simulation-benchmark-exact-clock-2026-11-04.json`. Les observations sont exactes dans ce benchmark L3, ce qui explique ses très petites erreurs.

La comparaison SAM/naïf sur 24 frames synthétiques est enregistrée dans `validation/runs/synthetic-perception-comparison-cone-v2.json`. SAM détecte 23/24, le naïf 24/24. Sur les 23 frames communes, les erreurs de centre sont **0,163 px et 0,186 px**, mais les erreurs 3D sont **12,60 cm et 6,50 cm** respectivement. SAM ne gagne pas sur la profondeur; sa légère régression de 12,48 à 12,60 cm après correction géométrique reste visible. Le recalage de 0,5 px relève de la convention d’image, pas d’un meilleur réseau. Les sorties ont été gelées avant lecture de la vérité. Les 1,016 cm du capteur numérique indépendant ne sont pas une performance SAM.

Le défaut du rejeu historique a été corrigé côté estimation d’état, sans effacer ses limites : mêmes sept instants, **48,947 → 39,165 cm** sur toutes les prévisions évaluables; seulement deux prévisions supportées à 3,788 cm. Ce sous-ensemble ne remplace jamais le score global. Le modèle ne récupère pas les timestamps physiques ni la calibration métrique absents du vieux montage. Le nouvel exemple indépendant est une preuve séparée.

## Preuves et chiffres

| Affirmation | Source et limite |
|---|---|
| SAM historique : 35/39 frames avec balle détectée | `perception/output/report.md`; vidéo synthétique; plusieurs IDs après le vol. |
| Premier essai SAM du 4 novembre, conservé : 32/37 frames traitées, un ID | `validation/runs/sam-perception-2026-11-04.json`; vidéo synthétique, non calibrée; arrêt HTTP 503 après 37/64 frames prévues. La nouvelle comparaison de 24 frames est une autre exécution. |
| Comparaison L3 calibré contre prior non ajusté : 0,810 cm contre 6,509 cm | `validation/runs/ablation-calibrated-vs-prior-2026-11-04.json`; même tir synthétique de test indépendant, familles connues; aucun résultat réel déduit. |
| Ancienne série navigateur : 8/10 verdicts corrects dans le sous-ensemble « fresh » | `docs/gate_series_2026-10-29.json`; cinq trajectoires répètent les réglages d’entraînement, un relevé final est incomplet. |
| Ancienne valeur 8,4 cm | Moyenne affichée pour le dernier tir, **pas** moyenne validée de session. Voir addendum. |
| Calibration L3 live par Muse Spark 1.3 | `validation/runs/scientist-live-2026-11-04.bundle.json` : famille connue, données synthétiques, score indépendant absent. |
| Appel live Muse Spark 1.3 le 4 novembre | `validation/runs/provider-smoke-2026-11-04.json` : réponse finale et usage d’un test de connexion. Ne prouve ni Wonder, ni Spark Open, ni une calibration scientifique. |
| Illustration Muse Image 1.0 | `validation/runs/muse-image-2026-11-04.json` et PNG associé : image générée, aucune preuve physique. |
| Revue Muse Code CLI terminée | `validation/runs/muse-code-review-2026-11-04.json` : modèle contributor, réponse finale et usage. Une revue par modèle ne constitue pas une certification. |
| Premier parcours vidéo archivé : 6/7 verdicts corrects, erreur moyenne session 2,324 cm | `validation/runs/79588c74-3899-45d3-8f7b-903060272b46/report.json`; simulation uniquement, un échec conservé. Ces chiffres ne sont pas attribués à une nouvelle prise. |
| Capture finale et GIF | `validation/submission.json` consigne fichiers, durée, hashes et méthode de revue effective; une revue par images clés n’est jamais appelée visionnage intégral. |
| Rejeu historique avant correction : 46,7 cm de moyenne affichée, 87,4 cm au dernier point | `validation/runs/browser-review-2026-11-04.json`; archive conservée. La correction et ses erreurs restantes sont décrites séparément ci-dessus. |

Les archives historiques ne sont ni effacées ni réécrites. L’[addendum](STATUS_ADDENDUM_2026-11-04.md) corrige leur portée et déclare la conséquence L3 à la date réelle de cette correction.

## Validation exigée et non encore acquise

Le [rapport gauntlet](../validation/gauntlet-report.json) doit contenir cinq scènes ordonnées et sept tests par scène : lancer, rebond, passage, filet, fantôme, calibration/induction, contrôle. Une scène n’est validée que si les tests applicables ont été exécutés avec méthode, horodatage, mesures et preuves; une simulation ne valide pas un contrôle physique.

Le premier parcours UI des cinq scènes du 4 novembre est [archivé](../validation/runs/14dede2b-5183-4756-8a26-9fb5e71e81c9/report.json) pour les cinq scènes, avec hash des sources et événements. Lancer et fantôme sont mesurés dans chacune; passage et filet sont mesurés pour le panier. Le rebond n’a pas été éprouvé séparément dans ce parcours, le contrôle y est non exécuté, et la calibration indépendante reste bloquée. Toutes les scènes gardent `validated=false`. Cette archive est distincte du parcours vidéo précédent, conservé sans réécriture.

Les [ablations prescrites](../validation/ablations.json) exigent SAM contre un tracker naïf, puis physique induite contre moteur pré-fitté, sur les mêmes tirs indépendants. Comparer deux formulations de prompt SAM ou montrer une convergence de fit ne constitue pas cette ablation.

Les comparaisons numériques L3 et SAM/naïf sont enregistrées comme compléments `measured_synthetic`. Elles ne remplacent pas l’ablation originale « physique induite vs pré-fittée » ni une validation sur vidéo réelle. L’ancienne comparaison de réparation du suivi 15/25 → 20/25 reste séparée de la nouvelle comparaison SAM/naïf sur 24 frames.

FP-01 (perte d’ID) et FP-02 (flou) ont des mécanismes logiciels et des tests; leurs performances réelles restent à mesurer. FP-06 couvre la limite de la calibration et la généralisation non démontrée. Le PDF ne définit pas précisément FP-03, FP-04 et FP-05 dans les neuf prompts : leurs coupures sont décrites en mots (escalade et contrôle non validés), sans inventer une taxonomie officielle.

## Modèles, coûts et droits

SAM 3.1 sert à la perception. Muse Spark 1.3 a exécuté la calibration L3 journalisée; Wonder n’a pas d’exécution attestée. Muse Image a produit l’illustration conservée, explicitement distincte des preuves expérimentales. Muse Glimmer dispose d’adaptateurs local/Together testés par contrat; aucune exécution réelle n’est attestée faute d’endpoint ou clé disponible. Le remplacement local déterministe est nommé « Analyse locale », jamais Muse. Une revue Muse Code CLI est terminée et son modèle exact est consigné.

**Built with Muse Spark Open** pour les exécutions utilisant `meta-models/muse-spark-open-1026`; ne pas revendiquer un fournisseur à partir de sa seule configuration. Les journaux d’usage et plafonds par scène sont les références du coût; aucun montant deviné. Les clés API ne font pas partie du paquet.

La scène et la vidéo de test générées ne comportent pas de personne réelle. Three.js est embarqué avec sa licence MIT et ses hashes, sans téléchargement au lancement. Les licences des modèles et les règles du hackathon nécessitent leur revue de soumission distincte; aucune licence du code propriétaire du projet n’est choisie à la place de son auteur.

## Avant l’envoi

Lancer `python3 validation/preflight.py`. Son résultat doit rester incomplet tant que les preuves requises manquent. La vidéo de simulation et le GIF sont produits et leur méthode de revue figure dans `validation/submission.json`; cela ne fournit pas les séquences réelles absentes. Vérifier les liens publics sur la révision finale, les règles officielles, le track et le thème dans le formulaire. La preuve de dépôt doit venir du portail après un envoi autorisé; aucune confirmation n’est fabriquée localement.
