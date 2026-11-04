Prévoir le niveau d’une cuve. Tester une commande. Mesurer ce qui change.

# TWINFORGE — Process Lab

Un banc d’essais virtuel pour comprendre et réguler un procédé simple. Deux cuves simulées partent du même état : la référence garde sa vanne ouverte, l’autre peut être pilotée par un contrôleur prédictif. Une perturbation identique permet de comparer niveaux, commandes et volumes débordés.

**Modèles physiques connus, capteurs synthétiques, commandes simulées.** Le projet ne revendique ni découverte autonome de lois ni validation d’une installation réelle. Il utilise un bilan de volume de réservoir, pas une CFD.

[Essayer le Process Lab](https://mkinvest57.github.io/TWINFORGE/) · [Expérience Meta et reçus](assets/process-meta-session.json) · [Dossier concours](docs/SUBMISSION.md) · [Atelier 3D conservé](workbench.html) · [Caméra mobile](https://mkinvest57.github.io/TWINFORGE/scan.html)

## Le parcours guidé

La calibration locale dure quatre secondes. Elle estime les paramètres à partir du niveau observé, de la vanne appliquée et de la section connue; les coefficients du simulateur ne sont pas transmis au fit. Le fantôme prédit **cinq secondes à l’avance sous hypothèse de vanne inchangée**. Les interventions ultérieures sont signalées.

Le MPC compare des séquences sur trois secondes, applique leur première commande et recalcule toutes les **200 ms de temps simulé — 5 Hz**. Cela ne constitue pas une garantie de temps réel sur matériel.

Le [scénario déterministe mesuré](validation/runs/process-guided-2026-11-04.json) démarre à `t=0`, termine la calibration à `t=4 s`, active le contrôle à `t=11 s`, augmente le débit disponible de **35 % dans les deux branches à `t=18 s`**, puis s’arrête à `t=40 s` : **0 litre débordé côté contrôlé contre 90,803 litres pour la référence**, niveau final contrôlé de **1,049 m**. Ce relevé provient du moteur local, pas d’un essai physique.

Les erreurs restent visibles : **9,148 cm moyens sur les 63 prévisions évaluées**, 73 émises et 10 encore en attente. Parmi les scores, 52 traversent une intervention qui change l’hypothèse de vanne constante. Les 11 sans intervention donnent 1,595 cm; ce sous-ensemble ne remplace pas la moyenne globale.

## Ce que Meta a réellement fait

L’expérience Meta est **distincte de la calibration locale de la démo**. Le 4 novembre, Muse Spark 1.3 a réellement exécuté trois appels : débit constant, drainage linéaire, puis drainage en racine carrée. Après chaque proposition, le logiciel ajuste sur trois épisodes d’entraînement et mesure deux épisodes de validation. Spark reçoit ces résidus, jamais les vrais coefficients ni les observations de test.

| Mesure | Résultat |
|---|---:|
| Validation : constant → linéaire → racine carrée | 1,963 → 0,926 → 0,0945 cm moyens |
| Test après gel du modèle | **0,1011 cm moyens; 0,2308 cm maximum** |
| Test indépendant | 21 prévisions à **3 s**, sur 3 épisodes; bruit capteur de 1 mm |
| Session attestée | 3 appels, 19,65 s, **0,0130775 USD** |

Le seuil moyen de 1 cm était fixé avant les essais. Les futures commandes de vanne sont un plan déclaré avant chaque épisode; les futurs niveaux ne servent pas à prédire. **La référence déterministe atteint exactement le même modèle et la même précision.** Meta ordonne et commente les hypothèses; aucun gain de précision sur le solveur seul n’est revendiqué. Les 0,1011 cm à trois secondes ne sont pas l’erreur du parcours interactif à cinq secondes avec interventions.

[Session et reçus](assets/process-meta-session.json) · [Revue d’attribution](assets/process-meta-review.json) · [Référence déterministe](validation/runs/process-baseline-final-2026-11-04.json)

Muse Code a effectué une [revue en lecture seule](validation/runs/muse-code-review-2026-11-04.json), avec `muse-spark-1.3-contributor`; ce n’est pas une preuve de construction du projet par ce modèle. SAM 3.1 et Muse Image ont des preuves séparées dans l’atelier historique : segmentation de vidéo synthétique et illustration. Ils ne sont pas le capteur de Process Lab. Aucune exécution Wonder ou Glimmer n’est attestée.

## Lancer

Python 3.9+ et Node.js. La simulation et la relecture des réponses enregistrées fonctionnent sans clé. Les nouveaux appels Meta nécessitent le serveur local et sa configuration privée; les clés restent hors des fichiers statiques.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python server.py
```

Ouvrir `http://localhost:8000`. Le serveur reste limité à la machine locale.

```bash
# Référence gratuite, aucun appel de modèle
.venv/bin/python -m twinforge_runtime.process_lab --out output/process-baseline.json

# Nouveau relevé logiciel pour la version courante
.venv/bin/python validation/run_checks.py --out validation/runs/software-checks-process-current.json
```

Le mode `--use-models` autorise au plus trois hypothèses, avec un plafond supplémentaire de **0,12 USD/run** et le plafond persistant de **0,50 USD/scène**. La scène `liquid` conserve ses dépenses; le ledger historique `hoop` reste intact. Un échec payant reste enregistré, sans nouvel essai automatique. Le [parcours HTTP local](validation/runs/process-api-check-2026-11-04.json) est vérifié.

## Publication et archives

Le [Process Lab public](https://mkinvest57.github.io/TWINFORGE/) et le [dépôt](https://github.com/mkinvest57/TWINFORGE) sont à jour. Le déploiement du 4 novembre a réussi; neuf fichiers essentiels ont été relus sans cookie ni authentification et correspondent aux sources locales. La [preuve de publication](validation/runs/process-browser-2026-11-04/public-deployment.json) conserve les hashes et le workflow. Le site public exécute le laboratoire, la caméra locale et la consultation du journal Meta; de nouveaux appels aux modèles nécessitent le serveur Python local. L’aperçu Sites conserve son accès privé au propriétaire.

**192 tests passent** (107 Python, 85 JavaScript). Les [vérifications logicielles](validation/runs/software-checks-process-release-2026-11-04.json) et le [parcours navigateur](validation/runs/process-browser-2026-11-04/browser-review.json) couvrent notamment le scénario guidé, les exports, l’étude gratuite et les vues de 320 à 1440 pixels. Une émulation de téléphone ne constitue pas un test sur un appareil physique.

L’atelier initial reste dans `workbench.html`; [ses mesures et limites](docs/archive/README_PRE_PROCESS_2026-11-04.md) restent archivées. La [caméra mobile](docs/MOBILE.md) suit et prévoit dans le plan de l’image, localement, sans Meta ni envoi d’images; aucun test de caméra physique n’est revendiqué. Le [profil PDF historique](docs/PROMPT_COMPLIANCE.md) reste incomplet pour ses exigences physiques et historiques; les anciens hashes et paquets ne sont pas réécrits.

[Voix française de trois minutes](docs/VOICEOVER_3MIN_FR.txt) · [English voiceover](docs/VOICEOVER_3MIN_EN.txt) · [Storyboard](docs/VIDEO_3MIN_STORYBOARD.json) · [Sous-titres FR à recaler sur la voix](docs/PROCESS_DEMO_SUBTITLES_FR.srt) · [Licences tierces](docs/THIRD_PARTY.md)
