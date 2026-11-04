# Addendum de statut — 4 novembre 2026

**L1 réel non démontré. Périmètre actuel déclaré : L3, sélection et calibration de moteurs physiques connus, avec démonstration en simulation. Contrôle physique coupé.**

Cette correction est datée du 4 novembre. Elle ne prétend pas que le repli a été verrouillé le 29 octobre, que la porte contrôle a été appliquée le 1er novembre, ni qu’une soumission complète existait le 3 novembre. Elle ne rouvre pas une campagne d’induction libre : le travail actuel rend le logiciel, la calibration et les preuves vérifiables dans le périmètre L3.

## Archives conservées

Le rapport `docs/GATE_2026-10-29.md` et les données `docs/gate_series_2026-10-29.json` sont conservés sans modification par cette correction. Leur ancien verdict GO reste un fait documentaire historique, pas une certification actuelle.

| Archive | SHA-256 relevé le 4 novembre |
|---|---|
| `docs/GATE_2026-10-29.md` | `d79cb44051bde38a88759744c8e10118882e98647d40c0c939b373c2daa8dc25` |
| `docs/gate_series_2026-10-29.json` | `cbc4e4027193e66314c2ca50a5a5770a546063b2123afbe2e6f5771b39aadefe` |

## Ce que l’ancienne preuve établit

La série contient trois exécutions de calibration puis dix exécutions appelées « fresh », dans une simulation navigateur, MPC coupé. Les résultats inscrits sont 11/13 corrects au total et 8/10 sur le sous-ensemble « fresh ». Cinq de ces dix tirs reproduisent les réglages des tirs d’entraînement dans un simulateur déterministe : ils ne représentent pas cinq trajectoires inédites.

Le JSON rassemble des relevés ponctuels du DOM. Il n’enregistre pas la trajectoire continue du fantôme, la comparaison temporelle complète, la perception réelle ou les tests séparés de toutes les scènes. Pour le tir « fresh » n° 8, le dernier relevé contient encore `VERDICT LOCKED`, avec 11 tirs lancés et seulement 10 résultats comptés. Ce relevé ne prouve pas, à lui seul, un résultat final.

**Correction du chiffre 8,4 cm :** dans la version auditée, les accumulateurs d’erreur étaient réinitialisés à chaque lancer. La valeur est donc la moyenne affichée au dernier tir, pas une moyenne démontrée de la session. L’erreur de session ne doit pas être reconstruite en faisant une moyenne non pondérée de valeurs de tirs dont les effectifs sont inconnus.

## Pourquoi ce n’est pas L1 tel que demandé

- L’entrée SAM enregistrée est une vidéo synthétique issue de la scène, pas un tir physique filmé.
- L’ancienne reconstruction est un plan monoculaire `z=0`, pas une profondeur 3D observée.
- La calibration compare des familles physiques déjà codées; elle ne prouve pas l’agent scientifique autonome générant puis révisant son simulateur.
- Le test tenu à l’écart historique est une portion du même tir; ce n’est pas une évaluation sur des tirs indépendants non utilisés pour le choix du modèle.
- Des coefficients de restitution/friction étaient partagés ou laissés en priors; la stricte séparation des vrais paramètres n’était donc pas établie.
- Ni rig physique, ni rapport complet du gauntlet, ni ablations quantitatives prescrites ne sont démontrés par ces archives.

Déclarer ces limites corrige l’interprétation; cela ne satisfait pas rétroactivement les portes du PDF.

## Conséquence appliquée maintenant

Le README, le write-up et le script vidéo affichent L3 et les sources synthétiques. Le logiciel doit distinguer données observées, calibration, priors non identifiés, scène simulée et preuves réelles. La sélection d’une famille connue par Muse Spark/Wonder reste une sélection L3. Une illustration Muse Image ne devient jamais une observation physique. Un endpoint Glimmer configuré ne prouve pas une exécution.

La matrice `validation/requirements.json` couvre les neuf prompts. Le préflight vérifie les contrats et la provenance, et conserve les blocages. Aucun test non exécuté n’est remplacé par une case cochée, aucune valeur absente par zéro, aucun media absent par une promesse de résultat.

La suite matérielle nécessite des vidéos réelles et leur calibration. Le contrôle physique n’est pas remis au programme après la porte historique; les essais MPC actuels sont explicitement en simulation. La soumission finale, les règles du portail et les liens publiés demandent une vérification réelle avant tout envoi.
## Complément logiciel du même jour — périmètre sans matériel

Les améliorations ultérieures du 4 novembre sont décrites dans [le profil simulation-only](SIMULATION_SCOPE.md). Elles ne réouvrent pas la porte historique et ne changent pas le verdict L1 réel non démontré. Le profil strict du PDF demeure indépendant et incomplet.

Le rejeu a été corrigé pour estimer l’état à partir des seules observations passées, conserver les erreurs hors domaine supporté et utiliser une grille temporelle reproductible. Sur sept instants identiques, l’erreur globale de l’ancien enregistrement passe de 48,947 à 39,165 cm; les 3,788 cm sur deux prévisions supportées ne remplacent pas ce score. La reproduction de l’ancien affichage à 60 fps donne 46,790 cm. Les frames historiques et leur calibration restent inchangées.

Un nouveau jeu 3D synthétique bruité, avec plant RK4 et autre intégrateur d’ajustement, est évalué sur des tirs indépendants : 1,016 cm à +0,5 s, maximum 2,299 cm, trente prévisions évaluables sous 5 cm. Ce capteur numérique ne doit pas être confondu avec SAM : la vidéo synthétique SAM conserve 12,60 cm d’erreur 3D moyenne sur vingt-trois détections. Les cinq familles, leurs perturbations et un détour MPC actif disposent aussi d’expériences synthétiques; aucune mesure physique n’en est déduite.

