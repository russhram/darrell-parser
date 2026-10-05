import { it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platform, bookId } from '../fixtures/platform.js';
import { config } from '../../src/config.js';
it('runs the compiled API and a separate worker through discovery, extraction and export', async () => {
  // Build is deliberately exercised: source tests alone cannot verify worker/asset paths.
  const { createApp } = await import(
    /* @vite-ignore */ new URL('../../dist/server.js', import.meta.url).href
  );
  const site = await platform();
  const dir = await mkdtemp(join(tmpdir(), 'darrell-compiled-'));
  const c = config('extract', {
    USERNAME: 'fixture',
    PASSWORD: 'fixture',
    BOOK_ID: bookId,
    HEADLESS: 'true',
    REQUEST_DELAY_MS: '0',
    APP_USERNAME: 'fixture',
    APP_PASSWORD: 'fixture-pass',
    OUTPUT_DIR: join(dir, 'output'),
    DATA_DIR: join(dir, 'data'),
  });
  c.testOrigin = site.origin;
  const app = await createApp(c);
  const origin = 'http://localhost:80';
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin },
      payload: { username: 'fixture', password: 'fixture-pass' },
    });
    const cookie = login.headers['set-cookie'].toString().split(';')[0];
    const csrf = (await app.inject({ url: '/api/session', headers: { cookie } })).json().csrf;
    const headers = { cookie, origin, 'x-csrf-token': csrf };
    const poll = async (id: string) => {
      for (let n = 0; n < 200; n++) {
        const job = (await app.inject({ url: `/api/jobs/${id}`, headers: { cookie } })).json();
        if (['awaiting_scope', 'failed', 'completed', 'partial', 'cancelled'].includes(job.state))
          return job;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Compiled worker did not finish');
    };
    const discover = await app.inject({
      method: 'POST',
      url: '/api/discover',
      headers,
      payload: {},
    });
    expect(discover.statusCode).toBe(202);
    const inventory = await poll(discover.json().id);
    expect(inventory.state).toBe('awaiting_scope');
    // The worker may finish its final cleanup just after persisting inventory.
    await new Promise((r) => setTimeout(r, 300));
    const start = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers,
      payload: {
        discoveryId: inventory.id,
        selectedIds: inventory.inventory.items.map((i: { id: string }) => i.id),
        options: {
          textMode: 'authorized_verbatim',
          textPermission: 'authorized',
          imagePermission: 'authorized',
          languages: ['nl', 'en'],
          answerPolicy: 'visible_only',
        },
      },
    });
    expect(start.statusCode).toBe(202);
    const result = await poll(start.json().id);
    expect(result.state).toBe('partial');
    expect(result.sections).toHaveLength(2);
    expect(result.report.savedImages).toBe(1);
    const viewer = await app.inject({ url: `/view/${result.id}/`, headers: { cookie } });
    expect(viewer.body).toContain('Water systems');
    const css = await app.inject({ url: `/view/${result.id}/viewer.css`, headers: { cookie } });
    expect(css.statusCode).toBe(200);
    expect(css.body).toContain('@media print');
    expect(site.counts.submitted).toBe(0);
  } finally {
    await app.close();
    await site.close();
  }
}, 60000);
