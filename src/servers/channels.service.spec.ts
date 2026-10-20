import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService, MAX_SALONS_PAR_SERVEUR } from './channels.service';
import { ServersService } from './servers.service';

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

const serveur = (overrides: Record<string, unknown> = {}) => ({
  id: 'srv-1',
  name: 'Projet',
  icon: null,
  ownerId: 'owner',
  isPublic: false,
  isDefault: false,
  createdAt: date,
  updatedAt: date,
  members: [membre('owner'), membre('modo', 'moderateur'), membre('bob')],
  invitations: [],
  channels: [salon()],
  ...overrides,
});

const salonAvec = (
  qui: ReturnType<typeof membre> | null,
  overrides: Record<string, unknown> = {},
  serveurOverrides: Record<string, unknown> = {},
) =>
  salon({
    ...overrides,
    server: serveur({ members: qui ? [qui] : [], ...serveurOverrides }),
  });

const u = (id: string) => ({ id, role: 'utilisateur' as const });

describe('ChannelsService', () => {
  let service: ChannelsService;
  let prisma: any;
  let evenements: { notifier: jest.Mock; salonsSupprimes: jest.Mock };

  beforeEach(() => {
    prisma = {
      server: { findUnique: jest.fn(), findMany: jest.fn() },
      room: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    evenements = { notifier: jest.fn(), salonsSupprimes: jest.fn() };
    service = new ChannelsService(
      prisma as PrismaService,
      new ServersService(prisma as PrismaService, evenements as any),
      evenements as any,
    );
  });

  describe('creer', () => {
    it('refusé au-delà de MAX_SALONS_PAR_SERVEUR', async () => {
      prisma.server.findUnique.mockResolvedValue(
        serveur({
          channels: Array.from({ length: MAX_SALONS_PAR_SERVEUR }, (_, i) =>
            salon({ id: `s${i}`, position: i }),
          ),
        }),
      );
      await expect(
        service.creer('srv-1', { nom: 'x' }, u('owner')),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it('un membre ne peut pas créer de salon', async () => {
      prisma.server.findUnique.mockResolvedValue(serveur());
      await expect(
        service.creer('srv-1', { nom: 'x' }, u('bob')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('un modérateur crée un salon en fin de liste, accès et écriture par défaut', async () => {
      prisma.server.findUnique.mockResolvedValue(
        serveur({ channels: [salon(), salon({ id: 's2', position: 4 })] }),
      );
      prisma.room.create.mockResolvedValue(
        salon({ id: 'nouveau', position: 5 }),
      );

      const cree = await service.creer('srv-1', { nom: 'jeux' }, u('modo'));

      expect(prisma.room.create).toHaveBeenCalledWith({
        data: {
          serverId: 'srv-1',
          name: 'jeux',
          position: 5,
          access: 'tous',
          writePolicy: 'tous',
          createdBy: 'modo',
        },
      });
      expect(cree.id).toBe('nouveau');
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'salons', {
        destinataires: ['owner', 'modo', 'bob'],
      });
    });

    it('salon réservé aux modérateurs, en position 0 si aucun salon', async () => {
      prisma.server.findUnique.mockResolvedValue(serveur({ channels: [] }));
      prisma.room.create.mockResolvedValue(salon({ access: 'moderateurs' }));
      await service.creer(
        'srv-1',
        { nom: 'modos', acces: 'moderateurs', ecriture: 'moderateurs' },
        u('owner'),
      );
      expect(prisma.room.create.mock.calls[0][0].data).toMatchObject({
        position: 0,
        access: 'moderateurs',
        writePolicy: 'moderateurs',
      });
    });
  });

  describe('modifier / supprimer', () => {
    it('salon inexistant : 404', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(
        service.modifier('x', { nom: 'y' }, u('owner')),
      ).rejects.toThrow(NotFoundException);
    });

    it('salon des modérateurs invisible pour un membre : 404', async () => {
      prisma.room.findUnique.mockResolvedValue(
        salonAvec(membre('bob'), { access: 'moderateurs' }),
      );
      await expect(
        service.modifier('salon-1', { nom: 'y' }, u('bob')),
      ).rejects.toThrow(NotFoundException);
    });

    it('un membre ne modifie pas un salon visible : 403', async () => {
      prisma.room.findUnique.mockResolvedValue(salonAvec(membre('bob')));
      await expect(
        service.modifier('salon-1', { nom: 'y' }, u('bob')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('modifier sans champ : 400', async () => {
      prisma.room.findUnique.mockResolvedValue(
        salonAvec(membre('modo', 'moderateur')),
      );
      await expect(service.modifier('salon-1', {}, u('modo'))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('modifier tous les champs', async () => {
      prisma.room.findUnique.mockResolvedValue(
        salonAvec(membre('modo', 'moderateur')),
      );
      prisma.room.update.mockResolvedValue(salon({ name: 'annonces' }));
      await service.modifier(
        'salon-1',
        {
          nom: 'annonces',
          acces: 'tous',
          ecriture: 'moderateurs',
          position: 2,
        },
        u('modo'),
      );
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        data: {
          name: 'annonces',
          access: 'tous',
          writePolicy: 'moderateurs',
          position: 2,
        },
      });
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'salons');
    });

    it('modifier un seul champ', async () => {
      prisma.room.findUnique.mockResolvedValue(salonAvec(null));
      prisma.room.update.mockResolvedValue(salon());
      await service.modifier('salon-1', { position: 1 }, u('owner'));
      expect(prisma.room.update.mock.calls[0][0].data).toEqual({ position: 1 });
    });

    it('renommer seulement', async () => {
      prisma.room.findUnique.mockResolvedValue(salonAvec(null));
      prisma.room.update.mockResolvedValue(salon());
      await service.modifier('salon-1', { nom: 'jeux' }, u('owner'));
      expect(prisma.room.update.mock.calls[0][0].data).toEqual({
        name: 'jeux',
      });
    });

    it('un serveur garde au moins un salon', async () => {
      prisma.room.findUnique.mockResolvedValue(salonAvec(null));
      prisma.room.count.mockResolvedValue(1);
      await expect(service.supprimer('salon-1', u('owner'))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('supprimer un salon', async () => {
      prisma.room.findUnique.mockResolvedValue(salonAvec(null));
      prisma.room.count.mockResolvedValue(2);
      await service.supprimer('salon-1', u('owner'));
      expect(prisma.room.count).toHaveBeenCalledWith({
        where: { serverId: 'srv-1' },
      });
      expect(prisma.room.delete).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
      });
      expect(evenements.notifier).toHaveBeenCalledWith('srv-1', 'salons');
      expect(evenements.salonsSupprimes).toHaveBeenCalledWith(['salon-1']);
    });
  });

  describe('acces (route interne)', () => {
    it('salon inexistant : 404', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      await expect(service.acces('x', 'bob', 'utilisateur')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('membre : lecture et écriture dans un salon ouvert', async () => {
      prisma.room.findUnique.mockResolvedValue(salonAvec(membre('bob')));
      await expect(
        service.acces('salon-1', 'bob', 'utilisateur'),
      ).resolves.toEqual({
        salonId: 'salon-1',
        serveurId: 'srv-1',
        estMembre: true,
        peutLire: true,
        peutEcrire: true,
        peutModerer: false,
      });
      expect(prisma.room.findUnique).toHaveBeenCalledWith({
        where: { id: 'salon-1' },
        include: {
          server: { include: { members: { where: { userId: 'bob' } } } },
        },
      });
    });

    it('#annonces du serveur par défaut : lecture seule, sauf pour un admin', async () => {
      const annonces = salonAvec(
        null,
        { writePolicy: 'moderateurs' },
        { ownerId: null, isDefault: true, isPublic: true },
      );
      prisma.room.findUnique.mockResolvedValue(annonces);
      await expect(
        service.acces('salon-1', 'bob', 'utilisateur'),
      ).resolves.toMatchObject({
        estMembre: true,
        peutLire: true,
        peutEcrire: false,
      });
      await expect(
        service.acces('salon-1', 'root', 'admin'),
      ).resolves.toMatchObject({
        peutEcrire: true,
      });
    });

    it('modérateur, propriétaire ou admin : peut modérer les messages', async () => {
      prisma.room.findUnique.mockResolvedValue(
        salonAvec(membre('modo', 'moderateur')),
      );
      await expect(
        service.acces('salon-1', 'modo', 'utilisateur'),
      ).resolves.toMatchObject({ peutModerer: true });
      prisma.room.findUnique.mockResolvedValue(salonAvec(null));
      await expect(
        service.acces('salon-1', 'owner', 'utilisateur'),
      ).resolves.toMatchObject({ peutModerer: true });
      await expect(
        service.acces('salon-1', 'root', 'admin'),
      ).resolves.toMatchObject({ peutModerer: true });
    });

    it('non-membre d’un serveur privé : aucun accès', async () => {
      prisma.room.findUnique.mockResolvedValue(salonAvec(null));
      await expect(
        service.acces('salon-1', 'inconnu', 'utilisateur'),
      ).resolves.toMatchObject({
        estMembre: false,
        peutLire: false,
        peutEcrire: false,
        peutModerer: false,
      });
    });
  });

  describe('salonsLisibles (route interne)', () => {
    const arrivee = new Date('2026-03-04T05:06:07.000Z');
    const srv = (
      id: string,
      membres: { role: 'membre' | 'moderateur'; joinedAt: Date }[],
      salons: { id: string; access: 'tous' | 'moderateurs' }[],
      overrides: Record<string, unknown> = {},
    ) => ({
      id,
      ownerId: 'owner',
      isDefault: false,
      members: membres,
      channels: salons,
      ...overrides,
    });

    it('filtre les salons selon le rôle et donne la date d’arrivée', async () => {
      prisma.server.findMany.mockResolvedValue([
        srv(
          'srv-membre',
          [{ role: 'membre', joinedAt: arrivee }],
          [
            { id: 'ouvert', access: 'tous' },
            { id: 'modos', access: 'moderateurs' },
          ],
        ),
        srv(
          'srv-modo',
          [{ role: 'moderateur', joinedAt: arrivee }],
          [{ id: 'reserve', access: 'moderateurs' }],
        ),
        srv('defaut', [], [{ id: 'general', access: 'tous' }], {
          ownerId: null,
          isDefault: true,
        }),
      ]);

      await expect(
        service.salonsLisibles('bob', 'utilisateur'),
      ).resolves.toEqual([
        {
          salonId: 'ouvert',
          serveurId: 'srv-membre',
          depuis: arrivee.toISOString(),
        },
        {
          salonId: 'reserve',
          serveurId: 'srv-modo',
          depuis: arrivee.toISOString(),
        },
        { salonId: 'general', serveurId: 'defaut', depuis: null },
      ]);
      expect(prisma.server.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { members: { some: { userId: 'bob' } } },
            { ownerId: 'bob' },
            { isDefault: true },
          ],
        },
        select: {
          id: true,
          ownerId: true,
          isDefault: true,
          members: {
            where: { userId: 'bob' },
            select: { role: true, joinedAt: true },
          },
          channels: {
            select: { id: true, access: true },
            orderBy: { position: 'asc' },
          },
        },
      });
    });

    it('admin global : tous les serveurs, tous les salons', async () => {
      prisma.server.findMany.mockResolvedValue([
        srv('prive', [], [{ id: 'modos', access: 'moderateurs' }]),
      ]);
      await expect(service.salonsLisibles('root', 'admin')).resolves.toEqual([
        { salonId: 'modos', serveurId: 'prive', depuis: null },
      ]);
      expect(prisma.server.findMany.mock.calls[0][0].where).toEqual({});
    });
  });
});
