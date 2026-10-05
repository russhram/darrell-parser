import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { Config } from './config.js';
import type { Visual } from './model.js';
import { NetworkPolicy, sha } from './security.js';
export function imageExtension(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'webp';
  return null;
}
export async function saveMedia(
  context: BrowserContext,
  visual: Visual,
  input: string | undefined,
  dir: string,
  policy: NetworkPolicy,
  c: Config,
  remaining: number,
) {
  if (!input) {
    visual.assetStatus = 'download_failed';
    visual.reason = 'No downloadable raster asset; visual inspection required';
    return;
  }
  let response;
  try {
    await policy.check(input);
    response = await context.request.get(input, { maxRedirects: 0, timeout: 30000 });
    if (response.status() === 429) throw new Error('Rate limited; resume later');
    if (
      !response.ok() ||
      !/^image\/(png|jpeg|gif|webp)(;|$)/i.test(response.headers()['content-type'] || '')
    )
      throw new Error('Not a supported raster image');
    const declared = Number(response.headers()['content-length']);
    if (!declared || declared > Math.min(c.maxAssetBytes, remaining))
      throw new Error('Asset size unknown or over limit');
    const bytes = await response.body();
    if (bytes.length > Math.min(c.maxAssetBytes, remaining)) throw new Error('Asset over limit');
    const extension = imageExtension(bytes);
    if (!extension) throw new Error('Invalid image bytes');
    const hash = sha(bytes),
      file = `${hash}.${extension}`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, file), bytes, { mode: 0o600 });
    Object.assign(visual, {
      hash,
      file: `media/${file}`,
      bytes: bytes.length,
      assetStatus: 'asset_saved',
    });
  } catch {
    visual.assetStatus = 'download_failed';
    visual.reason = 'Asset unavailable, blocked origin, redirect, unsupported format or size limit';
  } finally {
    await response?.dispose();
  }
}
