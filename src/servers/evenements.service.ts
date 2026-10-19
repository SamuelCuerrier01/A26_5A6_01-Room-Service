import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SERVEUR_PAR_DEFAUT_ID } from './default-server';

export type RaisonEvenement =
  'modifie' | 'supprime' | 'membres' | 'expulse' | 'invitation' | 'salons';

export type OptionsEvenement = {
  cibleId?: string;
  destinataires?: string[];
  extras?: string[];
};

const DELAI_ENVOI_MS = 2000;
export const TAILLE_LOT_SALONS = 500;
export const ATTENTES_PURGE_MS = [1000, 4000];

@Injectable()
export class EvenementsService {
  private readonly logger = new Logger(EvenementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  notifier(
    serveurId: string,
    raison: RaisonEvenement,
    options: OptionsEvenement = {},
  ): void {
    void this.envoyer(serveurId, raison, options);
  }

  salonsSupprimes(salonIds: string[]): void {
    void this.purgerSalons(salonIds);
  }

  async purgerSalons(
    salonIds: string[],
    attentes: number[] = ATTENTES_PURGE_MS,
  ): Promise<void> {
    for (let i = 0; i < salonIds.length; i += TAILLE_LOT_SALONS) {
      const lot = salonIds.slice(i, i + TAILLE_LOT_SALONS);
      for (let tentative = 0; ; tentative += 1) {
        try {
          await this.appeler('/api/internal/salons-supprimes', {
            salonIds: lot,
          });
          break;
        } catch (erreur) {
          if (tentative >= attentes.length) {
            this.logger.error(
              `Messages de ${lot.length} salon(s) supprimé(s) non effacés : ${messageErreur(erreur)} (${lot.join(', ')})`,
            );
            break;
          }
          await new Promise((fin) => setTimeout(fin, attentes[tentative]));
        }
      }
    }
  }

  async envoyer(
    serveurId: string,
    raison: RaisonEvenement,
    options: OptionsEvenement,
  ): Promise<void> {
    if (!process.env.INTERNAL_SERVICE_TOKEN?.trim()) return;
    try {
      let corps: { tous: true } | { utilisateurIds: string[] };
      if (serveurId === SERVEUR_PAR_DEFAUT_ID) {
        corps = { tous: true };
      } else {
        const utilisateurIds = await this.destinataires(serveurId, options);
        if (utilisateurIds.length === 0) return;
        corps = { utilisateurIds };
      }

      await this.appeler('/api/internal/events', {
        serveurId,
        raison,
        ...(options.cibleId ? { cibleId: options.cibleId } : {}),
        ...corps,
      });
    } catch (erreur) {
      this.logger.warn(
        `Événement "${raison}" (serveur ${serveurId}) non transmis : ${messageErreur(erreur)}`,
      );
    }
  }

  private async appeler(chemin: string, corps: unknown): Promise<void> {
    const jeton = process.env.INTERNAL_SERVICE_TOKEN?.trim();
    if (!jeton) return;
    const baseUrl = (
      process.env.MESSAGE_SERVICE_URL ?? 'http://localhost:3004'
    ).replace(/\/+$/, '');
    const reponse = await fetch(`${baseUrl}${chemin}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': jeton,
      },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_ENVOI_MS),
    });
    if (!reponse.ok) {
      throw new Error(`refusé par Message-Service : HTTP ${reponse.status}`);
    }
  }

  private async destinataires(
    serveurId: string,
    options: OptionsEvenement,
  ): Promise<string[]> {
    const membres =
      options.destinataires ??
      (
        await this.prisma.serverMember.findMany({
          where: { serverId: serveurId },
          select: { userId: true },
        })
      ).map((membre) => membre.userId);
    return [...new Set([...membres, ...(options.extras ?? [])])];
  }
}

function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
