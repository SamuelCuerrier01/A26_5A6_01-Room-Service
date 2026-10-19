import { Injectable } from '@nestjs/common';
import { ClientAuth, UtilisateurAuthentifie } from '../partage/client-auth';

export type AuthenticatedUser = UtilisateurAuthentifie;

@Injectable()
export class AuthService {
  private readonly client = new ClientAuth();

  authenticate(authorization?: string): Promise<AuthenticatedUser> {
    return this.client.authentifier(authorization);
  }
}
