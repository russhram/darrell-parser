import { lookup } from 'node:dns/promises';
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function safeUrl(input: string) {
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    u.username = '';
    u.password = '';
    u.search = '';
    if (!/^#[\w/.-]*$/.test(u.hash)) u.hash = '';
    return u.href;
  } catch {
    return '';
  }
}
export function safeId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid ID');
  return id;
}
export async function confined(root: string, path: string) {
  const base = await realpath(root);
  const file = await realpath(resolve(root, path));
  if (!file.startsWith(base + sep)) throw new Error('Path outside package');
  return file;
}
export function publicIp(address: string) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === 'unicast';
  } catch {
    return false;
  }
}
export class NetworkPolicy {
  constructor(
    public allowedOrigins: string[],
    private testOrigin?: string,
  ) {}
  async check(input: string) {
    const u = new URL(input);
    if (u.username || u.password || !this.allowedOrigins.includes(u.origin))
      throw new Error('Origin not allowed');
    if (this.testOrigin && u.origin === this.testOrigin) return;
    if (u.protocol !== 'https:') throw new Error('HTTPS required');
    const addresses = await lookup(u.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
      throw new Error('Private address blocked');
  }
}
