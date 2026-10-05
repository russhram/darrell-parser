import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { ZipArchive } from 'archiver';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, type Config } from './config.js';
import { Store } from './persistence.js';
import { confined, safeId } from './security.js';
import { jobSchema } from './schemas.js';
import type { Options } from './model.js';
import { dashboardHtml, loginHtml } from './ui.js';

const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export async function createApp(c: Config) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  await mkdir(c.outputDir, { recursive: true, mode: 0o700 });
  const store = new Store(c.dataDir);
  // View mode does not import worker/Playwright/manager or require school credentials.
  const manager =
    c.mode === 'extract' ? new (await import('./manager.js')).Manager(c, store) : undefined;
  if (!c.appPassword) {
    c.appPassword = randomBytes(24).toString('base64url');
    await writeFile(
      join(c.dataDir, 'local-access.txt'),
      `Username: ${c.appUsername}\nPassword: ${c.appPassword}\n`,
      { mode: 0o600 },
    );
    await chmod(join(c.dataDir, 'local-access.txt'), 0o600);
  }
  const sessions = new Map<string, { csrf: string; expires: number }>();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(staticPlugin, { root: c.outputDir, serve: false });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-store')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
      return reply.code(403).send({ message: 'Invalid Host' });
    const changing = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (changing && req.headers.origin !== `http://${host}`)
      return reply.code(403).send({ message: 'Invalid Origin' });
    const path = req.url.split('?')[0];
    if (
      path === '/login' ||
      path === '/auth/login' ||
      /^\/assets\/(login\.js|viewer\.css)$/.test(path)
    )
      return;
    const session = sessions.get(req.cookies.session || '');
    if (!session || session.expires < Date.now()) {
      if (req.cookies.session) sessions.delete(req.cookies.session);
      return path.startsWith('/api/') || changing
        ? reply.code(401).send({ message: 'Sign in to the local service' })
        : reply.redirect('/login');
    }
    if (changing && !equal((req.headers['x-csrf-token'] as string) || '', session.csrf))
      return reply.code(403).send({ message: 'Invalid CSRF token' });
  });
  app.setErrorHandler((error: unknown, req, reply) => {
    const detail = error as { validation?: unknown; statusCode?: number };
    const invalid = Boolean(detail.validation);
    const status = invalid ? 400 : detail.statusCode === 429 ? 429 : 500;
    reply
      .code(status)
      .send({
        message: invalid
          ? 'Invalid request'
          : status === 429
            ? 'Too many login attempts; try again later.'
            : 'Operation failed; check the job status and configuration.',
      });
  });
  app.get('/login', async (_, reply) => reply.type('text/html').send(loginHtml));
  app.post<{ Body: { username: string; password: string } }>(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', maxLength: 200 },
            password: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!equal(req.body.username, c.appUsername) || !equal(req.body.password, c.appPassword))
        return reply.code(401).send({ message: 'Invalid credentials' });
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, {
        csrf: randomBytes(24).toString('base64url'),
        expires: Date.now() + 8 * 3600000,
      });
      if (sessions.size > 1000) sessions.delete(sessions.keys().next().value!);
      reply.setCookie('session', token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 3600,
      });
      return { ok: true };
    },
  );
  app.post('/auth/logout', async (req, reply) => {
    sessions.delete(req.cookies.session || '');
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/session', async (req) => ({ csrf: sessions.get(req.cookies.session!)!.csrf }));
  app.get('/', async (_, reply) =>
    reply.type('text/html').send(dashboardHtml(c.mode === 'extract', c.bookId)),
  );
  app.get<{ Params: { file: string } }>('/assets/:file', async (req, reply) => {
    if (!['login.js', 'app.js', 'viewer.css'].includes(req.params.file))
      return reply.code(404).send();
    const content = await readFile(new URL(`./viewer/${req.params.file}`, import.meta.url));
    return reply
      .type(req.params.file.endsWith('.css') ? 'text/css' : 'text/javascript')
      .send(content);
  });
  app.get('/api/profiles', async () => [
    {
      id: 'noordhoff',
      bookId: c.bookId,
      schoolName: c.schoolName,
      schoolGroup: c.schoolGroup,
      status: 'provisional',
      credentialsConfigured: Boolean(c.username && c.password),
    },
  ]);
  app.get('/api/jobs', async () => store.list());
  app.get<{ Params: { id: string } }>(
    '/api/jobs/:id',
    async (req, reply) =>
      store.get(safeId(req.params.id)) || reply.code(404).send({ message: 'Unknown job' }),
  );
  app.get<{ Params: { id: string } }>(
    '/api/discover/:id',
    async (req, reply) =>
      store.get(safeId(req.params.id)) || reply.code(404).send({ message: 'Unknown discovery' }),
  );
  app.post(
    '/api/discover',
    { schema: { body: { type: 'object', additionalProperties: false, properties: {} } } },
    async (_, reply) => {
      if (!manager) return reply.code(405).send({ message: 'View mode has no scraper' });
      if (manager.worker) return reply.code(409).send({ message: 'A worker is active' });
      const job = manager.create();
      manager.start(job.id, 'discover');
      return reply.code(202).send({ id: job.id });
    },
  );
  app.post<{ Body: { discoveryId: string; selectedIds: string[]; options: Options } }>(
    '/api/jobs',
    { schema: { body: jobSchema } },
    async (req, reply) => {
      if (!manager) return reply.code(405).send({ message: 'View mode has no scraper' });
      if (manager.worker) return reply.code(409).send({ message: 'A worker is active' });
      const source = store.get(req.body.discoveryId);
      if (
        !source?.inventory ||
        source.state !== 'awaiting_scope' ||
        req.body.selectedIds.some((id) => !source.inventory!.items.some((i) => i.id === id))
      )
        return reply.code(400).send({ message: 'Select items from a finished discovery' });
      const job = manager.create();
      job.inventory = source.inventory;
      job.selectedIds = req.body.selectedIds;
      job.options = req.body.options;
      store.save(job);
      manager.start(job.id, 'extract');
      return reply.code(202).send({ id: job.id });
    },
  );
  for (const action of ['cancel', 'resume'] as const)
    app.post<{ Params: { id: string } }>(`/api/jobs/:id/${action}`, async (req, reply) => {
      if (!manager) return reply.code(405).send({ message: 'View mode has no worker' });
      const job = store.get(safeId(req.params.id));
      if (!job) return reply.code(404).send({ message: 'Unknown job' });
      if (action === 'cancel') manager.cancel(job.id);
      else {
        if (
          manager.worker ||
          !['cancelled', 'partial', 'failed', 'needs_user_action'].includes(job.state)
        )
          return reply.code(409).send({ message: 'Job cannot be resumed in this state' });
        manager.start(job.id, job.selectedIds.length ? 'extract' : 'discover');
      }
      return reply.code(202).send({ id: job.id });
    });
  app.get<{ Params: { id: string } }>('/api/jobs/:id/events', async (req, reply) => {
    const id = safeId(req.params.id);
    if (!store.get(id)) return reply.code(404).send();
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const send = () => {
      const job = store.get(id);
      reply.raw.write(`event: progress\ndata: ${JSON.stringify(job)}\n\n`);
    };
    send();
    manager?.events.on(id, send);
    const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 15000);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      manager?.events.off(id, send);
    });
  });
  app.get<{ Params: { id: string } }>('/api/jobs/:id/report', async (req, reply) => {
    const job = store.get(safeId(req.params.id));
    return job?.report || reply.code(404).send({ message: 'No report yet' });
  });
  app.get<{ Params: { id: string } }>('/api/jobs/:id/export', async (req, reply) => {
    const id = safeId(req.params.id);
    if (!store.get(id)?.report) return reply.code(404).send();
    const root = join(c.outputDir, id);
    const zip = new ZipArchive({ zlib: { level: 6 } });
    // Explicit allowlist. Never archive data/, auth state, checkpoints or source app DOM wholesale.
    async function add(dir: string) {
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        const relative = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (
          entry.isDirectory() &&
          ['viewer/media', 'content/chapters', 'data/chapters'].includes(relative)
        )
          await add(relative);
        else if (
          entry.isFile() &&
          /^(viewer\/(index\.html|viewer\.(css|js)|media\/(media-manifest\.json|[a-f0-9]{64}\.(png|jpg|gif|webp)))|content\/chapters\/chapter-[a-f0-9]{16}_content_EN-NL\.md|data\/(book\.json|chapters\/chapter-[a-f0-9]{16}\.json))$/.test(
            relative,
          )
        )
          zip.file(await confined(root, relative), { name: relative });
      }
    }
    for (const dir of ['viewer', 'content', 'data']) await add(dir);
    for (const file of [
      'manifest.json',
      'scope-inventory.json',
      'extraction-report.json',
      'extraction-report.md',
    ])
      zip.file(await confined(root, file), { name: file });
    reply.header('Content-Disposition', `attachment; filename="${id}.zip"`).type('application/zip');
    zip.on('error', () => zip.destroy());
    void zip.finalize();
    return reply.send(zip);
  });
  app.get<{ Params: { id: string; '*': string } }>('/view/:id/*', async (req, reply) => {
    const root = join(c.outputDir, safeId(req.params.id), 'viewer');
    const file = req.params['*'] || 'index.html';
    if (!/^(index\.html|viewer\.(css|js)|media\/[a-f0-9]{64}\.(png|jpg|gif|webp))$/.test(file))
      return reply.code(404).send();
    try {
      await confined(root, file);
    } catch {
      return reply.code(404).send();
    }
    return reply.sendFile(file, root);
  });
  app.addHook('onClose', async () => {
    await manager?.close();
    store.close();
  });
  return app;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const mode = process.argv.includes('--mode=view') ? 'view' : 'extract';
    const c = config(mode);
    const app = await createApp(c);
    await app.listen({ host: c.host, port: c.port });
    const jobIndex = process.argv.indexOf('--job');
    const suffix = jobIndex >= 0 ? `/view/${safeId(process.argv[jobIndex + 1])}/` : '/';
    console.log(`Darrell: http://${c.host}:${c.port}${suffix}`);
    console.log(
      'Local UI credentials: APP_USERNAME/APP_PASSWORD or data/local-access.txt (private file).',
    );
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void app.close();
      });
  } catch {
    console.error(
      'Startup failed. Use Node 24, check required configuration and port availability. No credentials have been logged.',
    );
    process.exitCode = 1;
  }
}
