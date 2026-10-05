import { it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';
import { exportBook } from '../src/exporters.js';
import { Store } from '../src/persistence.js';
import { sample } from './fixtures/sample.js';
it('protects routes and exports, rejects CSRF/traversal and never starts extraction in view mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'darrell-api-'));
  const c = config('view', {
    APP_USERNAME: 'fixture',
    APP_PASSWORD: 'fixture-pass',
    OUTPUT_DIR: join(dir, 'output'),
    DATA_DIR: join(dir, 'data'),
  });
  const { job, book } = sample();
  const store = new Store(c.dataDir);
  store.save(job);
  store.close();
  await exportBook(book, join(c.outputDir, job.id));
  await writeFile(join(c.outputDir, job.id, 'data', '.env'), 'secret-fixture-only');
  const app = await createApp(c);
  const origin = 'http://localhost:80';
  try {
    expect((await app.inject({ url: '/api/jobs' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/', headers: { host: 'evil.test' } })).statusCode).toBe(403);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin },
      payload: { username: 'fixture', password: 'fixture-pass' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie']!.toString().split(';')[0];
    const session = await app.inject({ url: '/api/session', headers: { cookie } });
    const csrf = session.json().csrf;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/discover',
          headers: { cookie, origin: 'https://evil.test' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/discover',
          headers: { cookie, origin },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/discover',
          headers: { cookie, origin, 'x-csrf-token': csrf },
          payload: {},
        })
      ).statusCode,
    ).toBe(405);
    expect((await app.inject({ url: `/view/${job.id}/`, headers: { cookie } })).body).toContain(
      'A river flows',
    );
    expect(
      (await app.inject({ url: `/view/${job.id}/../data/book.json`, headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    const zip = await app.inject({ url: `/api/jobs/${job.id}/export`, headers: { cookie } });
    expect(zip.statusCode).toBe(200);
    expect(zip.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(zip.rawPayload.includes(Buffer.from('.env'))).toBe(false);
    expect(
      (await app.inject({ url: `/view/${job.id}/media/media-manifest.json`, headers: { cookie } }))
        .statusCode,
    ).toBe(404);
    let lastStatus = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      lastStatus = (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          headers: { origin },
          payload: { username: 'fixture', password: 'wrong-fixture-password' },
        })
      ).statusCode;
    }
    expect(lastStatus).toBe(429);
  } finally {
    await app.close();
  }
});
