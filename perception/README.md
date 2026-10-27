# Perception SAM 3.1 — vidéo → masques → trajectoires (Prompt 2)

Pipeline réel, exécutable sur une nouvelle vidéo sans modification. Aucun vrai
paramètre de scène n'est utilisé : cette phase mesure des positions, point.

## Lancer

```bash
pip install -r perception/requirements.txt
# clé Meta dans .env racine (META_MODEL_API_KEY=...) ou l'environnement — jamais commitée
python3 perception/sam_perception.py --video perception/test_shot.mp4 --out perception/output
python3 -m unittest tests.test_perception -v   # tests purs (parse/tracking/FP-01/FP-02/events)
```

Vidéo de test droits-propres (scène 3D seule, aucun UI, aucune footage tierce) :

```bash
PYTHONPATH=/tmp/w3d-pw:/tmp/samdeps python3 perception/make_test_video.py
```

## Comment ça marche

1. **Échantillonnage** : frames à ~6 fps (cible Prompt 2 : 5–10 fps sur les segments utiles).
2. **SAM 3.1** (Meta Model API, `POST /v1/responses`, modèle `sam-3.1`) par concept texte,
   avec formulations de repli mesurées : `ball`/`basketball`, `basketball hoop`/`hoop`
   (`vertical hoop` seul ne renvoie rien sur notre scène — constat journalisé), `backboard`.
   Concepts statiques échantillonnés 1 frame sur 6, balle à chaque frame.
3. **Extraction déterministe (zéro LLM)** : centroïdes de boîtes (échelle recadrée sur la
   frame d'origine), vitesses par différences finies fenêtrées, polygones = boîtes.
   Masques encodés décodables en raster via `decode_masks.mjs` (@meta-sam/parser, optionnel).
4. **Suivi FP-01** : association par trajectoire prédite (gate 175 px pleine résolution),
   ré-acquisition après occlusion ; compteur FP-01 sur la piste principale uniquement.
5. **FP-02** : frames à aire/excentricité anormales flaguées `fp02_outlier` (exclues du fit).
6. **Monde monoculaire** : échelle par le diamètre réel de l'anneau (0,4572 m), plan z=0.
   Limite assumée : pas de profondeur en mono ; fiduciaires + homographie = amélioration prévue.
7. **Événements** : launch, apex, rim_cross_down, zone d'occlusion anneau.

## Résultat sur la vidéo de test (générée le 2026-10-27)

- 48 frames échantillonnées, balle trouvée sur **85 %**, FP-02 outliers **2 %**.
- **ID 1 stable sur tout le segment de vol**, de lancer à la traversée de l'anneau
  (critère de sortie Prompt 2 : GO sur ce tir).
- Événements détectés : launch, apex @0,5 s, rim_cross_down @1,0 s.
- Après l'anneau (filet, rebonds, roulement, fantômes Monte-Carlo dans le champ),
  l'ID se fragmente ([1,3,4,5,6] sur la vidéo entière) : rapporté tel quel, jamais moyenné.
- Dataset : [output/trajectories.json](output/trajectories.json) · Rapport : [output/report.md](output/report.md)
