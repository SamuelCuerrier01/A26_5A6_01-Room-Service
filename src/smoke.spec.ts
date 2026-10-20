import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppModule } from './app.module';
import { AccesQueryDto } from './internal/internal.controller';
import { CreateChannelDto, UpdateChannelDto } from './servers/dto/channel.dto';
import {
  CreateServerDto,
  UpdateServerDto,
} from './servers/dto/create-server.dto';
import {
  DiscoverServersQueryDto,
  KickMemberQueryDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
} from './servers/dto/member.dto';
import { ServersModule } from './servers/servers.module';

const erreurs = async <T extends object>(
  classe: new () => T,
  valeurs: Record<string, unknown>,
) =>
  (await validate(plainToInstance(classe, valeurs))).map(
    (erreur) => erreur.property,
  );

describe('modules et DTO', () => {
  it('sont chargeables', () => {
    expect(AppModule).toBeDefined();
    expect(ServersModule).toBeDefined();
  });

  it('CreateServerDto : nom requis, retiré de ses espaces, 80 caractères max', async () => {
    expect(await erreurs(CreateServerDto, { nom: 'Projet' })).toEqual([]);
    expect(await erreurs(CreateServerDto, { nom: '   ' })).toEqual(['nom']);
    expect(await erreurs(CreateServerDto, { nom: 'a'.repeat(81) })).toEqual([
      'nom',
    ]);
    expect(await erreurs(CreateServerDto, { nom: 42 })).toEqual(['nom']);
    expect(await erreurs(CreateServerDto, { nom: 'x', public: 'oui' })).toEqual(
      ['public'],
    );
    expect(plainToInstance(CreateServerDto, { nom: '  Projet ' }).nom).toBe(
      'Projet',
    );
  });

  it('UpdateServerDto : icône en data URL matricielle ou vide', async () => {
    expect(await erreurs(UpdateServerDto, {})).toEqual([]);
    expect(
      await erreurs(UpdateServerDto, {
        icone: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toEqual([]);
    expect(await erreurs(UpdateServerDto, { icone: '' })).toEqual([]);
    expect(
      await erreurs(UpdateServerDto, {
        icone: 'data:image/svg+xml;base64,PHN2Zz4=',
      }),
    ).toEqual(['icone']);
    expect(await erreurs(UpdateServerDto, { nom: ' ' })).toEqual(['nom']);
  });

  it('CreateChannelDto / UpdateChannelDto : niveaux et position bornés', async () => {
    expect(
      await erreurs(CreateChannelDto, {
        nom: 'modos',
        acces: 'moderateurs',
        ecriture: 'moderateurs',
      }),
    ).toEqual([]);
    expect(
      await erreurs(CreateChannelDto, { nom: 'x', acces: 'amis' }),
    ).toEqual(['acces']);
    expect(await erreurs(UpdateChannelDto, { position: 3 })).toEqual([]);
    expect(await erreurs(UpdateChannelDto, { position: -1 })).toEqual([
      'position',
    ]);
    expect(await erreurs(UpdateChannelDto, { nom: 7 })).toEqual(['nom']);
  });

  it('DTO de membres et de recherche', async () => {
    expect(await erreurs(InviteMemberDto, { utilisateurId: 'u2' })).toEqual([]);
    expect(await erreurs(InviteMemberDto, { utilisateurId: '' })).toEqual([
      'utilisateurId',
    ]);
    expect(await erreurs(UpdateMemberRoleDto, { role: 'moderateur' })).toEqual(
      [],
    );
    expect(await erreurs(UpdateMemberRoleDto, { role: 'admin' })).toEqual([
      'role',
    ]);
    expect(plainToInstance(DiscoverServersQueryDto, { q: ' pro ' }).q).toBe(
      'pro',
    );
    expect(await erreurs(DiscoverServersQueryDto, { q: 5 })).toEqual(['q']);
    expect(
      await erreurs(DiscoverServersQueryDto, { decalage: '20', limite: '20' }),
    ).toEqual([]);
    expect(
      await erreurs(DiscoverServersQueryDto, { decalage: '-1', limite: '101' }),
    ).toEqual(['decalage', 'limite']);
    expect(await erreurs(KickMemberQueryDto, {})).toEqual([]);
    expect(
      await erreurs(KickMemberQueryDto, { nouveauProprietaire: 'bob' }),
    ).toEqual([]);
    expect(
      await erreurs(KickMemberQueryDto, { nouveauProprietaire: '' }),
    ).toEqual(['nouveauProprietaire']);
    expect(await erreurs(AccesQueryDto, { role: 'admin' })).toEqual([]);
    expect(await erreurs(AccesQueryDto, { role: 'root' })).toEqual(['role']);
  });
});
