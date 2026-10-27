# TWINFORGE — Rapport perception SAM 3.1

Vidéo : `test_shot.mp4` · Modèle : `sam-3.1` via Meta Model API `/v1/responses` · Concepts : ball / vertical hoop / backboard
Frames échantillonnées : 48 (~6.0 fps) · Balle trouvée : 41 (85%)

## Continuité des ID (FP-01)
- Pertes de suivi (frames sans la balle alors qu'elle était suivie) : 23
- Ré-acquisitions par trajectoire prédite : 8
- IDs distincts attribués à la balle : [1, 3, 4, 5, 6] (toute la vidéo, rebonds/roulement inclus)
- IDs sur le segment de vol (lancer -> traversée de l'anneau) : [1] — critère Prompt 2 : ID stable à travers l'arceau

## Frames dégradées (FP-02, flou de mouvement)
- Outliers aire/excentricité exclus du fit ultérieur : 2% des frames balle

## Événements détectés
- launch @ t=0.0s — premier mouvement rapide détecté
- apex @ t=0.5s — sommet du tir (vy pixel s'inverse)
- rim_cross_down @ t=1.0s — traversée descendante du plan de l'anneau dans son emprise

## Limites honnêtes
- Coordonnées monde monoculaires (plan de la scène, z=0) : échelle par le diamètre réel de l'anneau (0,4572 m).
  Avec 4 fiduciaires imprimés + homographie, la précision planimétrique s'améliore ; la profondeur reste indéterminée en mono.
- Centroïdes issus des boîtes SAM (les masques encodés sont conservés bruts dans la réponse ; décodage raster via @meta-sam/parser si Node est présent).
- Aucun paramètre physique (gravité, vent, restitution) n'est estimé ici : cette phase mesure des positions, point.

## Critère de sortie (Prompt 2)
GO : trajectoire balle propre, rejouable frame par frame (frames annotées + trajectories.json).
