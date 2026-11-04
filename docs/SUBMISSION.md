# TWINFORGE — Process Lab

**Dossier préparatoire, non soumis.** Track proposé : Indie, à confirmer selon le profil du participant; thème proposé : Push the Frontier. Contributions nouvelles du 4 novembre 2026 après l’atelier initial du 27 octobre, conservé dans `workbench.html`.

## Pitch et usage

Prévoir le niveau d’une cuve, tester une commande et mesurer ce qui change. TWINFORGE est un banc virtuel pour préparer des essais de régulation : calibration de modèles connus, prévision explicite, contrôle prédictif et preuves exportables.

Deux cuves simulées commencent dans le même état. La référence garde sa vanne ouverte; l’autre peut être régulée. Une hausse identique du débit d’arrivée expose les effets sur le niveau et le débordement. Le cas d’usage est civil : prototypage de procédés et préparation d’essais. Aucun équipement physique n’est commandé.

## Démonstration locale mesurée

La page principale ajuste localement une famille de bilan de volume connue. Elle prévoit le niveau à **+5 s sous hypothèse de vanne inchangée**; les interventions ultérieures restent signalées dans les erreurs. Le MPC cherche des séquences sur **3 s**, applique la première commande et recalcule toutes les **200 ms simulées, soit 5 Hz**.

Le [parcours guidé](../validation/runs/process-guided-2026-11-04.json) termine sa calibration à 4 s, active le contrôle à 11 s, applique une hausse d’entrée de 35 % dans les deux branches à 18 s, et s’arrête à 40 s. Résultat déterministe du moteur : **0 L débordé avec contrôle, contre 90,803 L pour la référence; niveau final de 1,049 m**. Le chiffre provient de cette expérience précise, pas du scénario précédent de 35 secondes.

**Toutes les 63 prévisions évaluées donnent 9,148 cm d’erreur moyenne**, sur 73 émises avec 10 en attente. 52 scores traversent une intervention; 11 sans intervention donnent 1,595 cm. Ce sous-ensemble ne remplace pas la moyenne globale. La capture navigateur doit être rattachée à son export effectif : un rapport moteur ne prouve pas à lui seul qu’un montage vidéo a été revu.

Le périmètre est **L3, familles connues, observations synthétiques**. Le moteur est un bilan de volume de réservoir homogène, pas une découverte autonome de lois, une CFD ou une validation d’installation réelle.

## Contribution Meta démontrée

Une expérience séparée a réellement appelé **Muse Spark 1.3 trois fois**, le 4 novembre. La [session publique](../assets/process-meta-session.json) conserve réponses finales, hashes de requête, usages, coûts et durées.

1. Spark propose un débit constant. Le logiciel ajuste sur trois épisodes d’entraînement puis mesure deux épisodes de validation : **1,9627 cm** moyens.
2. Spark interprète la sur-prévision et propose un drainage linéaire : **0,9260 cm** après fit et validation.
3. Spark propose le drainage en racine carrée, dernière famille du protocole d’exploration annoncé : **0,09448 cm**.

Le sélecteur numérique retient l’erreur moyenne de validation minimale, gèle le modèle puis ouvre trois épisodes de test distincts. **21 prévisions à trois secondes : 0,10113 cm moyens, 0,23082 cm maximum**, avec capteur synthétique bruité à 1 mm. Géométrie et futures commandes planifiées sont fournies; ni les futurs niveaux ni les vrais coefficients n’entrent dans le fit ou les messages à Spark.

La session dure **19,65 s** et coûte **0,0130775 USD**, selon les usages et tarifs consignés. Son plafond annoncé était 0,12 USD, sous le plafond persistant de 0,50 USD de la scène `liquid`; le ledger `hoop` est conservé.

**La référence déterministe donne le même modèle et les mêmes scores.** Spark choisit l’ordre des familles et commente les résidus; le logiciel ajuste, mesure, sélectionne et pilote. Aucun gain de précision sur le solveur seul n’est revendiqué. Une remarque de Spark sur le maximum d’erreur est conservée avec [sa clarification](../assets/process-meta-review.json) : le critère global était la moyenne. Aucun nouvel appel n’a été lancé pour améliorer la réponse enregistrée.

La calibration locale, la boucle Meta et leurs horizons de cinq et trois secondes sont identifiés séparément. La relecture des réponses enregistrées n’est jamais annoncée comme un nouvel appel direct.

## Attributions complémentaires

- SAM 3.1 : segmentation réellement exécutée sur une vidéo synthétique de l’atelier historique; pas le capteur de niveau de Process Lab.
- Muse Code CLI : revue en lecture seule avec `muse-spark-1.3-contributor`, sans preuve que ce modèle a construit le projet.
- Muse Image 1.0 : illustration générée conservée, sans valeur de preuve physique.
- Wonder et Glimmer : aucune exécution attestée; configuration et adaptateurs ne prouvent pas une utilisation.
- Mobile : suivi et prévision 2D locaux, sans Meta ni transmission d’images; tests navigateur, pas caméra physique.

Les [résultats historiques](archive/SUBMISSION_PRE_PROCESS_2026-11-04.md) restent distincts : benchmark 3D à 1,016 cm, reconstruction SAM à 12,60 cm et rejeu ancien à 39,165 cm. Aucun ne devient une mesure de la nouvelle cuve.

## Dates et accès du jury

Les trois commits initiaux datent du **27 octobre 2026**. Le 4 novembre ajoute les corrections et preuves, la caméra locale, puis le procédé civil : moteur, calibration/contrôle, boucle Spark instrumentée et interface. Les réponses et expériences portent leur date réelle. Les archives des 27–29 octobre et les échéances passées ne sont pas réécrites.

Le [dépôt](https://github.com/mkinvest57/TWINFORGE) est public. Lors de la dernière vérification avant publication de Process Lab, `main` pointait encore sur `2d0530903fe8410c12ed3fef3bd771331194267c` du 27 octobre; [GitHub Pages](https://mkinvest57.github.io/TWINFORGE/) servait exactement cet ancien HTML. La nouvelle révision doit être publiée puis vérifiée sans connexion. L’aperçu Sites était privé au propriétaire; le succès de déploiement seul ne garantit pas l’accès du jury.

La vidéo de **trois minutes** doit montrer les contributions de la période autorisée avec un lien accessible. Le [storyboard](VIDEO_3MIN_STORYBOARD.json) et les voix [FR](VOICEOVER_3MIN_FR.txt) / [EN](VOICEOVER_3MIN_EN.txt) décrivent le montage préparé; ils ne prouvent pas encore son rendu. La capture historique de 149,83 secondes et son script restent archivés.

Avant l’envoi : vérifier les liens sans connexion, revoir la vidéo effectivement produite, rattacher ses chiffres à l’export, confirmer licences/règles/track/thème puis conserver le reçu du portail. Échéance communiquée par le guide officiel vérifié : **4 novembre 21 h EST, soit 5 novembre 03 h à Paris**. Ce dossier n’est pas une confirmation de soumission.

Le profil PDF historique reste strict et incomplet : une nouvelle expérience logicielle ne remplace pas une acquisition physique ni une conformité rétroactive à tous ses prompts.
