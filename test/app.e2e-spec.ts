import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SALON_ANNONCES_ID,
  SERVEUR_PAR_DEFAUT_ID,
} from '../src/servers/default-server';

describe('Room-Service : serveurs et salons (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: any;
  const ancienJetonInterne = process.env.INTERNAL_SERVICE_TOKEN;

  const date = new Date('2026-01-01T00:00:00.000Z');
  const utilisateur = (id: string, role = 'utilisateur') => ({
    id,
    pseudo: id,
    courriel: `${id}@example.test`,
    role,
    cree_le: date.toISOString(),
    modifie_le: date.toISOString(),
  });
  const jetons: Record<string, ReturnType<typeof utilisateur>> = {
    'Bearer bob-jwt': utilisateur('bob'),
    'Bearer admin-jwt': utilisateur('root', 'admin'),
  };

  const annonces = {
    id: SALON_ANNONCES_ID,
    serverId: SERVEUR_PAR_DEFAUT_ID,
    name: 'annonces',
    position: 0,
    access: 'tous',
    writePolicy: 'moderateurs',
    createdBy: null,
    createdAt: date,
    updatedAt: date,
  };
  const chatvardage = {
    id: SERVEUR_PAR_DEFAUT_ID,
    name: 'Chatvardage',
    icon: null,
    ownerId: null,
    isPublic: true,
    isDefault: true,
    createdAt: date,
    updatedAt: date,
    members: [
      {
        serverId: SERVEUR_PAR_DEFAUT_ID,
        userId: 'bob',
        role: 'membre',
        joinedAt: date,
      },
    ],
    invitations: [],
    channels: [annonces],
    _count: { members: 1 },
  };

  const requete = (
    chemin: string,
    options: {
      methode?: string;
      jeton?: string;
      corps?: unknown;
      entetes?: Record<string, string>;
    } = {},
  ) =>
    fetch(`${baseUrl}${chemin}`, {
      method: options.methode ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.jeton ? { Authorization: options.jeton } : {}),
        ...options.entetes,
      },
      body:
        options.corps === undefined ? undefined : JSON.stringify(options.corps),
    });

  beforeEach(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'jeton-interne-e2e';
    const authService = {
      authenticate: jest.fn(async (authorization?: string) => {
        const user = authorization ? jetons[authorization] : undefined;
        if (!user)
          throw new UnauthorizedException('Authorization Bearer requis');
        return user;
      }),
    };

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
      server: {
        findMany: jest.fn().mockResolvedValue([chatvardage]),
        findUnique: jest.fn().mockResolvedValue(chatvardage),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          ...chatvardage,
          id: 'srv-nouveau',
          name: data.name,
          ownerId: data.ownerId,
          isPublic: data.isPublic,
          isDefault: false,
          members: [
            {
              serverId: 'srv-nouveau',
              userId: data.ownerId,
              role: 'membre',
              joinedAt: date,
            },
          ],
          channels: [
            {
              ...annonces,
              id: 'salon-general',
              serverId: 'srv-nouveau',
              name: 'général',
              writePolicy: 'tous',
            },
          ],
          _count: { members: 1 },
        })),
        delete: jest.fn(),
      },
      serverMember: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue(chatvardage.members),
        count: jest.fn().mockResolvedValue(1),
      },
      room: {
        findUnique: jest.fn().mockImplementation(({ where, include }: any) => {
          if (where.id !== SALON_ANNONCES_ID) return null;
          const filtre = include.server.include.members.where;
          return {
            ...annonces,
            server: {
              ...chatvardage,
              members: filtre
                ? chatvardage.members.filter((m) => m.userId === filtre.userId)
                : chatvardage.members,
            },
          };
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue(authService)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterEach(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = ancienJetonInterne;
    await app.close();
  });

  it('GET /api/health', async () => {
    const reponse = await requete('/api/health');
    expect(reponse.status).toBe(200);
  });

  it('GET /api/servers exige un JWT', async () => {
    expect((await requete('/api/servers')).status).toBe(401);
  });

  it('GET /api/servers ajoute au serveur par défaut et renvoie Chatvardage', async () => {
    const reponse = await requete('/api/servers', { jeton: 'Bearer bob-jwt' });
    expect(reponse.status).toBe(200);
    const serveurs = await reponse.json();
    expect(prisma.serverMember.createMany).toHaveBeenCalled();
    expect(serveurs[0]).toMatchObject({
      type: 'serveur',
      nom: 'Chatvardage',
      parDefaut: true,
      monRole: 'membre',
      salons: [{ nom: 'annonces', ecriture: 'moderateurs', peutEcrire: false }],
    });
  });

  it('GET /api/servers/:id/members : page de membres, paramètres validés', async () => {
    const reponse = await requete(
      `/api/servers/${SERVEUR_PAR_DEFAUT_ID}/members?decalage=0&limite=10`,
      { jeton: 'Bearer bob-jwt' },
    );
    expect(reponse.status).toBe(200);
    await expect(reponse.json()).resolves.toEqual({
      membres: [{ utilisateurId: 'bob', role: 'membre' }],
      total: 1,
      suivant: null,
    });

    const parIds = await requete(
      `/api/servers/${SERVEUR_PAR_DEFAUT_ID}/members?ids=bob,%20bob,,autre`,
      { jeton: 'Bearer bob-jwt' },
    );
    expect(parIds.status).toBe(200);
    expect(prisma.serverMember.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          serverId: SERVEUR_PAR_DEFAUT_ID,
          userId: { in: ['bob', 'autre'] },
        },
      }),
    );

    for (const requeteInvalide of ['limite=0', 'limite=101', 'decalage=-1']) {
      const invalide = await requete(
        `/api/servers/${SERVEUR_PAR_DEFAUT_ID}/members?${requeteInvalide}`,
        { jeton: 'Bearer bob-jwt' },
      );
      expect(invalide.status).toBe(400);
    }
  });

  it('POST /api/servers : tout utilisateur crée un serveur dont il est propriétaire', async () => {
    const reponse = await requete('/api/servers', {
      methode: 'POST',
      jeton: 'Bearer bob-jwt',
      corps: { nom: '  Projet  ', public: true },
    });
    expect(reponse.status).toBe(201);
    await expect(reponse.json()).resolves.toMatchObject({
      nom: 'Projet',
      public: true,
      monRole: 'proprietaire',
      salons: [{ nom: 'général' }],
    });
  });

  it('POST /api/servers valide le corps', async () => {
    const reponse = await requete('/api/servers', {
      methode: 'POST',
      jeton: 'Bearer bob-jwt',
      corps: { nom: '   ', inconnu: 1 },
    });
    expect(reponse.status).toBe(400);
  });

  it('DELETE /api/servers/:id refuse le serveur par défaut, même pour un admin', async () => {
    const reponse = await requete(`/api/servers/${SERVEUR_PAR_DEFAUT_ID}`, {
      methode: 'DELETE',
      jeton: 'Bearer admin-jwt',
    });
    expect(reponse.status).toBe(400);
    expect(prisma.server.delete).not.toHaveBeenCalled();
  });

  it('POST /api/servers/:id/leave refuse de quitter le serveur par défaut', async () => {
    const reponse = await requete(
      `/api/servers/${SERVEUR_PAR_DEFAUT_ID}/leave`,
      {
        methode: 'POST',
        jeton: 'Bearer bob-jwt',
      },
    );
    expect(reponse.status).toBe(400);
  });

  describe('route interne /api/internal/channels/:id/access/:userId', () => {
    const chemin = `/api/internal/channels/${SALON_ANNONCES_ID}/access/bob`;

    it('refuse sans jeton interne (le JWT ne suffit pas)', async () => {
      expect((await requete(chemin, { jeton: 'Bearer bob-jwt' })).status).toBe(
        401,
      );
    });

    it('#annonces : lecture seule pour un membre', async () => {
      const reponse = await requete(chemin, {
        entetes: { 'x-internal-token': 'jeton-interne-e2e' },
      });
      expect(reponse.status).toBe(200);
      await expect(reponse.json()).resolves.toEqual({
        salonId: SALON_ANNONCES_ID,
        serveurId: SERVEUR_PAR_DEFAUT_ID,
        estMembre: true,
        peutLire: true,
        peutEcrire: false,
        peutModerer: false,
      });
    });

    it('#annonces : un admin global peut écrire', async () => {
      const reponse = await requete(
        `/api/internal/channels/${SALON_ANNONCES_ID}/access/root?role=admin`,
        { entetes: { 'x-internal-token': 'jeton-interne-e2e' } },
      );
      await expect(reponse.json()).resolves.toMatchObject({ peutEcrire: true });
    });

    it('rôle inconnu : 400', async () => {
      const reponse = await requete(`${chemin}?role=root`, {
        entetes: { 'x-internal-token': 'jeton-interne-e2e' },
      });
      expect(reponse.status).toBe(400);
    });
  });

  it('les anciennes routes de transition n’existent plus', async () => {
    for (const [methode, chemin] of [
      ['GET', '/api/admin/rooms'],
      ['DELETE', `/api/rooms/${SALON_ANNONCES_ID}`],
    ]) {
      const reponse = await requete(chemin, {
        methode,
        jeton: 'Bearer admin-jwt',
      });
      expect(reponse.status).toBe(404);
    }
  });

  it('GET /api/rooms/:id (ancienne route sans JWT) n’existe plus', async () => {
    expect((await requete(`/api/rooms/${SALON_ANNONCES_ID}`)).status).toBe(404);
  });
});
