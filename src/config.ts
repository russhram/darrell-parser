import { resolve } from 'node:path';
export interface Config {
  mode: 'extract' | 'view';
  host: string;
  port: number;
  username: string;
  password: string;
  bookId: string;
  schoolName: string;
  schoolGroup: string;
  appUsername: string;
  appPassword: string;
  outputDir: string;
  dataDir: string;
  headless: boolean;
  maxPages: number;
  maxMinutes: number;
  delayMs: number;
  maxAssetBytes: number;
  maxJobBytes: number;
  schoolLoginOrigin: string;
  testOrigin?: string;
}
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 1) {
  const n = Number(env[key] ?? fallback);
  if (!Number.isInteger(n) || n < min) throw new Error(`Invalid ${key}`);
  return n;
}
export function config(mode: Config['mode'], env = process.env): Config {
  const username = env.USERNAME || env.SITE_USERNAME || '';
  const password = env.PASSWORD || env.SITE_PASSWORD || '';
  const bookId = env.BOOK_ID || '';
  if (
    mode === 'extract' &&
    (!username || !password || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(bookId))
  )
    throw new Error('Set USERNAME, PASSWORD and a UUID BOOK_ID in .env.');
  const host = env.HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new Error('Only loopback HOST is supported.');
  const schoolLoginOrigin = env.SCHOOL_LOGIN_ORIGIN || '';
  if (
    schoolLoginOrigin &&
    (new URL(schoolLoginOrigin).origin !== schoolLoginOrigin ||
      !schoolLoginOrigin.startsWith('https://'))
  )
    throw new Error('SCHOOL_LOGIN_ORIGIN must be an exact HTTPS origin.');
  const schoolGroup = env.SCHOOL_GROUP || 'SECONDARY';
  if (!['PRIMARY', 'SECONDARY'].includes(schoolGroup))
    throw new Error('SCHOOL_GROUP must be PRIMARY or SECONDARY');
  return {
    mode,
    host,
    port: integer(env, mode === 'view' ? 'VIEW_PORT' : 'PORT', mode === 'view' ? 3001 : 3000),
    username,
    password,
    bookId,
    schoolName: env.SCHOOL_NAME || 'ZAAM',
    schoolGroup,
    appUsername: env.APP_USERNAME || 'local',
    appPassword: env.APP_PASSWORD || '',
    outputDir: resolve(env.OUTPUT_DIR || 'output'),
    dataDir: resolve(env.DATA_DIR || 'data'),
    headless: env.HEADLESS === 'true',
    maxPages: integer(env, 'MAX_PAGES', 500),
    maxMinutes: integer(env, 'MAX_JOB_MINUTES', 120),
    delayMs: integer(env, 'REQUEST_DELAY_MS', 1000, 0),
    maxAssetBytes: integer(env, 'MAX_ASSET_MB', 25) * 1024 ** 2,
    maxJobBytes: integer(env, 'MAX_JOB_MB', 1000) * 1024 ** 2,
    schoolLoginOrigin,
  };
}
export function bookUrl(c: Config) {
  return c.testOrigin
    ? `${c.testOrigin}/se/content/book/${c.bookId}`
    : `https://apps.noordhoff.nl/se/content/book/${c.bookId}`;
}
