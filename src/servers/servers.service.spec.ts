import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SERVEUR_PAR_DEFAUT_ID } from './default-server';
import {
  MAX_INVITATIONS_EN_ATTENTE,
  MAX_SERVEURS_POSSEDES,
  ServersService,
} from './servers.service';

const date = new Date('2026-01-01T00:00:00.000Z');

const salon = (overrides: Record<string, unknown> = {}) => ({
  id: 'salon-1',
  serverId: 'srv-1',
  name: 'général',
  position: 0,
  access: 'tous' as const,
  writePolicy: 'tous' as const,
  createdBy: 'owner',
  createdAt: date,
  updatedAt: date,
  ...overrides,
});

const membre = (userId: string, role: 'membre' | 'moderateur' = 'membre') => ({
  serverId: 'srv-1',
  userId,
  role,
  joinedAt: date,
});

const makeServeur = (overrides: Record<string, unknown> = {}) =>
  avecCompte({
    id: 'srv-1',
    name: 'Projet',
    icon: null,
    ownerId: 'owner',
    isPublic: false,
    isDefault: false,
    createdAt: date,
    updatedAt: date,
    members: [membre('owner'), membre('modo', 'moderateur'), membre('bob')],
    invitations: [
      {
        serverId: 'srv-1',
        userId: 'invite',
        invitedBy: 'bob',
        invitedAt: date,
      },
    ],
    channels: [
      salon(),
      salon({
        id: 'salon-modos',
        name: 'modos',
        position: 1,
        access: 'moderateurs',
      }),
    ],
    ...overrides,
  });

function avecCompte<T extends { members: unknown[] }>(serveur: T) {
  return { ...serveur, _count: { members: serveur.members.length } };
}

const parDefaut = () =>
  makeServeur({
    id: SERVEUR_PAR_DEFAUT_ID,
    name: 'Chatvardage',
    ownerId: null,
    isPublic: true,
    isDefault: true,
    members: [membre('bob')],
    invitations: [],
  });

const u = (id: string) => ({ id, role: 'utilisateur' as const });
const admin = { id: 'root', role: 'admin' as const };

describe('ServersService', () => {
  let service: ServersService;
  let prisma: any;
  let evenements: { notifier: jest.Mock; salonsSupprimes: jest.Mock };

  beforeEach(() => {
    prisma = {
      server: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      serverMember: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
      serverInvitation: {
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
    };
    evenements = { notifier: jest.fn(), salonsSupprimes: jest.fn() };
    service = new ServersService(prisma as PrismaService, evenements as any);
  });

  describe('lecture', () => {
    it("listerMesServeurs ajoute l'appelant au serveur par défaut puis liste ses serveurs", async () => {
      prisma.server.findMany.mockResolvedValue([parDefaut(), makeServeur()]);

      const serveurs = await service.listerMesServeurs(u('bob'));

      expect(prisma.serverMember.createMany).toHaveBeenCalledWith({
        data: [{ serverId: SERVEUR_PAR_DEFAUT_ID, userId: 'bob' }],
        skipDuplicates: true,
      });
      expect(evenements.notifier).not.toHaveBeenCalled();
      expect(prisma.server.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { members: { some: { userId: 'bob' } } },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        }),
      );
      expect(serveurs.map((s) => [s.nom, s.monRole])).toEqual([
        ['Chatvardage', 'membre'],
        ['Projet', 'membre'],
      ]);
    });

    it('nouveau membre de Chatvardage : personne n’est prévenu', async () => {
      prisma.serverMember.createMany.mockResolvedValue({ count: 1 });
      prisma.server.findMany.mockResolvedValue([parDefaut()]);
      await service.listerMesServeurs(u('neuf'));
      expect(prisma.serverMember.createMany).toHaveBeenCalledWith({
        data: [{ serverId: SERVEUR_PAR_DEFAUT_ID, userId: 'neuf' }],
        skipDuplicates: true,
      });
      expect(evenements.notifier).not.toHaveBeenCalled();
    });

    it('un membre ne voit ni le salon des modérateurs ni les invitations', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      const serveur = await service.obtenir('srv-1', u('bob'));
      expect(serveur.salons.map((s) => s.id)).toEqual(['salon-1']);
      expect(serveur.invitations).toEqual([]);
      expect(serveur).not.toHaveProperty('membres');
      expect(serveur.nombreMembres).toBe(3);
      expect(prisma.server.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            members: { where: { userId: 'bob' } },
          }),
        }),
      );
      expect(serveur.salons[0]).toEqual({
        type: 'salon',
        id: 'salon-1',
        serveurId: 'srv-1',
        nom: 'général',
        position: 0,
        acces: 'tous',
        ecriture: 'tous',
        peutEcrire: true,
        creePar: 'owner',
      });
    });

    it('un modérateur voit tout, invitations comprises', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      const serveur = await service.obtenir('srv-1', u('modo'));
      expect(serveur.salons).toHaveLength(2);
      expect(serveur.invitations).toEqual(['invite']);
    });

    it('serveur public, non-membre : simple aperçu', async () => {
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ isPublic: true }),
      );
      const serveur = await service.obtenir('srv-1', u('inconnu'));
      expect(serveur).toMatchObject({
        monRole: null,
        salons: [],
        invitations: [],
        nombreMembres: 3,
      });
    });

    it('serveur privé, non-membre : 404 (existence non révélée)', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(service.obtenir('srv-1', u('inconnu'))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('serveur inexistant : 404', async () => {
      prisma.server.findUnique.mockResolvedValue(null);
      await expect(service.obtenir('x', u('bob'))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('decouvrir filtre les serveurs publics non rejoints, par nom, par pages', async () => {
      prisma.server.count = jest.fn().mockResolvedValue(3);
      prisma.server.findMany.mockResolvedValue([
        { ...makeServeur({ isPublic: true }), _count: { members: 3 } },
      ]);
      await expect(service.decouvrir(u('bob'), 'pro')).resolves.toEqual({
        serveurs: [
          {
            type: 'serveur',
            id: 'srv-1',
            nom: 'Projet',
            icone: null,
            public: true,
            nombreMembres: 3,
          },
        ],
        total: 3,
        suivant: 1,
      });
      const where = {
        isPublic: true,
        members: { none: { userId: 'bob' } },
        name: { contains: 'pro', mode: 'insensitive' },
      };
      expect(prisma.server.count).toHaveBeenCalledWith({ where });
      expect(prisma.server.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          orderBy: [
            { members: { _count: 'desc' } },
            { name: 'asc' },
            { id: 'asc' },
          ],
          skip: 0,
          take: 10,
        }),
      );
    });

    it('decouvrir : page suivante et dernière page', async () => {
      prisma.server.count = jest.fn().mockResolvedValue(3);
      prisma.server.findMany.mockResolvedValue([
        { ...makeServeur({ isPublic: true }), _count: { members: 1 } },
      ]);
      await expect(
        service.decouvrir(u('bob'), undefined, { decalage: 2, limite: 2 }),
      ).resolves.toMatchObject({ total: 3, suivant: null });
      expect(prisma.server.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 2, take: 2 }),
      );
    });

    it('un décalage hors liste ne lance aucune requête SKIP de serveur', async () => {
      prisma.server.count = jest.fn().mockResolvedValue(3);
      await expect(
        service.decouvrir(u('bob'), undefined, { decalage: 999999999 }),
      ).resolves.toEqual({ serveurs: [], total: 3, suivant: null });
      await expect(
        service.listerPourAdmin(admin, { decalage: 999999999 }),
      ).resolves.toEqual({ serveurs: [], total: 3, suivant: null });
      expect(prisma.server.findMany).not.toHaveBeenCalled();
    });

    it('decouvrir sans texte ne filtre pas sur le nom', async () => {
      prisma.server.count = jest.fn().mockResolvedValue(0);
      prisma.server.findMany.mockResolvedValue([]);
      await expect(service.decouvrir(u('bob'))).resolves.toEqual({
        serveurs: [],
        total: 0,
        suivant: null,
      });
      expect(prisma.server.findMany.mock.calls[0][0].where).toEqual({
        isPublic: true,
        members: { none: { userId: 'bob' } },
      });
    });

    it('listerPourAdmin : par pages, réservé aux administrateurs', async () => {
      prisma.server.count = jest.fn().mockResolvedValue(3);
      prisma.server.findMany.mockResolvedValue([
        { ...makeServeur(), _count: { members: 3 } },
      ]);
      await expect(service.listerPourAdmin(admin)).resolves.toMatchObject({
        serveurs: [{ id: 'srv-1', nombreMembres: 3 }],
        total: 3,
        suivant: 1,
      });
      expect(prisma.server.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
      await expect(
        service.listerPourAdmin(admin, { decalage: 2, limite: 10 }),
      ).resolves.toMatchObject({ suivant: null });
      await expect(service.listerPourAdmin(u('bob'))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('création et modification', () => {
    it("creer rend l'appelant propriétaire avec un salon #général (privé par défaut)", async () => {
      prisma.server.create.mockResolvedValue(
        makeServeur({
          ownerId: 'bob',
          members: [membre('bob')],
          invitations: [],
        }),
      );
      const serveur = await service.creer({ nom: 'Projet' }, u('bob'));
      expect(prisma.server.count).toHaveBeenCalledWith({
        where: { ownerId: 'bob' },
      });
      expect(prisma.server.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Projet',
            isPublic: false,
            ownerId: 'bob',
            members: { create: { userId: 'bob' } },
            channels: {
              create: { name: 'général', position: 0, createdBy: 'bob' },
            },
          },
        }),
      );
      expect(serveur.monRole).toBe('proprietaire');
    });

    it('creer un serveur public', async () => {
      prisma.server.create.mockResolvedValue(makeServeur({ isPublic: true }));
      await service.creer({ nom: 'Ouvert', public: true }, u('owner'));
      expect(prisma.server.create.mock.calls[0][0].data.isPublic).toBe(true);
    });

    it('modifier : propriétaire seulement', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(
        service.modifier('srv-1', { nom: 'x' }, u('modo')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('modifier sans champ : 400', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(service.modifier('srv-1', {}, u('owner'))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('modifier nom, visibilité et retirer l’icône (chaîne vide)', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      prisma.server.update.mockResolvedValue(makeServeur({ name: 'Nouveau' }));
      await service.modifier(
        'srv-1',
        { nom: 'Nouveau', public: true, icone: '' },
        u('owner'),
      );
      expect(prisma.server.update.mock.calls[0][0].data).toEqual({
        name: 'Nouveau',
        isPublic: true,
        icon: null,
      });
    });

    it('modifier seulement l’icône', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      prisma.server.update.mockResolvedValue(makeServeur());
      await service.modifier(
        'srv-1',
        { icone: 'data:image/png;base64,AA==' },
        u('owner'),
      );
      expect(prisma.server.update.mock.calls[0][0].data).toEqual({
        icon: 'data:image/png;base64,AA==',
      });
    });

    it('le serveur par défaut reste public, mais un admin peut le renommer', async () => {
      prisma.server.findUnique.mockResolvedValue(parDefaut());
      await expect(
        service.modifier(SERVEUR_PAR_DEFAUT_ID, { public: false }, admin),
      ).rejects.toThrow(BadRequestException);

      prisma.server.update.mockResolvedValue(parDefaut());
      await service.modifier(SERVEUR_PAR_DEFAUT_ID, { nom: 'Accueil' }, admin);
      expect(prisma.server.update).toHaveBeenCalled();
    });

    it('supprimer : propriétaire seulement, jamais le serveur par défaut', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(service.supprimer('srv-1', u('bob'))).rejects.toThrow(
        ForbiddenException,
      );
      await service.supprimer('srv-1', u('owner'));
      expect(prisma.server.delete).toHaveBeenCalledWith({
        where: { id: 'srv-1' },
      });

      prisma.server.findUnique.mockResolvedValue(parDefaut());
      await expect(
        service.supprimer(SERVEUR_PAR_DEFAUT_ID, admin),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('créer : refusé au-delà de MAX_SERVEURS_POSSEDES', async () => {
    prisma.server.count.mockResolvedValue(MAX_SERVEURS_POSSEDES);
    await expect(
      service.creer({ nom: 'Un de trop' }, u('bob')),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.server.create).not.toHaveBeenCalled();
  });

  describe('serveur par défaut : jamais la liste de tous les membres', () => {
    it("ne charge que les lignes de l'appelant et de la cible", async () => {
      prisma.server.findUnique.mockResolvedValue(parDefaut());
      await service
        .changerRole(SERVEUR_PAR_DEFAUT_ID, 'bob', 'moderateur', admin)
        .catch(() => undefined);
      expect(prisma.server.findUnique.mock.calls[0][0].include.members).toEqual(
        {
          where: { userId: { in: ['root', 'bob'] } },
          orderBy: { joinedAt: 'asc' },
        },
      );
    });

    it('un autre serveur est chargé avec tous ses membres', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.rejoindre('srv-1', u('bob'));
      expect(prisma.server.findUnique.mock.calls[0][0].include.members).toEqual(
        { orderBy: { joinedAt: 'asc' } },
      );
    });
  });

  describe('compte supprimé (route interne)', () => {
    beforeEach(() => {
      prisma.server.findMany.mockResolvedValue([
        {
          id: 'possede',
          members: [{ userId: 'parti' }, { userId: 'bob' }],
          channels: [{ id: 'r1' }, { id: 'r2' }],
        },
      ]);
      prisma.serverMember.findMany.mockResolvedValue([
        { serverId: 'possede' },
        { serverId: 'srv-1' },
        { serverId: SERVEUR_PAR_DEFAUT_ID },
      ]);
      prisma.serverInvitation.findMany.mockResolvedValue([
        { serverId: 'srv-2' },
      ]);
    });

    it('supprime ses serveurs, ses adhésions et ses invitations', async () => {
      await expect(service.supprimerUtilisateur('parti')).resolves.toEqual({
        serveursSupprimes: 1,
        serveursQuittes: 2,
        invitationsSupprimees: 1,
      });
      expect(prisma.server.deleteMany).toHaveBeenCalledWith({
        where: { ownerId: 'parti' },
      });
      expect(prisma.serverMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'parti' },
      });
      expect(prisma.serverInvitation.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'parti' },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('prévient les membres, sauf pour le serveur par défaut, et purge les messages', async () => {
      await service.supprimerUtilisateur('parti');
      expect(evenements.notifier.mock.calls).toEqual([
        ['possede', 'supprime', { destinataires: ['parti', 'bob'] }],
        ['srv-1', 'membres', { cibleId: 'parti' }],
        ['srv-2', 'membres', { cibleId: 'parti' }],
      ]);
      expect(evenements.salonsSupprimes).toHaveBeenCalledWith(['r1', 'r2']);
    });
  });

  describe('appartenance', () => {
    it('rejoindre un serveur dont on est déjà membre ne change rien', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.rejoindre('srv-1', u('bob'));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejoindre un serveur privé sans invitation : 404', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(service.rejoindre('srv-1', u('inconnu'))).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([
      ['public', { isPublic: true }, 'inconnu'],
      ['privé sur invitation', {}, 'invite'],
    ])('rejoindre un serveur %s', async (_cas, overrides, qui) => {
      prisma.server.findUnique
        .mockResolvedValueOnce(makeServeur(overrides))
        .mockResolvedValueOnce(
          makeServeur({
            ...overrides,
            members: [membre('owner'), membre(qui)],
          }),
        );
      prisma.serverMember.createMany.mockResolvedValue({ count: 1 });
      await service.rejoindre('srv-1', u(qui));
      expect(prisma.serverMember.createMany).toHaveBeenCalledWith({
        data: [{ serverId: 'srv-1', userId: qui }],
        skipDuplicates: true,
      });
      expect(prisma.serverInvitation.deleteMany).toHaveBeenCalledWith({
        where: { serverId: 'srv-1', userId: qui },
      });
    });

    it('rejoindre deux fois en même temps : pas d’erreur, une seule notification', async () => {
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ isPublic: true }),
      );
      prisma.serverMember.createMany.mockResolvedValue({ count: 0 });

      await expect(
        service.rejoindre('srv-1', u('neuf')),
      ).resolves.toBeDefined();
      expect(evenements.notifier).not.toHaveBeenCalled();
    });

    it('quitter : interdit pour le serveur par défaut et le propriétaire', async () => {
      prisma.server.findUnique.mockResolvedValue(parDefaut());
      await expect(
        service.quitter(SERVEUR_PAR_DEFAUT_ID, u('bob')),
      ).rejects.toThrow(BadRequestException);

      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(service.quitter('srv-1', u('owner'))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('quitter sans être membre : 409 ; sinon supprime le membre', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(service.quitter('srv-1', u('inconnu'))).rejects.toThrow(
        ConflictException,
      );
      await service.quitter('srv-1', u('bob'));
      expect(prisma.serverMember.delete).toHaveBeenCalledWith({
        where: { serverId_userId: { serverId: 'srv-1', userId: 'bob' } },
      });
    });

    it('expulser : interdit dans le serveur par défaut', async () => {
      prisma.server.findUnique.mockResolvedValue(parDefaut());
      await expect(
        service.expulser(SERVEUR_PAR_DEFAUT_ID, 'bob', admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('expulser un non-membre : 404', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(
        service.expulser('srv-1', 'inconnu', u('owner')),
      ).rejects.toThrow(NotFoundException);
    });

    it('un modérateur ne peut pas expulser le propriétaire ni un autre modérateur', async () => {
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({
          members: [
            membre('owner'),
            membre('modo', 'moderateur'),
            membre('modo2', 'moderateur'),
          ],
        }),
      );
      await expect(
        service.expulser('srv-1', 'owner', u('modo')),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.expulser('srv-1', 'modo2', u('modo')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('un admin expulse le propriétaire en transférant la propriété', async () => {
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ members: [membre('owner'), membre('bob')] }),
      );
      await service.expulser('srv-1', 'owner', admin, 'bob');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.server.update).toHaveBeenCalledWith({
        where: { id: 'srv-1' },
        data: { ownerId: 'bob' },
      });
      expect(prisma.serverMember.delete).toHaveBeenCalledWith({
        where: { serverId_userId: { serverId: 'srv-1', userId: 'owner' } },
      });
      expect(evenements.notifier).toHaveBeenCalledWith(
        'srv-1',
        'expulse',
        expect.objectContaining({ cibleId: 'owner' }),
      );
    });

    it('expulser le propriétaire exige un autre membre comme successeur', async () => {
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ members: [membre('owner'), membre('bob')] }),
      );
      await expect(service.expulser('srv-1', 'owner', admin)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.expulser('srv-1', 'owner', admin, 'owner'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.expulser('srv-1', 'owner', admin, 'inconnu'),
      ).rejects.toThrow(NotFoundException);
      prisma.server.count.mockResolvedValueOnce(MAX_SERVEURS_POSSEDES);
      await expect(
        service.expulser('srv-1', 'owner', admin, 'bob'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.server.update).not.toHaveBeenCalled();
      expect(prisma.serverMember.delete).not.toHaveBeenCalled();
    });

    it('un modérateur expulse un membre', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.expulser('srv-1', 'bob', u('modo'));
      expect(prisma.serverMember.delete).toHaveBeenCalledWith({
        where: { serverId_userId: { serverId: 'srv-1', userId: 'bob' } },
      });
    });

    it('changerRole : propriétaire seulement, cible membre, pas le propriétaire', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(
        service.changerRole('srv-1', 'bob', 'moderateur', u('modo')),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.changerRole('srv-1', 'inconnu', 'moderateur', u('owner')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.changerRole('srv-1', 'owner', 'membre', admin),
      ).rejects.toThrow(BadRequestException);

      await service.changerRole('srv-1', 'bob', 'moderateur', u('owner'));
      expect(prisma.serverMember.update).toHaveBeenCalledWith({
        where: { serverId_userId: { serverId: 'srv-1', userId: 'bob' } },
        data: { role: 'moderateur' },
      });
    });
  });

  describe('invitations', () => {
    it('inviter : interdit dans le serveur par défaut', async () => {
      prisma.server.findUnique.mockResolvedValue(parDefaut());
      await expect(
        service.inviter(SERVEUR_PAR_DEFAUT_ID, 'x', u('bob')),
      ).rejects.toThrow(BadRequestException);
    });

    it('inviter : il faut être membre (aperçu public insuffisant)', async () => {
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ isPublic: true }),
      );
      await expect(service.inviter('srv-1', 'x', u('inconnu'))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('inviter un membre existant : 409', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(
        service.inviter('srv-1', 'owner', u('modo')),
      ).rejects.toThrow(ConflictException);
    });

    it('inviter est idempotent', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.inviter('srv-1', 'invite', u('modo'));
      expect(prisma.serverInvitation.create).not.toHaveBeenCalled();
    });

    it('inviter : refusé au-delà de MAX_INVITATIONS_EN_ATTENTE, sauf une invitation déjà faite', async () => {
      const invitations = Array.from(
        { length: MAX_INVITATIONS_EN_ATTENTE },
        (_, i) => ({
          serverId: 'srv-1',
          userId: `invite-${i}`,
          invitedBy: 'modo',
          invitedAt: date,
        }),
      );
      prisma.server.findUnique.mockResolvedValue(makeServeur({ invitations }));
      await expect(
        service.inviter('srv-1', 'nouveau', u('modo')),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.serverInvitation.create).not.toHaveBeenCalled();
      expect(evenements.notifier).not.toHaveBeenCalled();
      await service.inviter('srv-1', 'invite-0', u('modo'));
      expect(prisma.serverInvitation.create).not.toHaveBeenCalled();
    });

    it('inviter : acceptée juste sous la limite (MAX_INVITATIONS_EN_ATTENTE - 1)', async () => {
      const invitations = Array.from(
        { length: MAX_INVITATIONS_EN_ATTENTE - 1 },
        (_, i) => ({
          serverId: 'srv-1',
          userId: `invite-${i}`,
          invitedBy: 'modo',
          invitedAt: date,
        }),
      );
      prisma.server.findUnique.mockResolvedValue(makeServeur({ invitations }));
      await service.inviter('srv-1', 'nouveau', u('modo'));
      expect(prisma.serverInvitation.create).toHaveBeenCalledWith({
        data: { serverId: 'srv-1', userId: 'nouveau', invitedBy: 'modo' },
      });
      expect(evenements.notifier).toHaveBeenCalledWith(
        'srv-1',
        'invitation',
        expect.objectContaining({ cibleId: 'nouveau' }),
      );
    });

    it('un simple membre ne peut pas inviter', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(
        service.inviter('srv-1', 'nouveau', u('bob')),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.serverInvitation.create).not.toHaveBeenCalled();
    });

    it.each(['modo', 'owner'])('%s peut inviter', async (qui) => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.inviter('srv-1', 'nouveau', u(qui));
      expect(prisma.serverInvitation.create).toHaveBeenCalledWith({
        data: { serverId: 'srv-1', userId: 'nouveau', invitedBy: qui },
      });
    });

    it('mesInvitations', async () => {
      prisma.serverInvitation.findMany.mockResolvedValue([
        {
          serverId: 'srv-1',
          userId: 'invite',
          invitedBy: 'bob',
          invitedAt: date,
          server: { ...makeServeur(), _count: { members: 3 } },
        },
      ]);
      await expect(service.mesInvitations(u('invite'))).resolves.toEqual([
        {
          serveur: {
            type: 'serveur',
            id: 'srv-1',
            nom: 'Projet',
            icone: null,
            public: false,
            nombreMembres: 3,
          },
          invitePar: 'bob',
          inviteLe: date.toISOString(),
        },
      ]);
    });

    it('accepter / refuser sans invitation : 404', async () => {
      prisma.serverInvitation.findUnique.mockResolvedValue(null);
      await expect(service.accepterInvitation('srv-1', u('x'))).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.refuserInvitation('srv-1', u('x'))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('accepter : devient membre et supprime l’invitation', async () => {
      prisma.serverInvitation.findUnique.mockResolvedValue({
        userId: 'invite',
      });
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ members: [membre('owner'), membre('invite')] }),
      );
      prisma.serverInvitation.deleteMany.mockResolvedValue({ count: 1 });
      const serveur = await service.accepterInvitation('srv-1', u('invite'));
      expect(prisma.serverInvitation.deleteMany).toHaveBeenCalledWith({
        where: { serverId: 'srv-1', userId: 'invite' },
      });
      expect(prisma.serverMember.upsert).toHaveBeenCalled();
      expect(serveur.monRole).toBe('membre');
    });

    it('refuser : supprime l’invitation', async () => {
      prisma.serverInvitation.findUnique.mockResolvedValue({
        userId: 'invite',
      });
      prisma.serverInvitation.deleteMany.mockResolvedValue({ count: 1 });
      await service.refuserInvitation('srv-1', u('invite'));
      expect(prisma.serverInvitation.deleteMany).toHaveBeenCalledWith({
        where: { serverId: 'srv-1', userId: 'invite' },
      });
    });

    it('accepter / refuser en double (double clic) : ni erreur ni second événement', async () => {
      prisma.serverInvitation.findUnique.mockResolvedValue({
        userId: 'invite',
      });
      prisma.serverInvitation.deleteMany.mockResolvedValue({ count: 0 });
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ members: [membre('owner'), membre('invite')] }),
      );
      const serveur = await service.accepterInvitation('srv-1', u('invite'));
      await service.refuserInvitation('srv-1', u('invite'));
      expect(serveur.monRole).toBe('membre');
      expect(evenements.notifier).not.toHaveBeenCalled();
    });
  });

  describe('listerMembres', () => {
    const serveurPour = (
      appelant: string,
      overrides: Record<string, unknown> = {},
    ) => {
      const complet = makeServeur(overrides);
      return {
        ...complet,
        members: complet.members.filter((m) => m.userId === appelant),
      };
    };

    it('première page : propriétaire en tête, puis le reste par rôle', async () => {
      prisma.server.findUnique.mockResolvedValue(serveurPour('bob'));
      prisma.serverMember.findUnique.mockResolvedValue(membre('owner'));
      prisma.serverMember.count.mockResolvedValue(2);
      prisma.serverMember.findMany.mockResolvedValue([
        membre('modo', 'moderateur'),
      ]);

      const page = await service.listerMembres('srv-1', u('bob'), {
        limite: 2,
      });

      expect(page).toEqual({
        membres: [
          { utilisateurId: 'owner', role: 'proprietaire' },
          { utilisateurId: 'modo', role: 'moderateur' },
        ],
        total: 3,
        suivant: 2,
      });
      expect(prisma.serverMember.findMany).toHaveBeenCalledWith({
        where: { serverId: 'srv-1', userId: { not: 'owner' } },
        orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }, { userId: 'asc' }],
        skip: 0,
        take: 1,
      });
    });

    it('refuse le travail SQL de pagination au-delà du total réel', async () => {
      prisma.server.findUnique.mockResolvedValue(serveurPour('bob'));
      prisma.serverMember.findUnique.mockResolvedValue(membre('owner'));
      prisma.serverMember.count.mockResolvedValue(2);
      await expect(
        service.listerMembres('srv-1', u('bob'), { decalage: 999999999 }),
      ).resolves.toEqual({ membres: [], total: 3, suivant: null });
      expect(prisma.serverMember.findMany).not.toHaveBeenCalled();
    });

    it('page suivante : décalée du propriétaire, dernière page', async () => {
      prisma.server.findUnique.mockResolvedValue(serveurPour('bob'));
      prisma.serverMember.findUnique.mockResolvedValue(membre('owner'));
      prisma.serverMember.count.mockResolvedValue(2);
      prisma.serverMember.findMany.mockResolvedValue([membre('bob')]);

      const page = await service.listerMembres('srv-1', u('bob'), {
        decalage: 2,
        limite: 2,
      });

      expect(page).toEqual({
        membres: [{ utilisateurId: 'bob', role: 'membre' }],
        total: 3,
        suivant: null,
      });
      expect(prisma.serverMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 1, take: 2 }),
      );
    });

    it('sans propriétaire (Chatvardage) : valeurs par défaut', async () => {
      prisma.server.findUnique.mockResolvedValue({
        ...parDefaut(),
        members: [],
      });
      prisma.serverMember.count.mockResolvedValue(1);
      prisma.serverMember.findMany.mockResolvedValue([membre('bob')]);

      const page = await service.listerMembres(
        SERVEUR_PAR_DEFAUT_ID,
        u('neuf'),
      );

      expect(page).toEqual({
        membres: [{ utilisateurId: 'bob', role: 'membre' }],
        total: 1,
        suivant: null,
      });
      expect(prisma.serverMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.serverMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { serverId: SERVEUR_PAR_DEFAUT_ID, userId: { not: '' } },
          skip: 0,
          take: 50,
        }),
      );
    });

    it('propriétaire absent des membres : pas de tête de liste', async () => {
      prisma.server.findUnique.mockResolvedValue(serveurPour('bob'));
      prisma.serverMember.findUnique.mockResolvedValue(null);
      prisma.serverMember.count.mockResolvedValue(0);
      prisma.serverMember.findMany.mockResolvedValue([]);
      await expect(
        service.listerMembres('srv-1', u('bob'), { decalage: 0 }),
      ).resolves.toEqual({ membres: [], total: 0, suivant: null });
    });

    it('avec ids : seulement ces utilisateurs, sans pagination', async () => {
      prisma.server.findUnique.mockResolvedValue(serveurPour('bob'));
      prisma.serverMember.findMany.mockResolvedValue([
        membre('owner'),
        membre('bob'),
      ]);

      const page = await service.listerMembres('srv-1', u('bob'), {
        ids: ['owner', 'bob', 'absent'],
      });

      expect(page).toEqual({
        membres: [
          { utilisateurId: 'owner', role: 'proprietaire' },
          { utilisateurId: 'bob', role: 'membre' },
        ],
        total: 2,
        suivant: null,
      });
      expect(prisma.serverMember.findMany).toHaveBeenCalledWith({
        where: {
          serverId: 'srv-1',
          userId: { in: ['owner', 'bob', 'absent'] },
        },
        orderBy: { joinedAt: 'asc' },
      });
    });

    it('non-membre : 403 si public, 404 si privé ou inexistant', async () => {
      prisma.server.findUnique.mockResolvedValue(
        serveurPour('inconnu', { isPublic: true }),
      );
      await expect(
        service.listerMembres('srv-1', u('inconnu')),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prisma.server.findUnique.mockResolvedValue(serveurPour('inconnu'));
      await expect(
        service.listerMembres('srv-1', u('inconnu')),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.server.findUnique.mockResolvedValue(null);
      await expect(
        service.listerMembres('absent', u('bob')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('contexteVisible : 404 si inexistant, ou privé et non-membre', async () => {
      prisma.server.findUnique.mockResolvedValue(null);
      await expect(
        service.contexteVisible('absent', u('bob')),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await expect(
        service.contexteVisible('srv-1', u('inconnu')),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.contexteVisible('srv-1', u('bob')),
      ).resolves.toMatchObject({ role: 'membre' });
    });

    it('obtenir : 404 pour un serveur inexistant', async () => {
      prisma.server.findUnique.mockResolvedValue(null);
      await expect(service.obtenir('absent', u('bob'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('temps réel (notifications aux membres)', () => {
    const membresAvant = ['owner', 'modo', 'bob'];

    it('modifier : tous les membres', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      prisma.server.update.mockResolvedValue(makeServeur());
      await service.modifier('srv-1', { nom: 'x' }, u('owner'));
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'modifie', {
        destinataires: membresAvant,
      });
    });

    it('supprimer : les membres d’avant la suppression', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.supprimer('srv-1', u('owner'));
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'supprime', {
        destinataires: membresAvant,
      });
      expect(evenements.salonsSupprimes).toHaveBeenCalledWith([
        'salon-1',
        'salon-modos',
      ]);
    });

    it('expulser : l’expulsé est prévenu avec les autres', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.expulser('srv-1', 'bob', u('modo'));
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'expulse', {
        destinataires: membresAvant,
        cibleId: 'bob',
      });
    });

    it('inviter : l’invité s’ajoute aux destinataires (pas si déjà invité)', async () => {
      prisma.server.findUnique.mockResolvedValue(makeServeur());
      await service.inviter('srv-1', 'nouveau', u('modo'));
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'invitation', {
        destinataires: membresAvant,
        extras: ['nouveau'],
        cibleId: 'nouveau',
      });
      evenements.notifier.mockClear();
      await service.inviter('srv-1', 'invite', u('modo'));
      expect(evenements.notifier).not.toHaveBeenCalled();
    });

    it.each([
      ['quitter', (s: ServersService) => s.quitter('srv-1', u('bob')), 'bob'],
      [
        'changerRole',
        (s: ServersService) =>
          s.changerRole('srv-1', 'bob', 'moderateur', u('owner')),
        'bob',
      ],
    ])(
      '%s : membres, avec la personne concernée',
      async (_nom, action, cible) => {
        prisma.server.findUnique.mockResolvedValue(makeServeur());
        await action(service);
        expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'membres', {
          destinataires: membresAvant,
          cibleId: cible,
        });
      },
    );

    it('rejoindre : membres d’avant + le nouveau (cible)', async () => {
      prisma.server.findUnique
        .mockResolvedValueOnce(makeServeur({ isPublic: true }))
        .mockResolvedValueOnce(
          makeServeur({
            isPublic: true,
            members: [membre('owner'), membre('neuf')],
          }),
        );
      prisma.serverMember.createMany.mockResolvedValue({ count: 1 });
      await service.rejoindre('srv-1', u('neuf'));
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'membres', {
        destinataires: membresAvant,
        cibleId: 'neuf',
      });
    });

    it('accepter / refuser une invitation : membres actuels (chargés par le notificateur)', async () => {
      prisma.serverInvitation.findUnique.mockResolvedValue({
        userId: 'invite',
      });
      prisma.server.findUnique.mockResolvedValue(
        makeServeur({ members: [membre('owner'), membre('invite')] }),
      );
      prisma.serverInvitation.deleteMany.mockResolvedValue({ count: 1 });
      await service.accepterInvitation('srv-1', u('invite'));
      await service.refuserInvitation('srv-1', u('invite'));
      expect(evenements.notifier.mock.calls).toEqual([
        ['srv-1', 'membres', { cibleId: 'invite' }],
        ['srv-1', 'membres', { cibleId: 'invite' }],
      ]);
    });
  });
});
