import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PublicRoute } from '../auth/auth.guard';
import { ROLES_GLOBAUX, type RoleGlobal } from '../partage/client-auth';
import { ChannelsService } from '../servers/channels.service';
import { ServersService } from '../servers/servers.service';
import {
  EN_TETE_JETON_INTERNE,
  InternalTokenGuard,
} from './internal-token.guard';

export class AccesQueryDto {
  @ApiPropertyOptional({
    enum: ROLES_GLOBAUX,
    default: 'utilisateur',
    description:
      "Rôle global de l'utilisateur, issu du JWT validé par l'appelant.",
  })
  @IsOptional()
  @IsIn(ROLES_GLOBAUX)
  role?: RoleGlobal;
}

@ApiTags('Interne')
@ApiHeader({ name: EN_TETE_JETON_INTERNE, required: true })
@Controller('internal')
@PublicRoute()
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly servers: ServersService,
  ) {}

  @Get('channels/:id/access/:userId')
  @ApiOperation({
    summary: "Accès d'un utilisateur à un salon (pour Message-Service)",
  })
  acces(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Query() query: AccesQueryDto,
  ) {
    return this.channels.acces(id, userId, query.role ?? 'utilisateur');
  }

  @Get('users/:userId/channels')
  @ApiOperation({
    summary:
      "Salons lisibles par un utilisateur, avec sa date d'arrivée dans chaque serveur (pour Message-Service)",
  })
  async salonsLisibles(
    @Param('userId') userId: string,
    @Query() query: AccesQueryDto,
  ) {
    return {
      salons: await this.channels.salonsLisibles(
        userId,
        query.role ?? 'utilisateur',
      ),
    };
  }

  @Delete('users/:userId')
  @ApiOperation({
    summary:
      'Compte supprimé (pour Authentification) : ses serveurs, adhésions et invitations',
  })
  supprimerUtilisateur(@Param('userId') userId: string) {
    return this.servers.supprimerUtilisateur(userId);
  }
}
