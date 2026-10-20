import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { requireUser } from '../auth/request-user';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/channel.dto';
import { CreateServerDto, UpdateServerDto } from './dto/create-server.dto';
import {
  DiscoverServersQueryDto,
  KickMemberQueryDto,
  InviteMemberDto,
  ListMembersQueryDto,
  UpdateMemberRoleDto,
} from './dto/member.dto';
import { ServersService } from './servers.service';

@ApiTags('Servers')
@ApiBearerAuth()
@Controller('servers')
export class ServersController {
  constructor(
    private readonly servers: ServersService,
    private readonly channels: ChannelsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Serveurs de l'utilisateur (l'ajoute au serveur par défaut)",
  })
  lister(@Req() request: AuthenticatedRequest) {
    return this.servers.listerMesServeurs(requireUser(request));
  }

  @Get('decouvrir')
  @ApiOperation({
    summary: "Serveurs publics dont l'utilisateur n'est pas membre",
  })
  decouvrir(
    @Query() query: DiscoverServersQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.servers.decouvrir(requireUser(request), query.q, {
      decalage: query.decalage,
      limite: query.limite,
    });
  }

  @Get('invitations/me')
  @ApiOperation({ summary: "Invitations reçues par l'utilisateur" })
  mesInvitations(@Req() request: AuthenticatedRequest) {
    return this.servers.mesInvitations(requireUser(request));
  }

  @Post()
  @ApiOperation({
    summary: 'Crée un serveur (avec un salon #général)',
    description: "Ouvert à tous ; l'appelant en devient propriétaire.",
  })
  creer(@Body() dto: CreateServerDto, @Req() request: AuthenticatedRequest) {
    return this.servers.creer(dto, requireUser(request));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Un serveur (aperçu seulement si public et non-membre)',
  })
  obtenir(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.servers.obtenir(id, requireUser(request));
  }

  @Get(':id/members')
  @ApiOperation({
    summary: 'Membres du serveur, par pages (réservé aux membres)',
    description:
      'Propriétaire en tête, puis modérateurs, puis membres. Avec `ids`, ' +
      'seulement ces utilisateurs : sert à savoir lesquels sont déjà membres.',
  })
  membres(
    @Param('id') id: string,
    @Query() query: ListMembersQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.servers.listerMembres(id, requireUser(request), query);
  }

  @Patch(':id')
  @ApiOperation({
    summary: "Modifie le nom, l'icône ou la visibilité",
    description: 'Propriétaire ou administrateur.',
  })
  modifier(
    @Param('id') id: string,
    @Body() dto: UpdateServerDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.servers.modifier(id, dto, requireUser(request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprime un serveur et ses salons',
    description:
      'Propriétaire ou administrateur ; interdit pour le serveur par défaut.',
  })
  @ApiNoContentResponse({ description: 'Serveur supprimé' })
  async supprimer(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.servers.supprimer(id, requireUser(request));
  }

  @Post(':id/join')
  @ApiOperation({
    summary: 'Rejoint un serveur public, ou privé sur invitation',
  })
  rejoindre(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.servers.rejoindre(id, requireUser(request));
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Quitte un serveur',
    description: 'Interdit au propriétaire et pour le serveur par défaut.',
  })
  @ApiNoContentResponse({ description: 'Serveur quitté' })
  async quitter(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.servers.quitter(id, requireUser(request));
  }

  @Delete(':id/members/:userId')
  @ApiOperation({
    summary: 'Expulse un membre',
    description:
      'Modérateur minimum, et au-dessus du membre expulsé. Expulser le ' +
      'propriétaire (administrateur seulement) exige `nouveauProprietaire`, ' +
      'un autre membre qui reçoit la propriété du serveur.',
  })
  expulser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Query() query: KickMemberQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.servers.expulser(
      id,
      userId,
      requireUser(request),
      query.nouveauProprietaire,
    );
  }

  @Patch(':id/members/:userId')
  @ApiOperation({
    summary: 'Nomme ou retire un modérateur',
    description: 'Propriétaire ou administrateur.',
  })
  changerRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.servers.changerRole(id, userId, dto.role, requireUser(request));
  }

  @Post(':id/invitations')
  @ApiOperation({
    summary: 'Invite un utilisateur (idempotent)',
    description:
      'Modérateur du serveur minimum ; interdit pour le serveur par défaut.',
  })
  inviter(
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.servers.inviter(id, dto.utilisateurId, requireUser(request));
  }

  @Post(':id/invitations/accept')
  @ApiOperation({ summary: 'Accepte une invitation' })
  accepter(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.servers.accepterInvitation(id, requireUser(request));
  }

  @Post(':id/invitations/refuse')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Refuse une invitation' })
  @ApiNoContentResponse({ description: 'Invitation refusée' })
  async refuser(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.servers.refuserInvitation(id, requireUser(request));
  }

  @Post(':id/channels')
  @ApiOperation({
    summary: 'Crée un salon',
    description: 'Modérateur du serveur minimum.',
  })
  creerSalon(
    @Param('id') id: string,
    @Body() dto: CreateChannelDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.channels.creer(id, dto, requireUser(request));
  }
}
