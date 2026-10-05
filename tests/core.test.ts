import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { confined, NetworkPolicy, publicIp, safeUrl } from '../src/security.js';
import { sample } from './fixtures/sample.js';
import { renderHtml, exportBook } from '../src/exporters.js';
import { report } from '../src/validation.js';
import { Store } from '../src/persistence.js';
import { validateBook } from '../src/schemas.js';
describe('configuration and boundaries', () => {
  it('accepts existing variable names and does not require school credentials in view', () => {
    expect(config('view', {}).port).toBe(3001);
    expect(() => config('extract', {})).toThrow('USERNAME');
    const c = config('extract', {
      USERNAME: 'fixture',
      PASSWORD: 'fixture',
      BOOK_ID: '11111111-1111-1111-1111-111111111111',
      SCHOOL_NAME: 'ZAAM',
      SCHOOL_GROUP: 'SECONDARY',
    });
    expect(c.schoolGroup).toBe('SECONDARY');
    expect(c.schoolName).toBe('ZAAM');
    expect(() => config('view', { HOST: '0.0.0.0' })).toThrow('loopback');
  });
  it('removes URL secrets and blocks local networks', async () => {
    expect(safeUrl('https://u:p@example.org/x?token=secret#token=secret')).toBe(
      'https://example.org/x',
    );
    expect(safeUrl('javascript:alert(1)')).toBe('');
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:127.0.0.1'])
      expect(publicIp(ip)).toBe(false);
    await expect(
      new NetworkPolicy(['https://localhost']).check('https://localhost/x'),
    ).rejects.toThrow();
    await expect(
      new NetworkPolicy(['https://apps.noordhoff.nl']).check('https://evil.test'),
    ).rejects.toThrow('Origin');
  });
  it('rejects symlink escape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'darrell-path-'));
    await mkdir(join(dir, 'viewer'));
    await symlink('/etc/hosts', join(dir, 'viewer', 'index.html'));
    await expect(confined(join(dir, 'viewer'), 'index.html')).rejects.toThrow('outside');
  });
});
describe('durable canonical exports', () => {
  it('validates nested schema and escapes source text', async () => {
    const { book } = sample();
    validateBook(book);
    book.sections[0].blocks[0].text.en = '<script>alert(1)</script>';
    expect(renderHtml(book)).not.toContain('<script>alert');
    const broken = structuredClone(book);
    broken.sections[0].visuals.push({ id: 'bad' } as never);
    expect(() => validateBook(broken)).toThrow();
    const dir = await mkdtemp(join(tmpdir(), 'darrell-export-'));
    await exportBook(book, dir);
    expect(await readFile(join(dir, 'viewer/index.html'), 'utf8')).toContain('&lt;script&gt;');
    expect(await readFile(join(dir, 'viewer/viewer.js'), 'utf8')).toContain('localStorage');
  });
  it('never reports complete for unknown inventory or missing languages', () => {
    const { job } = sample();
    expect(report(job).status).toBe('completed');
    job.inventory!.reliable = false;
    expect(report(job).expected).toBeNull();
    expect(report(job).status).toBe('partial');
    job.sections[0].questions[0].options[0].text.en = null;
    expect(report(job).translationPending).toBe(1);
  });
  it('persists checkpoints and refuses a second active worker lock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'darrell-store-'));
    const store = new Store(dir);
    const { job } = sample();
    store.save(job);
    store.lock(process.pid);
    expect(() => store.lock(process.pid)).toThrow('active');
    store.unlock(process.pid);
    store.close();
    const next = new Store(dir);
    expect(next.get(job.id)?.sections).toHaveLength(1);
    next.close();
  });
});
