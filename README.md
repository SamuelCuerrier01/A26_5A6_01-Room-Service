# Chatvardage — Serveurs, salons et permissions

Microservice NestJS/Prisma propriétaire des serveurs, salons, membres et invitations. Les droits de modération sont propres à chaque serveur; seul admin est global.

## Lancer le service complet

Le [README Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/README.md) est le point de départ : clonage des dépôts, secrets, Docker Compose, administration et clients.

Depuis le dépôt Infra :

```bash
docker compose up --build -d
./scripts/healthcheck.sh
```

Le `.env` d'Infra est généré au premier démarrage. Le healthcheck vérifie PostgreSQL, les quatre bases, Redis, les services (Dashboard compris), puis les dépendances du Gateway ; `--infra` se limite à PostgreSQL et Redis.

## Développer ce dépôt seul

Prérequis : Docker Compose v2; hors Docker, Node 22 et PostgreSQL; Authentification accessible pour les routes protégées.

```bash
cp .env.example .env
docker compose -f compose.local.yml up --build
```

Le Compose individuel attend Authentification sur l’hôte. Pour une installation complète, utiliser Infra.

Service local : `http://localhost:3003`. Santé : `GET /api/health`. Swagger : `http://localhost:3003/docs`. Les Compose individuels utilisent des ports communs à Infra : choisir un seul environnement à la fois.

La configuration, les routes, les permissions et les exemples sont dans le [guide du service dans Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/services/Room-Service.md). Les valeurs de `.env.example` sont réservées au développement.

## Vérifications

```bash
npm ci
npm audit --audit-level=high
npx prisma generate
npm run lint
npm run format:check
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Les migrations appartiennent à ce dépôt (`prisma/migrations`) ; Infra crée uniquement les bases et les comptes SQL. Consulter [AGENTS.md](AGENTS.md) pour les règles et vérifications supplémentaires.

## Documentation

- [Architecture complète](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/architecture.md)
- [API et événements](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/README.md)
- [Scénario de validation](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/validation.md)
- [Versions et publication](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/versions.md)

## Sécurité et limites

- Le jeton est validé par Authentification (`src/partage/client-auth.ts`, identique dans Message-Service) ; une vérification explicitement fraîche invalide la requête en cours, pour qu'une réponse antérieure à une révocation ne remplisse pas le cache.
- L'image finale ne contient ni npm ni npx : les migrations sont appliquées par `./node_modules/.bin/prisma migrate deploy`. Rapport d'audit : [Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/develop/docs/audit-securite-2026-10-09.md).
- Pagination des membres et des serveurs : un décalage au-delà du total renvoie une page vide sans requête `SKIP`.
- Le quota de serveurs possédés peut être dépassé par des créations ou transferts strictement simultanés ; les droits de propriété restent vérifiés.
