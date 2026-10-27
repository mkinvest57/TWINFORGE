# Lance une balle vers un cerceau vertical. Obtiens son simulateur. Prédis si ça rentre — avant que la balle retombe.

**TWINFORGE EXTREME** — Meta Global AI Developer Hackathon 2026 · Track **Indie** · Thème **Push the Frontier**

## Le projet

TWINFORGE est le jumeau numérique d'un système physique réel : à partir de l'observation
d'une scène (départ : un tir de balle vers un cerceau vertical), le système observe la scène,
induit lui-même sa physique (gravité, traînée, restitution…) à partir des seules observations,
prédit la suite en fantôme projeté **+0,5 s DEVANT** l'objet, puis contrôle le réel par MPC
sim-to-real, avec replanification à chaque pas (120 ms, 3 corrections max par vol).

Architecture imposée, 4 étages dans l'ordre :

1. **Observer** — perception SAM 3.1 par concepts (« ball », « vertical hoop », « backboard »),
   extraction d'état déterministe, gestion FP-01 (occlusion) et FP-02 (flou de mouvement).
2. **Induire** — agent scientifique : hypothèse → simulateur paramétrique + fit → résidus → révision.
   Gravité/vent estimés des seules vitesses observées (contacts rejetés), restitution mesurée au rebond.
3. **Prévoir** — fantôme +0,5 s calculé avec EXACTEMENT le même intégrateur que le réel,
   Monte-Carlo (18 fantômes), verdict « dedans / dehors » verrouillé avant la retombée.
4. **Contrôler** — MPC : `J = Σ ||pᵢ − g||² + c_rock`, seul `u*₀` exécuté, replanification à chaque pas.

## Stack Meta

SAM 3.1 (perception) · Muse Spark / Wonder (induction, contrefactuels) · Muse Image
(contrefactuels rendus) · Muse Glimmer (narration d'anomalies) · Muse Code (construction).
Les vrais paramètres de la scène servent uniquement à l'évaluation externe : l'agent ne les
reçoit jamais, il induit les siens — avec leur incertitude et leur erreur tenue à l'écart.

## Perception vidéo réelle (Prompt 2) — branchée

Pipeline [perception/sam_perception.py](perception/sam_perception.py) : vidéo → SAM 3.1
(Meta Model API `/v1/responses`, concepts texte avec replis mesurés) → extraction
déterministe → suivi FP-01/FP-02 → trajectoires monde monoculaires → événements.
Sur la vidéo de test générée depuis la scène 3D : balle trouvée 85 %, **ID 1 stable sur
tout le vol jusqu'à la traversée de l'anneau**, événements launch/apex/rim_cross_down.
Dataset et rapport : [perception/output/](perception/output/) · Détails : [perception/README.md](perception/README.md) · Tests : `python3 -m unittest tests.test_perception -v` (7 tests).

## Statut — honnête

Construit pendant le hackathon (26 oct. – 4 nov. 2026). Démo interactive 3D ci-jointe :
physique intégrée pas à pas (aucune trajectoire prédéfinie), induction réelle calculée sur les
trajectoires observées de la scène simulée, fantôme, Monte-Carlo, MPC et gauntlet 5 scènes.
Perception vidéo SAM 3.1 et appels Muse live : branchables via le champ « Meta Model API »
de l'interface (mode démo simulé sinon — signalé comme tel dans l'UI). Niveau visé : **L1**
(induction + fantôme) en démonstration interactive ; repli L3 documenté à la porte du 29 oct. si NO-GO.

- GIF du fantôme : *(à ajouter dès la première capture)*
- Démo live : ouvrir `index.html` (voir ci-dessous)
- Rapport du gauntlet : panneau « Gauntlet » de la démo (5 scènes : cerceau, multi-corps,
  chaotique, liquide, orbite), checklist test par test.

## Comment lancer

Démo physique (aucune installation, aucune clé) : ouvrez `index.html` dans un navigateur
moderne (connexion requise pour le CDN Three.js).

Mode live avec les APIs (conseiller Muse Spark dans le panneau de droite) :

```bash
cp .env.example .env   # puis remplissez vos clés — .env n'est JAMAIS commité
python3 server.py      # sert la page + proxy API sur http://localhost:8000
```

puis ouvrir http://localhost:8000 et cliquer « Demander une révision d'hypothèse ».

### APIs branchées (clés côté serveur uniquement)

| Rôle | Provider | Modèle / endpoint |
|---|---|---|
| Conseiller d'induction (primaire) | Baseten `https://inference.baseten.co/v1` | **`meta-models/muse-spark-open-1026`** (modèle hackathon imposé, seul modèle de cette clé) |
| Repli + autres modèles Meta | Meta Model API `https://api.meta.ai/v1` | `muse-spark-1.3`, `muse-wonder-1.0` (chat) ; `sam-3.1`, `muse-image-1.0` listés par `/v1/models` |

Le navigateur n'appelle que le proxy local (`/api/status`, `/api/advisor`, `/api/meta/chat`) :
aucune clé dans le code, le HTML ou l'historique git.

Contrôles : glisser pour orbiter, molette pour zoomer, **Lancer** pour tirer,
curseurs angle/puissance/effet/vent, bascules Fantôme / Monte-Carlo / MPC,
scènes du gauntlet, champ contrefactuel en langage naturel
(« lance 20 % plus fort », « vent doublé », « décale le cerceau à gauche »).
