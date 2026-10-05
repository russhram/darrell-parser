import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
export const jobSchema = JSON.parse(
  readFileSync(new URL('../schemas/job.schema.json', import.meta.url), 'utf8'),
);
const bookValidator = ajv.compile(
  JSON.parse(readFileSync(new URL('../schemas/book.schema.json', import.meta.url), 'utf8')),
);
export function validateBook(value: unknown): void {
  if (!bookValidator(value)) throw new Error('Canonical book does not match the bundled schema');
}
