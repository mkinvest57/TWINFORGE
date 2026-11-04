# [Archive — état antérieur au laboratoire causal] État de livraison — 4 novembre 2026

> État historique conservé. Pour la livraison courante, consulter le [README](../README.md) et le [dossier concours](SUBMISSION.md). Les chiffres et commandes ci-dessous décrivent la révision antérieure.

**Le périmètre demandé est désormais le logiciel local sans caméra ni dispositif physique.** Il possède un profil `simulation-only` séparé. Le profil PDF strict reste incomplet : L1 réel, contrôle matériel et échéances historiques ne sont pas démontrés.

La référence actuelle est [l’addendum daté](STATUS_ADDENDUM_2026-11-04.md), avec les [71 exigences](PROMPT_COMPLIANCE.md) et le préflight `validation/preflight.py`.

Résultat final local : **118 tests passent (84 Python, 34 JavaScript)** sur des sources stables. Le préflight `simulation-only` passe avec zéro écart. Le préflight `strict-pdf` garde 97 écarts de contrat, dont des exigences externes, physiques et historiques répétées à plusieurs endroits du référentiel; ce nombre ne représente pas 97 bugs logiciels.

Travail logiciel vérifié : calibration L3 avec tirs distincts, rejeu causal, comparaison de tracking, cinq familles physiques, contrefactuels, MPC, budget et adaptateurs fournisseurs, analyse locale des preuves et reprise de jobs. La simulation utilise Three.js embarqué avec sa licence : elle fonctionne sans CDN.

Pour la preuve réelle, il faut une acquisition physique avec calibration et des tirs indépendants pour entraîner, choisir puis tester le modèle. Ne pas remplacer cette étape par une nouvelle vidéo du simulateur. Le contrôle matériel est coupé du périmètre courant.

Le benchmark numérique 3D bruité mesure **1,016 cm** à +0,5 s, maximum **2,299 cm**, avec 30/30 prévisions évaluables sous 5 cm. RK4 génère le plant; un autre intégrateur ajuste le modèle sur d’autres tirs. Le benchmark des cinq familles passe les seuils préétablis, y compris trois tirs MPC et un détour autour d’un obstacle interceptant la trajectoire sans contrôle. Le calcul maximal de cette exécution est **88,34 ms**, pour des commandes espacées exactement de 120 ms.

Les rapports de sources courantes sont `validation/gauntlet-report.json` pour le parcours navigateur, `validation/runs/software-checks-2026-11-04.json` pour la suite complète et `validation/submission.json` pour la vidéo/GIF et leur revue. Une preuve ancienne ou dont les sources ont changé fait échouer le profil logiciel. Les résultats matériels bloqués restent bloqués dans le gauntlet strict.

Le défaut historique n’est pas masqué : le rejeu affichait 46,7 cm avant correction. Sur les mêmes sept instants de la grille fixe, le diagnostic corrigé mesure encore **39,165 cm**, contre 48,947 cm auparavant. Les timestamps de simulation et la calibration métrique du vieux montage sont irrécupérables; ses frames restent inchangées. Les **3,788 cm sur deux prévisions supportées** ne remplacent pas la moyenne globale. Le nouvel exemple 3D indépendant ne prétend pas réparer ces anciennes images.

Pour la livraison conforme au PDF, restent les preuves réelles, les expériences originales non exécutées, la revue des règles et licences, la publication de la révision finale, puis le contrôle du formulaire et la confirmation du portail. Le paquet local conserve les lacunes explicitement visibles; il ne constitue pas une soumission.

```bash
.venv/bin/python validation/run_checks.py --out validation/runs/software-checks-2026-11-04.json
python3 validation/pin_simulation_evidence.py
python3 validation/preflight.py --profile simulation-only --json output/validation/preflight-simulation.json --provenance output/validation/provenance.json --package output/twinforge-simulation-review.zip
python3 validation/preflight.py --profile strict-pdf --json output/validation/preflight-pdf.json
```

Le code de sortie 1 est attendu tant qu’une preuve du profil choisi manque. Le [périmètre logiciel](SIMULATION_SCOPE.md) déclare explicitement ses exclusions; il ne supprime ni ne valide les exigences physiques du PDF. Épingler les hashes ne coche aucun résultat. Aucun envoi externe n’est effectué.
