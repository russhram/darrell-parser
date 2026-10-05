import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import { bookUrl } from './config.js';
import type { Book, Job } from './model.js';
import { Store, atomicJson } from './persistence.js';
import { NoordhoffAdapter, profile, restrictBrowser } from './adapters/noordhoff.js';
import { extract } from './extraction.js';
import { saveMedia } from './media.js';
import { exportBook } from './exporters.js';
import { escapeHtml, NetworkPolicy } from './security.js';
import { report } from './validation.js';
import { validateBook } from './schemas.js';

export async function runWorker(
  c: Config,
  id: string,
  operation: 'discover' | 'extract',
  notify: (job: Job) => void,
  cancelled: () => boolean,
) {
  const store = new Store(c.dataDir);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const job = store.get(id);
  if (!job) {
    store.close();
    throw new Error('Unknown job');
  }
  const started = Date.now();
  const update = (state: Job['state'], message = '') => {
    job.state = state;
    job.stage = state;
    job.message = message;
    job.cancelRequested = cancelled();
    store.save(job);
    notify(job);
  };
  const root = join(c.outputDir, id);
  const publish = async () => {
    if (!job.inventory) return;
    job.report = report(job);
    const book: Book = {
      schemaVersion: '1.0',
      adapterVersion: 'noordhoff-provisional-1',
      bookId: c.bookId,
      title: job.inventory.title,
      originalLanguage: 'nl',
      sourceUrl: bookUrl(c),
      capturedAt: job.createdAt,
      inventory: job.inventory,
      sections: job.sections,
      report: job.report,
    };
    validateBook(book);
    await exportBook(book, root);
  };
  try {
    store.lock(process.pid);
    update('authenticating');
    browser = await chromium.launch({ headless: c.headless });
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    context.setDefaultTimeout(30000);
    const p = await profile(c);
    await restrictBrowser(context, p, c);
    const mediaPolicy = new NetworkPolicy([...p.contentOrigins, ...p.assetOrigins], c.testOrigin);
    const page = await context.newPage();
    const adapter = new NoordhoffAdapter(page, context, p, c);
    await adapter.authenticate((message) => update('needs_user_action', message), cancelled);
    if (operation === 'discover') {
      update('discovering');
      job.inventory = await adapter.discover();
      await atomicJson(join(root, 'scope-inventory.json'), job.inventory);
      update(
        'awaiting_scope',
        job.inventory.items.length
          ? 'Select learning items before extraction.'
          : 'adapter_required: course menu not recognized.',
      );
      return;
    }
    if (!job.inventory) throw new Error('Missing inventory');
    let mediaBytes = job.sections.flatMap((s) => s.visuals).reduce((n, v) => n + v.bytes, 0);
    for (const item of job.inventory.items.filter((i) => job.selectedIds.includes(i.id))) {
      if (cancelled()) {
        await publish();
        update('cancelled', 'Checkpoints saved.');
        return;
      }
      if (Date.now() - started > c.maxMinutes * 60000 || job.sections.length >= c.maxPages) {
        await publish();
        update('partial', 'Job time/page limit reached.');
        return;
      }
      if (job.sections.some((s) => s.id === item.id && s.status === 'captured')) continue;
      update('extracting', `Reading item ${job.sections.length + 1} of ${job.selectedIds.length}`);
      try {
        await adapter.open(item);
        const result = await extract(adapter, item, job.options.languages);
        const before = job.sections.findIndex((s) => s.id === item.id);
        if (before >= 0) job.sections.splice(before, 1);
        for (const visual of result.section.visuals) {
          if (job.options.imagePermission === 'unknown') visual.assetStatus = 'not_authorized';
          else
            await saveMedia(
              context,
              visual,
              result.assets.get(visual.id),
              join(root, 'viewer/media'),
              mediaPolicy,
              c,
              c.maxJobBytes - mediaBytes,
            );
          mediaBytes += visual.bytes;
        }
        for (const question of result.section.questions) {
          if (
            question.visualRefs.some(
              (ref) => !result.section.visuals.find((v) => v.id === ref)?.file,
            )
          ) {
            question.status = 'partial';
            result.section.gaps.push(`question_visual_missing:${question.id}`);
            result.section.status = 'partial';
          }
        }
        // Passive, reconstructed source snapshot contains only extracted learning blocks.
        const textBytes = Buffer.byteLength(JSON.stringify(result.section));
        const storedBytes = Buffer.byteLength(JSON.stringify(job.sections));
        if (mediaBytes + storedBytes + textBytes > c.maxJobBytes) {
          await publish();
          update('partial', 'Job size limit reached.');
          return;
        }
        job.sections.push(result.section);
        await mkdir(join(root, 'source'), { recursive: true, mode: 0o700 });
        for (const [name, snapshot] of result.snapshots) {
          const blocks = JSON.parse(snapshot) as { text: string }[];
          await writeFile(
            join(root, 'source', `${name}.html`),
            `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><main>${blocks.map((b) => `<p>${escapeHtml(b.text)}</p>`).join('')}</main>`,
            { mode: 0o600 },
          );
        }
        store.save(job);
        notify(job);
        await atomicJson(join(root, 'checkpoints', `${item.id}.json`), result.section);
        await publish();
      } catch (error) {
        if ((error as Error).message === 'session_expired') {
          await publish();
          update('needs_user_action', 'Session expired; resume after signing in.');
          return;
        }
        if (['unsupported_ebook', 'access_blocked_403'].includes((error as Error).message))
          throw error;
        if (!job.sections.some((s) => s.id === item.id))
          job.sections.push({
            id: item.id,
            chapterId: item.chapterId,
            title: item.title,
            kind: item.kind,
            status: 'unavailable',
            blocks: [],
            questions: [],
            visuals: [],
            gaps: ['read_failed: inaccessible learning item'],
          });
        store.save(job);
        notify(job);
      }
      await new Promise((r) => setTimeout(r, c.delayMs));
    }
    update('validating');
    await publish();
    update('rendering');
    update(job.report?.status || 'partial', 'Saved JSON, Markdown and offline viewer.');
  } catch (error) {
    const code = (error as Error).message;
    const known = [
      'unsupported_ebook',
      'access_blocked_403',
      'needs_user_action',
      'cancelled',
      'Another worker is active',
    ];
    if (job.sections.length) await publish().catch(() => {});
    update(
      cancelled()
        ? 'cancelled'
        : code === 'needs_user_action'
          ? 'needs_user_action'
          : job.sections.length
            ? 'partial'
            : 'failed',
      known.includes(code)
        ? code
        : 'Browser operation failed. Verify Chromium installation, profile and site access.',
    );
  } finally {
    await browser?.close();
    store.unlock(process.pid);
    store.close();
  }
}

if (process.send) {
  let cancel = false;
  process.on(
    'message',
    async (msg: {
      action: string;
      config: Config;
      id: string;
      operation: 'discover' | 'extract';
    }) => {
      if (msg.action === 'cancel') {
        cancel = true;
        return;
      }
      if (msg.action !== 'run') return;
      await runWorker(
        msg.config,
        msg.id,
        msg.operation,
        (job) => process.send?.({ type: 'progress', id: job.id }),
        () => cancel,
      );
      process.disconnect?.();
    },
  );
}
