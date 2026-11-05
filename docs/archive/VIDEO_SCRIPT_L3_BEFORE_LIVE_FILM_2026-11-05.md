# Script de la démonstration enregistrée — 2 min 30 — L3

La capture actuelle enregistre le rendu WebGL exécuté, avec sous-titres et compteurs issus de l’interface. Elle est étiquetée **L3 · SIMULATION · MOTEUR CONNU CALIBRÉ**. Le canvas de composition ajoute les textes à la capture du rendu; il ne simule ni ne remplace la scène physique WebGL. Aucun tir filmé réel ni contrôle matériel n’est présenté.

Les timings ci-dessous sont le script prévu par `web/recording.js`. Les événements de tirs et de corrections disposent de leurs horodatages exportés; la disponibilité du journal propre aux sous-titres est précisée pour chaque prise. Le fichier `docs/DEMO_SUBTITLES_FR.srt` reproduit ces textes; la capture les incruste déjà, donc la conversion utilise `--already-captioned`.

Pour la prise actuelle `simulation-8a28874b4218.webm`, l’enregistrement de fin a rencontré une limite de taille HTTP. La vidéo a été sauvegardée, puis les événements de tirs, contrefactuels et corrections ont été récupérés depuis la mémoire du navigateur et archivés. Le journal exact des changements de sous-titres de cette prise n’a pas été conservé : les temps du tableau restent les temps **prévus**, confirmés seulement par les échantillons visuels disponibles. Aucun horaire effectif manquant n’est inventé.

| Temps prévu | Sous-titre incrusté |
|---|---|
| 0:00–0:08 | Voici TWINFORGE. Le jumeau prédit le tir avant sa retombée. Cette démonstration est une simulation L3. |
| 0:08–0:20 | L3 : le système choisit et calibre un moteur physique connu. Il ne prétend pas avoir découvert librement ses équations. |
| 0:20–0:35 | Ce tir 3D bruité appartient au test indépendant. Le modèle a été calibré sur d’autres tirs. La vidéo SAM est évaluée séparément. |
| 0:35–0:43 | Le fantôme projette le même intégrateur à +0,5 seconde. Le verdict se verrouille avant l’issue du tir. |
| 0:43–0:52 | L’erreur compare la position observée au point prédit pour ce même instant. Les paramètres non mesurés restent des priors. |
| 0:52–1:05 | 18 simulations Monte-Carlo échantillonnent l’incertitude des paramètres. Les chiffres à droite sont ceux de cette exécution. |
| 1:05–1:20 | Et si le lancer était 20 % plus fort ? La trajectoire orange rejoue le contrefactuel dans le jumeau. |
| 1:20–1:35 | Et si le panier était décalé à gauche ? La scène de référence reste inchangée. |
| 1:35–1:47 | Le MPC simule des séquences candidates, compare leur coût et n’exécute que la première correction. Ici, il contrôle la simulation. |
| 1:47–1:59 | Chaque correction enregistre le coût, l’horizon, l’écart avant et après, ainsi que l’impulsion appliquée. |
| 1:59–2:15 | Cinq familles physiques disposent de tests synthétiques indépendants. Les preuves et leurs limites restent dans le rapport exportable. |
| 2:15–2:23 | Tout ce parcours fonctionne sans caméra ni dispositif physique. Les résultats synthétiques ne constituent pas une validation du réel. |
| 2:23–2:30 | TWINFORGE · Indie · Push the Frontier. Niveau L3. github.com/mkinvest57/TWINFORGE · démo : mkinvest57.github.io/TWINFORGE |

## Ce qui est mesuré à l’écran

Le panneau reprend le verdict verrouillé, l’erreur instantanée, la moyenne de session, les verdicts corrects et la probabilité Monte-Carlo du parcours en cours. Pendant le contrôle, il reprend aussi le coût J, l’horizon et Δv de la dernière correction enregistrée. Les chiffres ne sont pas inscrits en dur dans le montage; leur preuve est le journal de cette capture. Aucun chiffre historique 8,4 cm n’est annoncé comme moyenne de session.

Les échecs restent visibles. Le chargement du nouvel exemple est explicitement un capteur numérique 3D bruité, évalué sur un tir distinct des données d’ajustement. Sa vidéo n’est pas présentée comme une sortie SAM. Les valeurs de contacts non observées restent des priors; aucune performance de tir réel n’en est déduite. Aucun résultat attendu, y compris 1,016 cm du benchmark séparé, n’est écrit en dur dans les compteurs de cette capture.

## Livrables et revue

Vidéo de démonstration : `output/media/twinforge-demo-current.mp4`. GIF du fantôme : `output/media/ghost-current.gif`. Leur provenance est conservée à côté du média final; les originaux restent dans `artifacts/`. Se référer à `validation/submission.json` pour l’existence et le statut de revue effectifs. Ces chemins ne constituent pas, à eux seuls, une attestation de revue.

Visionner la vidéo entière en muet : rendu visible, sous-titres lisibles et continus, compteurs cohérents, étiquettes de simulation et liens finaux. Ne pas affirmer de revue intégrale à partir de quelques captures. Toute valeur affichée doit être reliée aux événements du parcours.

La structure suit l’ancre, la calibration, le fantôme, les contrefactuels, le contrôle et la fermeture. Les séquences réelles et la validation physique demandées par le PDF sont absentes : la démonstration L3 ne prétend donc pas satisfaire intégralement le prompt 6. La capture historique `docs/demo_capture.webm` dure 27,33 s (métadonnées vérifiées le 4 novembre); elle n’est ni cette vidéo ni une V1 complète conforme.
