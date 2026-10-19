const listen = jest.fn().mockResolvedValue(undefined);

const app = {
  setGlobalPrefix: jest.fn(),
  enableCors: jest.fn(),
  useGlobalPipes: jest.fn(),
  enableShutdownHooks: jest.fn(),
  listen,
};

jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn().mockResolvedValue(app) },
}));

const build = jest.fn().mockReturnValue({});
const builder = {
  setTitle: jest.fn().mockReturnThis(),
  setDescription: jest.fn().mockReturnThis(),
  setVersion: jest.fn().mockReturnThis(),
  addBearerAuth: jest.fn().mockReturnThis(),
  build,
};

const decorator = () => () => undefined;

jest.mock('@nestjs/swagger', () => ({
  DocumentBuilder: jest.fn(() => builder),
  SwaggerModule: {
    createDocument: jest.fn().mockReturnValue({}),
    setup: jest.fn(),
  },
  ApiTags: decorator,
  ApiOperation: decorator,
  ApiHeader: decorator,
  ApiBearerAuth: decorator,
  ApiNoContentResponse: decorator,
  ApiForbiddenResponse: decorator,
  ApiProperty: decorator,
  ApiPropertyOptional: decorator,
}));

describe('bootstrap', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.PORT;
    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.PORT;
    delete process.env.CORS_ORIGINS;
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it('configure et démarre sur PORT', async () => {
    process.env.PORT = '3999';

    await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://localhost:5173'],
      credentials: false,
    });
    expect(app.useGlobalPipes).toHaveBeenCalled();
    expect(app.enableShutdownHooks).toHaveBeenCalled();

    expect(builder.setTitle).toHaveBeenCalledWith('Chatvardage Rooms Service');
    expect(builder.setDescription).toHaveBeenCalled();
    expect(builder.setVersion).toHaveBeenCalledWith('1.0.0');
    expect(builder.addBearerAuth).toHaveBeenCalledWith({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(build).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(3999, '0.0.0.0');
  });

  it('utilise 3003 par défaut', async () => {
    await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(listen).toHaveBeenCalledWith(3003, '0.0.0.0');
  });

  it.each(['abc', '3003.0', '3e3'])(
    'refuse un PORT au format invalide: %s',
    async (port) => {
      const main = await import('./main');
      await new Promise<void>((resolve) => setImmediate(resolve));

      process.env.PORT = port;
      expect(() => main.resolvePort()).toThrow(
        `Variable PORT invalide : "${port}"`,
      );
    },
  );

  it('normalise les espaces autour de PORT', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.PORT = ' 3003 ';
    expect(main.resolvePort()).toBe(3003);
  });

  it('refuse un PORT vide comme invalide', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.PORT = '   ';
    expect(() => main.resolvePort()).toThrow('Variable PORT invalide : "   "');
  });

  it.each(['0', '65536'])('refuse un PORT hors plage: %s', async (port) => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.PORT = port;
    expect(() => main.resolvePort()).toThrow(
      `Variable PORT hors plage : "${port}"`,
    );
  });

  it('configure plusieurs origines CORS valides', async () => {
    process.env.CORS_ORIGINS =
      ' http://localhost:5173, https://app.example.test , ';

    await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://localhost:5173', 'https://app.example.test'],
      credentials: false,
    });
  });

  it('retombe sur localhost si CORS_ORIGINS est vide hors production', async () => {
    process.env.CORS_ORIGINS = '';

    await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://localhost:5173'],
      credentials: false,
    });
  });

  it('refuse de démarrer sans CORS_ORIGINS en production', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;

    expect(() => main.resolveCorsOrigins()).toThrow(
      'CORS_ORIGINS doit être défini en production',
    );
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('refuse une origine CORS locale en production: %s', async (origin) => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = origin;

    expect(() => main.resolveCorsOrigins()).toThrow(
      `Origine CORS locale interdite en production : ${origin}`,
    );
  });

  it('accepte une origine distante valide en production', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.example.test';

    expect(main.resolveCorsOrigins()).toEqual(['https://app.example.test']);
  });

  it('normalise un port HTTPS par défaut explicite', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.CORS_ORIGINS = 'https://app.example.test:443';

    expect(main.resolveCorsOrigins()).toEqual(['https://app.example.test']);
  });

  it('refuse une origine CORS sans URL valide', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.CORS_ORIGINS = '://invalid';

    expect(() => main.resolveCorsOrigins()).toThrow(
      'Origine CORS invalide : ://invalid',
    );
  });

  it('refuse une origine CORS sans schéma HTTP(S)', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.CORS_ORIGINS = 'localhost:5173';

    expect(() => main.resolveCorsOrigins()).toThrow(
      'Origine CORS invalide : localhost:5173',
    );
  });

  it('refuse une origine CORS contenant un chemin', async () => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.CORS_ORIGINS = 'https://example.test/app';

    expect(() => main.resolveCorsOrigins()).toThrow(
      'Origine CORS invalide : https://example.test/app',
    );
  });

  it.each([
    'https://example.test?tenant=chatvardage',
    'https://example.test#fragment',
  ])('refuse une origine CORS avec paramètres: %s', async (origin) => {
    const main = await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    process.env.CORS_ORIGINS = origin;

    expect(() => main.resolveCorsOrigins()).toThrow(
      `Origine CORS invalide : ${origin}`,
    );
  });
});
