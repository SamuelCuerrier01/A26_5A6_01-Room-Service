# AGENTS.md — Chatvardage Room Service

Règles de travail pour toute personne ou tout agent qui modifie ce dépôt.

## Contexte du projet

Ce dépôt est le **Room-Service** de Chatvardage.

Architecture d'équipe :

- `Frontend` : client Electron.
- `Mobile` : application Expo (React Native).
- `Serveur-API` : API Gateway / point d'entrée unique.
- `Authentification` : utilisateurs, authentification et rôles.
- `Room-Service` : serveurs (façon Discord), leurs membres, rôles et salons.
- `Message-Service` : messages privés et de salon, historique et temps réel.
- `User-Config-Service` : alias, thème et préférences.
- `Dashboard` : panneau d'administration / AdminJS.
- `Infra` : Docker Compose, PostgreSQL, Redis et orchestration globale.

Le Room-Service ne doit **pas** prendre en charge les messages (privés ou de salon), Redis, le WebSocket, les configurations utilisateur ou l'authentification.

## Stack

- Node.js 22
- NestJS 11
- TypeScript
- Prisma 6
- PostgreSQL 17
- Jest
- ESLint + Prettier
- Swagger / OpenAPI
- Docker / Docker Compose

## Responsabilités du Room-Service

Le service doit conserver la responsabilité de :

- créer, lire, modifier et supprimer des serveurs (publics ou privés) et leurs salons;
- gérer les membres d'un serveur, leurs rôles (propriétaire, modérateur, membre) et les invitations;
- gérer le serveur par défaut « Chatvardage » (tout le monde en est membre, impossible à quitter);
- appliquer les permissions selon le rôle de l'appelant DANS le serveur (seul l'`admin` global d'Authentification a des droits partout);
- exposer à Message-Service, par des routes internes protégées par jeton, l'accès d'un utilisateur à un salon et la liste des salons qu'il peut lire (avec sa date d'arrivée dans chaque serveur, pour les messages non lus et la recherche);
- persister serveurs, membres, invitations et salons dans PostgreSQL;
- exposer un healthcheck pour le service et PostgreSQL.

Ne pas déplacer ici les responsabilités des autres microservices.

## Contrat avec le Gateway

Le service est destiné à être appelé derrière `Serveur-API`.

Le Gateway transmet l'identité déjà validée avec :

```http
Authorization: Bearer <JWT>
```

Ne jamais considérer ces en-têtes comme sûrs si le service devient directement exposé à Internet. Dans l'architecture finale, le Room-Service doit rester un service interne.

Toutes les routes sont sous `/api`. Swagger est exposé sous `/docs`.

## Contrat de données avec le Frontend

Formats `serveur` et `salon` : voir le README (section « Modèle »). Tout changement de ces formats doit être coordonné avec le Frontend et Message-Service.

Les règles de permission sont codées **uniquement** dans `src/servers/permissions.ts` (rôle effectif, visibilité et écriture d'un salon, expulsion). Services, contrôleurs et route interne doivent s'appuyer sur ces fonctions plutôt que de réécrire une règle.

Les identifiants du serveur par défaut et de ses salons (`src/servers/default-server.ts`) sont figés par la migration `20260924100000_serveurs` et partagés avec Message-Service : ne jamais les modifier. Le Frontend s'appuie aussi dessus (et sur les noms d'origine `annonces` / `général`) pour traduire ces deux salons (`SALONS_PAR_DEFAUT` dans `src/presentation/pages/javascript/logique-interface.js`).

Les changements de serveur sont signalés à Message-Service par `EvenementsService` (appel HTTP interne « tire et oublie ») : toute nouvelle action qui modifie un serveur, ses membres, ses invitations ou ses salons doit appeler `evenements.notifier(...)` avec les bons destinataires (voir le tableau « Temps réel » du README). Ne pas ajouter Redis ni Socket.IO ici pour autant.

Les anciennes routes « salons autonomes » (`/api/rooms/*`, `GET /api/admin/rooms`) ont été retirées : ne pas les réintroduire, le Dashboard passe par `AdminController` (`GET /api/admin/servers`) et les routes des serveurs. Ne pas réintroduire de route lisible sans JWT : l'ancien `GET /api/rooms/:id` (authentification optionnelle) exposait le nom et les membres de serveurs privés. Les `userId` restent des chaînes. Ne pas ajouter de table `User` ou de clé étrangère vers un utilisateur : les utilisateurs appartiennent au service d'authentification.

## Base de données et Prisma

Schéma principal :

- `Server`
- `ServerMember`
- `ServerInvitation`
- `Room` (un salon d'un serveur)

Les migrations Prisma sont versionnées dans `prisma/migrations/`.

Après une modification de `prisma/schema.prisma` :

```bash
npx prisma generate
npx prisma migrate dev --name <nom_de_la_migration>
```

Ne jamais modifier une migration déjà appliquée pour masquer un changement. Créer une nouvelle migration.

Dans Docker/déploiement, utiliser :

```bash
npx prisma migrate deploy
```

## Commandes obligatoires avant de terminer une modification

Installer les dépendances de façon reproductible :

```bash
npm ci
```

Puis exécuter au minimum :

```bash
npm audit --audit-level=high
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
```

**Audit des dépendances** : le CI lance `npm audit --audit-level=high` (dépendances de dev comprises). Si un avis `high` ou `critical` sans correctif compatible le bloque, forcer une version corrigée par un `overrides` ciblé dans `package.json` si elle existe ; sinon consigner l'exception dans une section « Limites connues » du README, à créer au besoin (paquet, avis, raison, condition de retrait). Ne pas retirer ni affaiblir l'étape.

Pour une modification importante de logique métier, exécuter aussi :

```bash
npm run test:cov
```

Pour vérifier le formatage :

```bash
npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

`npm run format` modifie les fichiers; ne l'utiliser que lorsqu'un formatage automatique est souhaité.

Un agent ne doit pas annoncer que le travail est terminé si une de ces vérifications échoue. Il doit corriger l'erreur ou indiquer clairement ce qui bloque.

## Tests

Framework officiel de ce dépôt : **Jest**. Ne pas réintroduire Vitest sans décision d'équipe.

Lors d'un changement de comportement :

1. ajouter ou modifier les tests concernés;
2. couvrir le chemin nominal;
3. couvrir les permissions et les erreurs importantes;
4. éviter les tests qui vérifient uniquement `toBeDefined()` lorsqu'un comportement peut être testé;
5. mocker `PrismaService` dans les tests unitaires plutôt que dépendre d'une vraie base de données.

Les tests E2E doivent refléter les routes actuelles du Room-Service et ne doivent pas réintroduire le test NestJS par défaut `Hello World`.

## Lint, style et qualité

- Respecter ESLint et Prettier existants.
- Garder TypeScript typé; éviter `any` dans le code de production.
- Garder les contrôleurs minces : validation HTTP/headers et délégation au service.
- Garder la logique métier dans `ServersService` / `ChannelsService`, et les règles de permission dans `permissions.ts`.
- Garder l'accès aux données via Prisma.
- Réutiliser les helpers de permissions au lieu de dupliquer les règles.
- Valider les entrées avec les DTO et `class-validator`.
- Retourner des erreurs HTTP NestJS explicites (`BadRequestException`, `ForbiddenException`, `NotFoundException`, etc.).
- Ne pas laisser de code généré, mort ou de dépendances inutilisées.
- Pas de commentaires dans le code : les explications vont dans le README, le guide du service d'Infra ou ce fichier. Seules restent les directives d'outils.

## Fichiers partagés (`src/partage/`)

`src/partage/` contient des fichiers **identiques à l'octet près** dans plusieurs dépôts :

- `client-auth.ts` (+ spec) : validation du JWT auprès d'Authentification, avec cache — identique dans Message-Service ;
- `secrets-production.ts` (+ spec) : refus de démarrer en production avec les secrets de développement — identique dans Message-Service et User-Config-Service.

Ne pas les modifier dans un seul dépôt : reporter le même changement partout, puis lancer `A26_5A6_01-Infra/scripts/verifier-fichiers-partages.sh`. Ce qui est propre au service (par exemple les secrets exigés) se passe en paramètre depuis `main.ts` ou `auth/auth.service.ts`.

## Docker

Pour tester ce dépôt seul :

```bash
docker compose -f compose.local.yml up --build
```

Le compose local doit lancer :

- Room-Service sur `3003`;
- PostgreSQL;
- les migrations Prisma au démarrage du service.

Healthcheck attendu :

```bash
curl http://localhost:3003/api/health
```

Le `compose.local.yml` sert au développement autonome. L'environnement final est orchestré par le dépôt `Infra`.

Ne pas ajouter Redis au Room-Service : Redis/WebSocket appartient au flux temps réel de `Message-Service`, que Room-Service prévient des changements de serveur par HTTP interne.

## Documentation

Toute modification d'une route, d'un DTO, d'une permission, d'une variable d'environnement, d'un port ou d'une procédure de lancement doit mettre à jour :

- Swagger/OpenAPI lorsque pertinent;
- `README.md`;
- `.env.example` lorsque pertinent;
- ce fichier `AGENTS.md` si les règles de développement changent.

Le README doit rester suffisant pour démarrer et tester le service sans connaissance implicite du projet.

## Avant une Pull Request

Vérifier :

- [ ] le changement reste dans la responsabilité du Room-Service;
- [ ] aucun secret ou `.env` réel n'est commité;
- [ ] les migrations Prisma nécessaires sont présentes;
- [ ] `npm run lint` passe;
- [ ] `npm test` passe;
- [ ] `npm run test:e2e` passe;
- [ ] `npm run build` passe;
- [ ] `npm audit --audit-level=high` passe;
- [ ] `npm run test:cov` a été vérifié pour les changements importants;
- [ ] Swagger et README sont à jour;
- [ ] le compose local fonctionne si Docker/DB ont été modifiés;
- [ ] les changements incompatibles avec Frontend/Serveur-API sont documentés.

Dans la description de PR, résumer les changements, indiquer les tests exécutés et signaler tout impact sur les autres dépôts.

## Couverture obligatoire

- `npm run test:cov` doit terminer avec 100 % Statements, Branches, Functions et Lines.
- Le seuil Jest global est fixé à 100 % : toute baisse fait échouer la commande.
- Toute nouvelle branche de logique doit être accompagnée de tests couvrant succès, refus et erreurs.
- Avant une PR : `npm audit --audit-level=high`, `npm run lint`, `npm test`, `npm run test:cov`, `npm run test:e2e`, `npm run build`.

## Documentation centrale

Infra est la référence du démarrage complet, des architectures, contrats et scénarios de validation. Le README local décrit le dépôt et ses commandes; les guides détaillés sont dans `A26_5A6_01-Infra/docs/`. Toute modification de contrat doit mettre à jour la référence centrale et ses liens.

## Choix délibérés (ne pas « corriger »)

- **Liste interne des salons lisibles non bornée** : Message-Service a besoin de tous les salons lisibles pour les non-lus et la recherche ; tronquer ferait disparaître des salons autorisés.
- **Propriétaire sans `ServerMember` après une modification manuelle de la base** : pas d'assertion ; la création normale insère le membre et `depuis: null` évite d'inventer une date. Réparer les données à la source.
- **Prisma reste une dépendance de production** : l'installation `--omit=dev` garde le CLI qui applique les migrations au démarrage (`node_modules/.bin/prisma`).
- **Limite de découverte à 100** : c'est la borne métier existante.
- **`overrides` de `js-yaml`** : il corrige un avis ; le retirer le réintroduirait.
- **Un décalage au-delà du total** (membres, serveurs) renvoie une page vide sans requête `SKIP` ; pas de plafond arbitraire qui empêcherait de parcourir un grand serveur.
- **`apk upgrade` dans l'image** : il applique volontairement les correctifs disponibles ; image de base identifiée par digest.
- **Course sur le quota de serveurs possédés** entre créations et transferts simultanés : limite connue, sans contournement des droits. Une garantie stricte demanderait un verrou commun à toutes les créations et tous les transferts.
