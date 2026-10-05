import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/viewer', { recursive: true });
await cp('src/viewer', 'dist/viewer', { recursive: true });
await cp('schemas', 'dist/schemas', { recursive: true });
await cp('profiles', 'dist/profiles', { recursive: true });
