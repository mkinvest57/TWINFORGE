# Composants tiers et provenance

Inventaire local vérifié le 4 novembre 2026, conservé avec les [hashes des licences](../validation/runs/dependency-licenses-2026-11-04.json). Ce document décrit les fichiers effectivement lus; il n’atteste aucune acceptation de conditions de service ou des règles du hackathon.

| Composant | Version et licence du fichier local | Utilisation |
|---|---|---|
| Three.js | 0.186.1, MIT; [texte conservé](../assets/vendor/three/LICENSE.txt) | Cinq fichiers amont embarqués pour le rendu sans CDN; intégrité npm et SHA-256 dans le manifeste. |
| `@meta-sam/parser` | 0.1.0; **SAM License**, datée du 19 novembre 2025; [copie du texte installé](third-party/SAM-parser-LICENSE.txt) | Parseur des réponses SAM, installé via npm. Le champ de package renvoie à ce fichier; il ne déclare pas MIT. Le dossier `node_modules` n’est pas distribué dans le paquet de revue. |

SAM 3.1 est crédité pour la segmentation des vidéos synthétiques. Les modèles Muse réellement exécutés et leurs usages sont nommés dans le README et les preuves d’appel; les illustrations Muse Image restent étiquetées comme générées. Aucun poids Glimmer n’est embarqué. Les bibliothèques Python sont installées depuis les fichiers de dépendances et ne sont pas recopiées dans le paquet source.

Aucune licence du code propre à TWINFORGE n’a été ajoutée au nom de son auteur. Les droits du projet, les conditions de fournisseurs et l’acceptation du règlement de soumission restent des décisions distinctes des tests logiciels.

Le nouveau Process Lab adapte quatre patterns 21st inspectés : Dashboard Sidebar (14941, arunjdass), Segmented Tabs (26923, micka_design), Progress Metric Card (15024, makviesainte) et Vertical Descriptive Stepper (29866, sean0205). Les aperçus, sources et hashes figurent dans [la provenance du design](../.21st/sources.json). L’implémentation utilise le HTML/CSS natif du projet; aucun composant React ni valeur de démonstration n’est installé. Cette mention documente l’origine des patterns, sans inventer une licence amont.
