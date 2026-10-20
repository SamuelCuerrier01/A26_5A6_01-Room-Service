import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ChannelsService } from '../servers/channels.service';
import type { ServersService } from '../servers/servers.service';
import { InternalController } from './internal.controller';
import { InternalTokenGuard } from './internal-token.guard';

const contexte = (enTete?: string | string[]) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: enTete === undefined ? {} : { 'x-internal-token': enTete },
      }),
    }),
  }) as unknown as ExecutionContext;

describe('route interne', () => {
  const ancien = process.env.INTERNAL_SERVICE_TOKEN;
  afterEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = ancien;
  });

  it('échoue fermé si INTERNAL_SERVICE_TOKEN n’est pas configuré', () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    expect(() => new InternalTokenGuard().canActivate(contexte('x'))).toThrow(
      ServiceUnavailableException,
    );
    process.env.INTERNAL_SERVICE_TOKEN = '   ';
    expect(() => new InternalTokenGuard().canActivate(contexte('x'))).toThrow(
      ServiceUnavailableException,
    );
  });

  it.each([
    ['absent', undefined],
    ['de mauvaise longueur', 'court'],
    ['faux, même longueur', 'secret-faux-1234'],
    ['en tableau', ['secret-interne-12']],
  ])('refuse un jeton %s', (_cas, enTete) => {
    process.env.INTERNAL_SERVICE_TOKEN = 'secret-interne-12';
    expect(() =>
      new InternalTokenGuard().canActivate(contexte(enTete)),
    ).toThrow(UnauthorizedException);
  });

  it('accepte le bon jeton', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'secret-interne-12';
    expect(
      new InternalTokenGuard().canActivate(contexte('secret-interne-12')),
    ).toBe(true);
  });

  it('InternalController transmet le rôle global (utilisateur par défaut)', async () => {
    const channels = { acces: jest.fn().mockResolvedValue('ok') };
    const c = new InternalController(
      channels as unknown as ChannelsService,
      {} as ServersService,
    );
    await c.acces('salon', 'bob', {});
    expect(channels.acces).toHaveBeenCalledWith('salon', 'bob', 'utilisateur');
    await c.acces('salon', 'root', { role: 'admin' });
    expect(channels.acces).toHaveBeenCalledWith('salon', 'root', 'admin');
  });

  it('InternalController liste les salons lisibles (utilisateur par défaut)', async () => {
    const channels = {
      salonsLisibles: jest.fn().mockResolvedValue([{ salonId: 's' }]),
    };
    const c = new InternalController(
      channels as unknown as ChannelsService,
      {} as ServersService,
    );
    await expect(c.salonsLisibles('bob', {})).resolves.toEqual({
      salons: [{ salonId: 's' }],
    });
    expect(channels.salonsLisibles).toHaveBeenCalledWith('bob', 'utilisateur');
    await c.salonsLisibles('root', { role: 'admin' });
    expect(channels.salonsLisibles).toHaveBeenCalledWith('root', 'admin');
  });

  it('InternalController délègue la suppression d’un compte', async () => {
    const servers = {
      supprimerUtilisateur: jest.fn().mockResolvedValue({ ok: 1 }),
    };
    const c = new InternalController(
      {} as ChannelsService,
      servers as unknown as ServersService,
    );
    await expect(c.supprimerUtilisateur('parti')).resolves.toEqual({ ok: 1 });
    expect(servers.supprimerUtilisateur).toHaveBeenCalledWith('parti');
  });
});
