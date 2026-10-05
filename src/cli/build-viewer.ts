import { join } from 'node:path';
import { config } from '../config.js';
import { exportBook, readBook } from '../exporters.js';
import { safeId, confined } from '../security.js';
const c = config('view');
const args = process.argv.slice(2);
try {
  const job = args[args.indexOf('--job') + 1];
  if (!args.includes('--job') || !job)
    throw new Error('Usage: npm run build:viewer -- --job <job-id>');
  const path = await confined(c.outputDir, join(safeId(job), 'data/book.json'));
  await exportBook(await readBook(path), join(c.outputDir, job));
  console.log('Viewer rebuilt from canonical JSON.');
} catch {
  console.error('Cannot rebuild viewer: specify an existing job with valid canonical JSON.');
  process.exitCode = 1;
}
