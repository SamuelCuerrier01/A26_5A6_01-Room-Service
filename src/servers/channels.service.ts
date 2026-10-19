import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { EvenementsService } from './evenements.service';
import {
  Acteur,
  RoleServeur,
  peutEcrireSalon,
  peutModerer,
  peutVoirSalon,
  roleEffectif,
} from './permissions';
import { ServersService } from './servers.service';
import {
  AccesSalonResponse,
  SalonLisibleResponse,
  SalonResponse,
} from './types/server-response.type';

export const MAX_SALONS_PAR_SERVEUR = 200;

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly evenements: EvenementsService,
  ) {}

  async creer(
    serveurId: string,
    dto: CreateChannelDto,
    acteur: Acteur,
  ): Promise<SalonResponse> {
    const { serveur, role } = await this.servers.contexteVisible(
      serveurId,
      acteur,
    );
    this.servers.exiger(
      peutModerer(role),
      'Action réservée aux modérateurs du serveur',
    );

    if (serveur.channels.length >= MAX_SALONS_PAR_SERVEUR) {
      throw new BadRequestException(
        `Limite atteinte : ${MAX_SALONS_PAR_SERVEUR} salons par serveur`,
      );
    }

    const position =
      serveur.channels.reduce(
        (max, salon) => Math.max(max, salon.position),
        -1,
      ) + 1;
    const salon = await this.prisma.room.create({
      data: {
        serverId: serveurId,
        name: dto.nom,
        position,
        access: dto.acces ?? 'tous',
        writePolicy: dto.ecriture ?? 'tous',
        createdBy: acteur.id,
      },
    });
    this.evenements.notifier(serveurId, 'salons', {
      destinataires: serveur.members.map((membre) => membre.userId),
    });
    return this.servers.versSalon(salon, role);
  }

  async modifier(
    salonId: string,
    dto: UpdateChannelDto,
    acteur: Acteur,
  ): Promise<SalonResponse> {
    const { role } = await this.contexteModeration(salonId, acteur);
    if (
      dto.nom === undefined &&
      dto.acces === undefined &&
      dto.ecriture === undefined &&
      dto.position === undefined
    ) {
      throw new BadRequestException('Aucune modification fournie');
    }

    const salon = await this.prisma.room.update({
      where: { id: salonId },
      data: {
        ...(dto.nom !== undefined ? { name: dto.nom } : {}),
        ...(dto.acces !== undefined ? { access: dto.acces } : {}),
        ...(dto.ecriture !== undefined ? { writePolicy: dto.ecriture } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
      },
    });
    this.evenements.notifier(salon.serverId, 'salons');
    return this.servers.versSalon(salon, role);
  }

  async supprimer(salonId: string, acteur: Acteur): Promise<void> {
    const { salon } = await this.contexteModeration(salonId, acteur);
    const nombre = await this.prisma.room.count({
      where: { serverId: salon.serverId },
    });
    if (nombre <= 1) {
      throw new BadRequestException('Un serveur doit garder au moins un salon');
    }
    await this.prisma.room.delete({ where: { id: salonId } });
    this.evenements.notifier(salon.serverId, 'salons');
    this.evenements.salonsSupprimes([salonId]);
  }

  async acces(
    salonId: string,
    utilisateurId: string,
    roleGlobal: AuthenticatedUser['role'],
  ): Promise<AccesSalonResponse> {
    const salon = await this.chargerSalon(salonId, utilisateurId);
    const membre = salon.server.members[0];
    const role = roleEffectif(salon.server, membre, {
      id: utilisateurId,
      role: roleGlobal,
    });
    return {
      salonId: salon.id,
      serveurId: salon.serverId,
      estMembre: membre !== undefined || salon.server.isDefault,
      peutLire: peutVoirSalon(role, salon),
      peutEcrire: peutEcrireSalon(role, salon),
      peutModerer: peutModerer(role),
    };
  }

  async salonsLisibles(
    utilisateurId: string,
    roleGlobal: AuthenticatedUser['role'],
  ): Promise<SalonLisibleResponse[]> {
    const serveurs = await this.prisma.server.findMany({
      where:
        roleGlobal === 'admin'
          ? {}
          : {
              OR: [
                { members: { some: { userId: utilisateurId } } },
                { ownerId: utilisateurId },
                { isDefault: true },
              ],
            },
      select: {
        id: true,
        ownerId: true,
        isDefault: true,
        members: {
          where: { userId: utilisateurId },
          select: { role: true, joinedAt: true },
        },
        channels: {
          select: { id: true, access: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    return serveurs.flatMap((serveur) => {
      const membre = serveur.members[0];
      const role = roleEffectif(serveur, membre, {
        id: utilisateurId,
        role: roleGlobal,
      });
      return serveur.channels
        .filter((salon) => peutVoirSalon(role, salon))
        .map((salon) => ({
          salonId: salon.id,
          serveurId: serveur.id,
          depuis: membre ? membre.joinedAt.toISOString() : null,
        }));
    });
  }

  private async chargerSalon(salonId: string, utilisateurId: string) {
    const salon = await this.prisma.room.findUnique({
      where: { id: salonId },
      include: {
        server: { include: { members: { where: { userId: utilisateurId } } } },
      },
    });
    if (!salon) {
      throw new NotFoundException(`Salon ${salonId} non trouvé`);
    }
    return salon;
  }

  private async contexteModeration(salonId: string, acteur: Acteur) {
    const salon = await this.chargerSalon(salonId, acteur.id);
    const role: RoleServeur | null = roleEffectif(
      salon.server,
      salon.server.members[0],
      acteur,
    );
    if (!peutVoirSalon(role, salon)) {
      throw new NotFoundException(`Salon ${salonId} non trouvé`);
    }
    this.servers.exiger(
      peutModerer(role),
      'Action réservée aux modérateurs du serveur',
    );
    return { salon, role };
  }
}
