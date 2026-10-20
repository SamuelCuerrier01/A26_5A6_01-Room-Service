import type { ChannelAccess, ChannelWrite, ServerRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.service';

export type RoleServeur = 'admin' | 'proprietaire' | ServerRole;

const RANG: Record<RoleServeur, number> = {
  membre: 1,
  moderateur: 2,
  proprietaire: 3,
  admin: 4,
};

export type ServeurPourPermissions = {
  ownerId: string | null;
  isDefault: boolean;
};

export type Acteur = Pick<AuthenticatedUser, 'id' | 'role'>;

export function roleEffectif(
  serveur: ServeurPourPermissions,
  membre: { role: ServerRole } | null | undefined,
  acteur: Acteur,
): RoleServeur | null {
  if (acteur.role === 'admin') return 'admin';
  if (serveur.ownerId !== null && serveur.ownerId === acteur.id) {
    return 'proprietaire';
  }
  if (membre) return membre.role;
  if (serveur.isDefault) return 'membre';
  return null;
}

export function rang(role: RoleServeur | null): number {
  return role === null ? 0 : RANG[role];
}

export function peutGererServeur(role: RoleServeur | null): boolean {
  return rang(role) >= RANG.proprietaire;
}

export function peutModerer(role: RoleServeur | null): boolean {
  return rang(role) >= RANG.moderateur;
}

export function peutVoirSalon(
  role: RoleServeur | null,
  salon: { access: ChannelAccess },
): boolean {
  if (role === null) return false;
  return salon.access === 'tous' || peutModerer(role);
}

export function peutEcrireSalon(
  role: RoleServeur | null,
  salon: { access: ChannelAccess; writePolicy: ChannelWrite },
): boolean {
  if (!peutVoirSalon(role, salon)) return false;
  return salon.writePolicy === 'tous' || peutModerer(role);
}

export function peutExpulser(
  acteur: RoleServeur | null,
  cible: RoleServeur | null,
): boolean {
  return peutModerer(acteur) && rang(acteur) > rang(cible);
}
