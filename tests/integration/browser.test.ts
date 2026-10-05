import { it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { platform, bookId } from '../fixtures/platform.js';
import { config } from '../../src/config.js';
import { profile, restrictBrowser, NoordhoffAdapter } from '../../src/adapters/noordhoff.js';
import { runWorker } from '../../src/worker.js';
import { defaultOptions } from '../../src/manager.js';
import { Store } from '../../src/persistence.js';
import type { Job } from '../../src/model.js';
import { saveMedia } from '../../src/media.js';
import { NetworkPolicy } from '../../src/security.js';
it('collects native NL/EN, visible answers and authenticated media without submitting exercises; resumes checkpoints', async () => {
  const site = await platform();
  const dir = await mkdtemp(join(tmpdir(), 'darrell-browser-'));
  const c = config('extract', {
    USERNAME: 'fixture',
    PASSWORD: 'fixture',
    BOOK_ID: bookId,
    HEADLESS: 'true',
    REQUEST_DELAY_MS: '0',
    OUTPUT_DIR: join(dir, 'output'),
    DATA_DIR: join(dir, 'data'),
  });
  c.testOrigin = site.origin;
  const store = new Store(c.dataDir);
  const now = new Date().toISOString();
  const job: Job = {
    id: 'browser-job',
    state: 'queued',
    stage: 'queued',
    createdAt: now,
    updatedAt: now,
    selectedIds: [],
    options: defaultOptions,
    inventory: null,
    sections: [],
    report: null,
    message: '',
    cancelRequested: false,
  };
  store.save(job);
  try {
    await runWorker(
      c,
      job.id,
      'discover',
      () => {},
      () => false,
    );
    const discovered = store.get(job.id)!;
    expect(discovered.state).toBe('awaiting_scope');
    expect(discovered.inventory?.items).toHaveLength(2);
    expect(discovered.inventory?.title.en).toBe('Water systems');
    discovered.selectedIds = discovered.inventory!.items.map((i) => i.id);
    store.save(discovered);
    let cancel = false;
    await runWorker(
      c,
      job.id,
      'extract',
      (j) => {
        if (j.sections.length === 1) cancel = true;
      },
      () => cancel,
    );
    expect(store.get(job.id)?.state).toBe('cancelled');
    expect(store.get(job.id)?.sections).toHaveLength(1);
    const firstId = store.get(job.id)!.sections[0].questions[0].id;
    await runWorker(
      c,
      job.id,
      'extract',
      () => {},
      () => false,
    );
    const result = store.get(job.id)!;
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].questions[0].id).toBe(firstId);
    expect(result.sections[0].questions[0].text.en).toContain('Where does');
    expect(result.sections[0].questions[0].subparts[0].text.nl).toContain('Waar');
    expect(result.sections[0].questions[0].options[0].text.en).toBe('The sea');
    expect(result.sections[0].questions[0].answers[0].text.en).toBe('To the sea');
    expect(result.sections[0].visuals[0].assetStatus).toBe('asset_saved');
    expect(result.report?.status).toBe('partial');
    expect(result.report?.translationPending).toBe(0);
    const json = await readFile(join(c.outputDir, job.id, 'data/book.json'), 'utf8');
    expect(json).not.toContain('private-student-answer');
    expect(json).not.toContain('hidden reference');
    expect(site.counts.submitted).toBe(0);
  } finally {
    store.close();
    await site.close();
  }
}, 60000);
it('stops ebook and refuses HTML masquerading as an image', async () => {
  const site = await platform();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const c = config('extract', { USERNAME: 'fixture', PASSWORD: 'fixture', BOOK_ID: bookId });
  c.testOrigin = site.origin;
  try {
    const p = await profile(c);
    await restrictBrowser(context, p, c);
    const page = await context.newPage();
    const adapter = new NoordhoffAdapter(page, context, p, c);
    await page.goto(site.origin + '/ebook');
    await expect(adapter.guardSource()).rejects.toThrow('unsupported_ebook');
    const visual = { id: 'v', file: null, assetStatus: 'inspection_pending', bytes: 0 } as never;
    await saveMedia(
      context,
      visual,
      site.origin + '/fake.png',
      join(tmpdir(), 'unused'),
      new NetworkPolicy([site.origin], site.origin),
      c,
      c.maxJobBytes,
    );
    expect((visual as { assetStatus: string }).assetStatus).toBe('download_failed');
  } finally {
    await browser.close();
    await site.close();
  }
});
