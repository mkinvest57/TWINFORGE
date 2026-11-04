# TWINFORGE — Une décision. Deux futurs.

**Dossier préparatoire, non soumis.** Track proposé : Indie, sous réserve de l’éligibilité du participant. Thème proposé : Push the Frontier. La nouvelle présentation est un laboratoire civil d’intervention sur des chaînes de collisions.

## Pitch

Voir arriver un incident ne suffit pas. Il faut choisir où agir, mesurer ce que ce geste change et savoir quand il est trop tard. Twinforge laisse un modèle proposer une intervention, en calcule les conséquences, conserve les échecs et compare le résultat à une recherche numérique explicite.

Dans la démo, un transporteur met plusieurs charges en mouvement. L’utilisateur dispose d’une seule commande bornée : freiner ou dévier le premier transporteur. Deux branches partagent exactement le même état initial. Les trajectoires sont calculées avant la lecture, puis affichées côte à côte, avec un curseur temporel commun et les données exportables.

La valeur explorée est la préparation de décisions dans un environnement simulé : proposer, tester, comprendre et comparer des interventions avant des essais plus coûteux. Aucune économie réelle, aucun client industriel et aucune validation de sécurité ne sont revendiqués.

## Trois épreuves et leurs résultats

La recherche compare 37 commandes sur 12 secondes simulées. Les conditions nominales sont la graine `20261104`, la vitesse à 100 % et une intervention à 0,25 s.

| Épreuve | Pic sur la charge protégée, sans action | Pic avec le choix local | Essais de vitesse 95/100/105 % réussis |
|---|---:|---:|---:|
| Réaction en chaîne | 116,562 J | 0 J | 3 / 3 |
| Intersection aveugle | 112,755 J | 3,464 J | 1 / 3 |
| Passage critique | 149,926 J | 0 J | 3 / 3 |

Le critère est un **seuil expérimental arbitraire de 8 J**, fixé avant le calcul. Il porte uniquement sur le pic d’énergie cinétique normale relative des contacts de la charge protégée. Il ne certifie pas l’absence d’accident ou de dommage ailleurs dans la scène.

Parmi les candidats sous le seuil, la recherche minimise l’impulsion de commande. Si aucun candidat ne passe, elle retient le plus petit pic et signale l’échec. Les trois variations de vitesse évaluent ensuite le choix nominal : elles ne sont pas utilisées pour optimiser la commande et ne constituent pas une probabilité de sécurité.

La cascade offre un test lisible de l’urgence : une commande réussit à 0,25 s; aucune des 37 actions ne passe le critère à 0,50 s. Les retards testés sont espacés de 0,25 s, entre 0 et 2 s. Le « dernier retard testé viable » est un résultat de grille, pas une frontière mathématique exacte.

[Benchmark complet](../validation/runs/causal-benchmark-2026-11-04.json) · [Revue du moteur](../validation/runs/causal-engine-review-2026-11-04.json)

## Contribution Meta attestée

Une session de **Muse Spark 1.3**, terminée le **4 novembre 2026 à 17:06:58 UTC**, contient trois appels réels. Spark reçoit l’état initial, les masses, les coefficients et les 37 actions disponibles. Il ne reçoit pas les scores de la recherche exhaustive. Après chaque proposition, le solveur retourne les contacts et les métriques calculés; l’appel suivant peut corriger son choix.

1. Déviation de −0,16 rad à 0,25 s : **104,609 J**, échec.
2. Déviation de −0,36 rad à 0,25 s : **8,485 J**, encore au-dessus du seuil.
3. Déviation de −0,32 rad à 0,25 s : **4,564 J**, sous le seuil; effort **62,540 N·s**.

Le sélecteur retient la meilleure des trois propositions effectivement vérifiées. La session dure **37,8556 s** et coûte **0,028276 USD**, selon les usages consignés. Le plafond était de 0,12 USD pour l’étude, sous le plafond persistant de 0,50 USD de la scène `causal`.

**La recherche exhaustive locale trouve un meilleur résultat : 0 J et 39,190 N·s, avec +0,20 rad.** Cette comparaison reste affichée. Le projet démontre ici une boucle de raisonnement révisable et vérifiable, pas un avantage de performance du modèle sur la recherche locale.

[Réponses originales et reçus](../assets/causal-meta-session.json) · [Rapport original](../validation/runs/causal-meta-live-2026-11-04.json)

Le site public relit cette session enregistrée; ce n’est pas un nouvel appel direct. L’application peut vérifier et rejouer la proposition retenue avec le même moteur. Une nouvelle étude nécessite le serveur Python local et la configuration privée du fournisseur. Les sorties du modèle sont des identifiants issus d’une liste bornée, jamais du code exécuté.

## Portée technique

- Positions, vitesses, masses et coefficients **fournis**, sans reconstruction par caméra.
- Corps rigides circulaires dans un plan; vue 3D fidèle aux enveloppes de contact.
- Amortissement linéaire, impulsions de contact sans frottement tangent, pas de 1/240 s.
- Une seule intervention instantanée : freinage de 0 à 90 %, ou rotation de vitesse bornée à ±0,36 rad.
- Branches et prévisions figées avant lecture; données et événements exportables.
- Vérification à un pas deux fois plus fin : admissibilité conservée pour les trois choix nominaux, variation des pics de référence inférieure à 3 %.

Les trajectoires et leur visualisation viennent du **même modèle connu**. Il ne faut pas annoncer une erreur de prévision indépendante ou une découverte autonome de lois. Les actionneurs, les incertitudes de perception et les risques industriels réels restent hors du périmètre validé.

La caméra mobile demeure un outil distinct de suivi et d’extrapolation 2D en pixels, local, sans envoi d’images. Le nouvel entrepôt n’est pas reconstruit depuis ce flux. L’atelier historique du pendule conserve ses diagnostics séparés.

## Présentation de trois minutes

L’ouverture pose une décision concrète, puis montre les deux branches. Le montage révèle ensuite le délai d’action et les trois propositions Meta : premier échec, résultat presque admissible, révision qui passe le critère. La comparaison avec la recherche locale et le test de sensibilité restent visibles.

[Voix FR](VOICEOVER_3MIN_FR.txt) · [Voix EN](VOICEOVER_3MIN_EN.txt) · [Storyboard de 180 s](VIDEO_3MIN_STORYBOARD.json) · [Sous-titres FR à recaler](CAUSAL_DEMO_SUBTITLES_FR.srt)

Ces documents sont des livrables de préparation. Aucune nouvelle voix synthétisée ni vidéo finale n’est attestée par leur seule présence. Le montage doit conserver les libellés « simulation » et « session enregistrée », et montrer les valeurs réellement issues de l’export de sa capture.

## Accès et règles

[Dépôt public](https://github.com/mkinvest57/TWINFORGE) · [Démo publique](https://mkinvest57.github.io/TWINFORGE/) · [Guide officiel](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)

La version statique donne accès aux simulations et au journal enregistré; elle n’expose aucune clé. La validation finale des liens publics et du parcours navigateur doit correspondre au déploiement de cette refonte, et non aux captures de la version précédente.

Le guide consulté donne l’échéance du **4 novembre à 21 h EST, soit le 5 novembre à 03 h à Paris**. Le dossier ne constitue pas une soumission ni un reçu du portail. L’éligibilité du track, les informations d’équipe, la vidéo effectivement rendue et l’envoi final restent à confirmer par le participant.

Les étapes précédentes sont archivées : [atelier initial](archive/SUBMISSION_PRE_PROCESS_2026-11-04.md), [version intermédiaire](archive/SUBMISSION_PROCESS_2026-11-04.md). Leurs mesures ne décrivent pas la nouvelle scène. Le [profil du PDF](PROMPT_COMPLIANCE.md) reste strict sur ses exigences physiques et historiques; les archives du 27–29 octobre ne sont pas réécrites.
