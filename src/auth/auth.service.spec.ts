import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requires a bearer token', async () => {
    await expect(new AuthService().authenticate()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns the current user from Auth', async () => {
    const user = {
      id: 'u1',
      pseudo: 'alice',
      courriel: 'alice@example.com',
      role: 'utilisateur',
    };
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));

    await expect(new AuthService().authenticate('Bearer jwt')).resolves.toEqual(
      user,
    );
  });
});
