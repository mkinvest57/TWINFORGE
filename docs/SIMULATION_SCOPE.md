# Périmètre logiciel sans acquisition réelle — 4 novembre 2026

Le profil `simulation-only` répond au périmètre demandé : terminer ce qui est faisable sans caméra ni dispositif physique. Il est distinct de `strict-pdf`, qui reste le profil par défaut. Aucun résultat synthétique ne complète rétroactivement une exigence de mesure réelle, d’induction libre ou une échéance historique.

Au contrôle final du 4 novembre, les **118 tests logiciels** passent avec sources stables; `simulation-only` retourne 0 sans écart. Le dernier parcours navigateur couvre les cinq scènes. `strict-pdf` retourne 1 et conserve ses 97 écarts de contrat; aucune de ses exigences n’a été supprimée pour obtenir le résultat logiciel.

| Exigence du profil logiciel | Preuve et contrôle |
|---|---|
| Cinq familles calibrées sur des préfixes, testées sur d’autres épisodes | `validation/simulation_benchmark.mjs`; paramètres du plant masqués dans une fixture séparée; modèle gelé avant lecture des tests; 3 entraînements, 2 validations, 3 tests par scène |
| Prédiction, contrefactuel et comparaison avec prior dans chaque famille | Erreurs numériques, intervention de +20 %, même test pour les deux variantes; seuils fixés dans `validation/simulation-thresholds.json` avant la première mesure |
| Contacts attendus et obstacles interdits distingués | Probes sol, planche, arceau, filet et obstacle; contact interdit volontaire uniquement pour le contrôle positif du détecteur |
| MPC réellement exécuté | Trois tirs et un détour actif : sans contrôle l’obstacle est touché; avec contrôle la cible doit être atteinte sans obstacle, au plus trois impulsions, cadence exacte 120 ms, calcul inférieur à 120 ms |
| Généralisation avec bruit et intégrateur indépendant | `induction/benchmarks/independent-3d-2026-11-04/benchmark.json` : plant RK4, ajustement Euler, bruit 2 mm, séparation des tirs et hashes |
| Rejeu causal sans effacement de l’échec historique | Tests contre fuite d’observations futures; comparaison des mêmes frames et mêmes instants; erreurs globales, couverture et limites conservées |
| SAM contre suivi naïf sur le même échantillon | `validation/runs/synthetic-perception-comparison-cone-v2.json` : 24 frames, sorties gelées avant lecture de la vérité, mesures par frame, résultats communs et pertes visibles |
| Interface réellement parcourue | Cinq scènes, lancement et fantôme mesurés, journal brut hashé; source UI identique à celle du rapport courant |
| Budgets, fournisseurs et reprise | Tests nommés sur réservations persistantes, plafond avant appel, usage facturé, adaptateur Glimmer et absence de fournisseur; analyse locale explicitement non-Muse |
| Fonctionnement de la simulation sans CDN | Three.js embarqué, hashes des cinq fichiers et licence MIT |
| Tests sur les sources finales | Suite Python/JavaScript complète, commandes et sorties conservées, hashes avant/après identiques |
| Vidéo et GIF de l’application exécutée | Environ 150 secondes, sous-titres, simulation visible, compteurs issus des événements; méthode et étendue de revue déclarées |

Les familles sont imposées par le logiciel : mécanique de balle avec traînée, sphères de masses égales, double pendule, bilan d’un réservoir uniforme et force centrale. Le benchmark à cinq familles utilise des observations exactes et le même intégrateur que le modèle; il vérifie une calibration L3 et ses interventions. Le benchmark 3D bruité avec intégrateur indépendant apporte une preuve distincte plus exigeante. Aucun des deux n’établit une induction physique libre.

La perception vidéo ne reprend pas le chiffre du capteur numérique : SAM conserve **12,60 cm** d’erreur 3D moyenne sur les 23 détections communes, contre **6,50 cm** pour le suivi naïf. La validation analytique de la géométrie, sur silhouettes idéales, mesure 0,521 cm de moyenne et 2,166 cm au maximum; elle isole le calcul géométrique de la qualité des masques. Une correction de repère de 0,5 px n’est pas présentée comme une amélioration du réseau.

Le liquide ne résout pas les vagues ou Navier–Stokes. Les matériaux du filet, la masse de la balle et certaines géométries restent des entrées/prior déclarés. Le Monte-Carlo est conditionnel aux perturbations spécifiées; il ne certifie pas l’incertitude d’une caméra non mesurée.

Les premières exécutions du benchmark restent archivées : l’index global d’une fixture plaçait initialement le tir de contrôle à 4,2 m; après correction de cette erreur, le calcul MPC dépassait 120 ms. Le moteur écarte maintenant immédiatement les candidats déjà en collision interdite, sans modifier les forces ni le coût des candidats encore faisables. Les seuils initiaux n’ont pas été assouplis. Un défi d’obstacle interceptant le tir a ensuite été ajouté avec son propre critère avant sa première exécution. Le dernier rapport utilise la cadence exacte de 120 ms pour le plan et l’exécution.

Le défaut historique n’est pas maquillé : sur la grille fixe de comparaison, les sept prévisions globales passent de 48,947 à 39,165 cm; le sous-ensemble supporté de deux prévisions mesure 3,788 cm. Le [diagnostic JavaScript archivé](../validation/runs/replay-comparison-2026-11-04.json) reproduit aussi les 46,790 cm historiques à 60 fps et expose la sensibilité de l’ancien calcul à la cadence du rendu. Le benchmark nouveau mesure 1,016 cm sur trente prévisions évaluables à +0,5 s, avec 45 prévisions émises sur 48 instants planifiés. Ce sont des populations différentes, toujours nommées séparément.

La déclaration `ready_for_review` exige tous les contrôles du profil choisi. Elle ne signifie ni validation scientifique, ni conformité intégrale au PDF, ni soumission. Les fichiers manquants, échecs ou preuves périmées ne deviennent pas « non applicables ».
