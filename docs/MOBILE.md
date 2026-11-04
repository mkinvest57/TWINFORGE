# Caméra locale sur téléphone

La page [scan.html](../scan.html) constitue un parcours mobile distinct du laboratoire 3D. Elle suit un objet choisi dans l’image et prolonge brièvement son mouvement dans ce même plan. **Cette prévision 2D est une approximation locale; une photo ne reconstruit pas un jumeau physique 3D.** Les mesures du benchmark 3D du laboratoire ne sont pas les performances de cette caméra.

## Ouvrir la page

Sur téléphone : [ouvrir la caméra Twinforge en HTTPS](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/scan.html), puis se connecter avec le même compte ChatGPT que le propriétaire du projet si la page le demande. L’aperçu est **privé**. Sa [preuve de déploiement](../validation/runs/mobile-2026-11-04/deployment.json) identifie la version hébergée; la page de connexion HTTPS a été vérifiée, mais l’exécution distante après connexion n’a pas pu être vérifiée dans la session de test sans authentification.

Sur la machine de développement :

```bash
.venv/bin/python server.py
```

Ouvrir `http://127.0.0.1:8000/scan.html` sur cette même machine. Le serveur reste lié à `127.0.0.1`; il n’est pas accessible depuis un téléphone sur le réseau local. Ne pas élargir l’adresse d’écoute ou le filtre Host pour la caméra.

Sur téléphone, ouvrir la version **statique HTTPS** dans une version récente de Safari ou Chrome. Seuls les fichiers de l’interface mobile sont nécessaires; le serveur Python, les fournisseurs et leurs clés ne font pas partie de ce site. Le manifeste des ressources et la preuve de déploiement identifient les fichiers et la version hébergés.

Le dossier statique inclut aussi l’atelier 3D accessible par son lien. Ses opérations utilisant des fournisseurs restent liées au serveur local configuré; elles ne sont pas exposées par l’hébergement statique. La caméra, son suivi et ses prévisions ne dépendent pas de ces opérations.

L’accès à la caméra demande un contexte sécurisé et l’autorisation de la personne qui utilise l’app. Si l’autorisation est refusée, le navigateur ne fournit pas de flux; si la demande reste sans réponse, elle peut rester en attente. Voir [MDN : getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Ouvrir l’URL directement dans un onglet Safari ou Chrome pour le test caméra. Un aperçu intégré dans un cadre peut bloquer la demande si son parent ne délègue pas l’autorisation caméra; le fonctionnement de la page principale et celui de ce cadre sont deux contrôles distincts. [MDN : contexte et permissions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

## Utiliser le suivi

1. Choisir **Ouvrir la caméra** et autoriser son accès; aucune caméra ne doit démarrer sans cette action. **Changer** permet de demander l’autre caméra.
2. Toucher l’objet, l’encadrer en glissant le doigt ou choisir **Sélection au centre**. Préférer une vue stable et un objet contrasté qui reste visible. **Resélectionner** réinitialise le suivi.
3. Observer la position suivie et la prévision courte dans le plan de l’image. Une perte de suivi ou une confiance insuffisante doit rester visible.
4. Choisir **Arrêter** avant de quitter le parcours. Le contrôleur interrompt aussi ses pistes lorsque la page passe en arrière-plan.

**Exemple sans caméra** affiche un objet synthétique dont les pixels sont analysés par le même suivi. **Choisir ou filmer une vidéo** charge une vidéo locale ou ouvre le parcours vidéo proposé par le téléphone; le fichier reste sur l’appareil. Ce parcours n’accepte pas une photo comme preuve de mouvement.

La caméra et le calcul s’exécutent dans le navigateur. Les images ne sont pas envoyées à une API de modèle et aucune clé n’est incluse côté client. **Exporter les mesures** télécharge un JSON de positions, prévisions et erreurs, sans images de caméra. **Enregistrer un clip** prépare jusqu’à huit secondes de vidéo de la caméra, sans son; choisir ensuite **Télécharger le clip** pour conserver le fichier. Ce téléchargement est distinct des mesures et ne constitue pas un envoi au serveur. Les sources et preuves du parcours confirment séparément ces propriétés.

Le modèle ne connaît ni la profondeur, ni l’échelle métrique, ni la masse ou les contacts. Une caméra qui bouge, une occlusion, un changement de perspective ou une accélération forte peuvent invalider la prolongation locale. Les coordonnées en pixels ne deviennent pas des centimètres sans calibration mesurée.

## Installation et enregistrement

Le [manifeste](../manifest.webmanifest) décrit une ouverture sur `./scan.html`, un périmètre `./` et un affichage autonome. Les icônes SVG sont fournies dans `assets/mobile/`. La disponibilité de l’ajout à l’écran d’accueil dépend du navigateur; le manifeste ne prouve pas un test sur un appareil physique.

Aucun service worker n’est ajouté : aucune requête d’API ni image de caméra n’entre dans un cache applicatif. Le suivi peut continuer localement après le chargement des ressources, mais un rechargement complet sans réseau n’est pas garanti.

Lorsqu’un enregistrement vidéo est proposé, le format doit être choisi parmi ceux supportés par le navigateur. Même un format déclaré supporté peut échouer si les ressources disponibles sont insuffisantes. Voir [MDN : MediaRecorder.isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

## Preuves séparées

Les tests mobiles vérifient leur propre version des sources : accès aux fichiers statiques, permissions, arrêt des pistes, suivi/prédiction, export et absence d’appel fournisseur. Un flux caméra synthétique utilisé par l’automatisation n’est pas annoncé comme un essai sur téléphone réel.

La suite finale de cette version passe **148 tests : 87 Python et 61 JavaScript**, avec hashes des sources stables. Le [relevé mobile](../validation/runs/software-checks-mobile-2026-11-04.json) est distinct de l’ancien relevé de simulation. Le [manifeste statique](../validation/runs/mobile-static-assets-2026-11-04.json) identifie les copies exactes des 29 fichiers destinés à l’hébergement; il ne contient ni backend ni clé.

La [revue navigateur](../validation/runs/mobile-2026-11-04/browser-review.json) mesure le parcours local sur des tailles de fenêtre de 320, 390, 844 et 1 280 pixels, sans débordement horizontal. Le suivi continue après rotation. L’exemple synthétique exporté comprend 839 observations, 400 prévisions émises et 396 évaluées, avec **1,631 pixel d’erreur moyenne** dans l’image d’analyse réduite. Ce chiffre n’est ni une mesure réelle ni un score en centimètres. L’import H.264 a été vérifié comme parcours fonctionnel; un format vidéo non pris en charge produit une erreur visible. Aucun téléphone physique ni caméra réelle n’a été utilisé pour cette revue.

Créer un relevé logiciel distinct après stabilisation :

```bash
.venv/bin/python validation/run_checks.py --out validation/runs/software-checks-mobile-2026-11-04.json
```

L’inventaire inclut `scan.html`, le manifeste, les SVG et les styles, en plus des sources Python/JavaScript. Le rapport garde les commandes, sorties et hashes avant/après. Il ne certifie pas à lui seul une permission caméra sur Safari/iPhone ou Chrome/Android physique.

Le paquet de simulation précédent, ses médias et ses rapports restent des archives immuables. Modifier `index.html` ou `server.py` rend leurs hashes de sources courantes différents; les anciens rapports ne doivent pas être réépinglés pour les faire passer artificiellement. La livraison mobile produit un paquet distinct.
