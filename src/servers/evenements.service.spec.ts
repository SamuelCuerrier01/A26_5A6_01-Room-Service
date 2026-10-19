import { PrismaService } from '../prisma/prisma.service';
import { SERVEUR_PAR_DEFAUT_ID } from './default-server';
import { EvenementsService, TAILLE_LOT_SALONS } from './evenements.service';

describe('EvenementsService', () => {
  const originalFetch = global.fetch;
  const ancienJeton = process.env.INTERNAL_SERVICE_TOKEN;
  const ancienneUrl = process.env.MESSAGE_SERVICE_URL;
  let prisma: any;
  let service: EvenementsService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    prisma = {
      serverMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]),
      },
    };
    service = new EvenementsService(prisma as PrismaService);
    process.env.INTERNAL_SERVICE_TOKEN = 'secret';
    delete process.env.MESSAGE_SERVICE_URL;
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.INTERNAL_SERVICE_TOKEN = ancienJeton;
    if (ancienneUrl === undefined) delete process.env.MESSAGE_SERVICE_URL;
    else process.env.MESSAGE_SERVICE_URL = ancienneUrl;
  });

  const corps = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it('envoie aux membres actuels (chargés) + extras, sans doublon, avec le jeton interne', async () => {
    await service.envoyer('s1', 'invitation', {
      cibleId: 'c',
      extras: ['c', 'a'],
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3004/api/internal/events');
    expect(options.method).toBe('POST');
    expect(options.headers['x-internal-token']).toBe('secret');
    expect(corps()).toEqual({
      serveurId: 's1',
      raison: 'invitation',
      cibleId: 'c',
      utilisateurIds: ['a', 'b', 'c'],
    });
  });

  it('serveur par défaut : « tous », sans liste ni requête en base', async () => {
    await service.envoyer(SERVEUR_PAR_DEFAUT_ID, 'salons', {
      destinataires: ['ignore'],
    });
    expect(prisma.serverMember.findMany).not.toHaveBeenCalled();
    expect(corps()).toEqual({
      serveurId: SERVEUR_PAR_DEFAUT_ID,
      raison: 'salons',
      tous: true,
    });
  });

  it('destinataires fournis : pas de requête en base ; URL configurée', async () => {
    process.env.MESSAGE_SERVICE_URL = 'http://message-service:3004/';
    await service.envoyer('s1', 'salons', { destinataires: ['x'] });
    expect(prisma.serverMember.findMany).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://message-service:3004/api/internal/events',
    );
    expect(corps()).toEqual({
      serveurId: 's1',
      raison: 'salons',
      utilisateurIds: ['x'],
    });
  });

  it.each([undefined, '  '])(
    'ne fait rien sans INTERNAL_SERVICE_TOKEN (%p)',
    async (valeur) => {
      if (valeur === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
      else process.env.INTERNAL_SERVICE_TOKEN = valeur;
      await service.envoyer('s1', 'salons', {});
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('ne fait rien sans destinataire', async () => {
    await service.envoyer('s1', 'salons', { destinataires: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'une réponse HTTP en erreur',
      () => fetchMock.mockResolvedValue({ ok: false, status: 401 }),
    ],
    ['une erreur réseau', () => fetchMock.mockRejectedValue(new Error('down'))],
    ['une erreur non-Error', () => fetchMock.mockRejectedValue('down')],
    [
      'un échec de lecture en base',
      () => prisma.serverMember.findMany.mockRejectedValue(new Error('db')),
    ],
  ])("n'échoue jamais sur %s", async (_cas, preparer) => {
    preparer();
    await expect(service.envoyer('s1', 'salons', {})).resolves.toBeUndefined();
  });

  it('purge des salons supprimés : par lots, avec le jeton interne', async () => {
    const ids = Array.from(
      { length: TAILLE_LOT_SALONS + 1 },
      (_, i) => `r${i}`,
    );
    await service.purgerSalons(ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3004/api/internal/salons-supprimes');
    expect(options.headers['x-internal-token']).toBe('secret');
    expect(corps().salonIds).toHaveLength(TAILLE_LOT_SALONS);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      salonIds: [`r${TAILLE_LOT_SALONS}`],
    });
  });

  it("purge : réessaie, n'échoue jamais, et continue avec le lot suivant", async () => {
    const erreur = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const ids = Array.from(
      { length: TAILLE_LOT_SALONS + 1 },
      (_, i) => `r${i}`,
    );
    await expect(service.purgerSalons(ids, [0, 0])).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(erreur).toHaveBeenCalledTimes(1);
  });

  it('purge : une réussite après un échec ne journalise rien', async () => {
    const erreur = jest.spyOn((service as any).logger, 'error');
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await service.purgerSalons(['r1'], [0, 0]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(erreur).not.toHaveBeenCalled();
  });

  it('purge : ne fait rien sans INTERNAL_SERVICE_TOKEN', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    await service.purgerSalons(['r1'], [0, 0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('salonsSupprimes ne bloque pas et ne renvoie rien', () => {
    const purger = jest.spyOn(service, 'purgerSalons').mockResolvedValue();
    expect(service.salonsSupprimes(['r1'])).toBeUndefined();
    expect(purger).toHaveBeenCalledWith(['r1']);
  });

  it('notifier ne bloque pas et ne renvoie rien', () => {
    const envoyer = jest.spyOn(service, 'envoyer').mockResolvedValue();
    expect(service.notifier('s1', 'modifie')).toBeUndefined();
    expect(envoyer).toHaveBeenCalledWith('s1', 'modifie', {});
  });
});
