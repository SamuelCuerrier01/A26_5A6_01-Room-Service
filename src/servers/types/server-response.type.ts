import type { RoleServeur } from '../permissions';

export type RoleAffiche = 'proprietaire' | 'moderateur' | 'membre';

export interface SalonResponse {
  type: 'salon';
  id: string;
  serveurId: string;
  nom: string;
  position: number;
  acces: 'tous' | 'moderateurs';
  ecriture: 'tous' | 'moderateurs';
  peutEcrire: boolean;
  creePar: string | null;
}

export interface MembreResponse {
  utilisateurId: string;
  role: RoleAffiche;
}

export interface ServeurResponse {
  type: 'serveur';
  id: string;
  nom: string;
  icone: string | null;
  public: boolean;
  parDefaut: boolean;
  proprietaireId: string | null;
  monRole: RoleServeur | null;
  nombreMembres: number;
  salons: SalonResponse[];
  invitations: string[];
}

export interface PageMembresResponse {
  membres: MembreResponse[];
  total: number;
  suivant: number | null;
}

export interface PageServeursResponse {
  serveurs: ServeurResumeResponse[];
  total: number;
  suivant: number | null;
}

export interface ServeurResumeResponse {
  type: 'serveur';
  id: string;
  nom: string;
  icone: string | null;
  public: boolean;
  nombreMembres: number;
}

export interface InvitationResponse {
  serveur: ServeurResumeResponse;
  invitePar: string;
  inviteLe: string;
}

export interface AccesSalonResponse {
  salonId: string;
  serveurId: string;
  estMembre: boolean;
  peutLire: boolean;
  peutEcrire: boolean;
  peutModerer: boolean;
}

export interface SalonLisibleResponse {
  salonId: string;
  serveurId: string;
  depuis: string | null;
}
