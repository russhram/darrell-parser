import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Book, Pair, Block, Section } from './model.js';
import { atomicJson } from './persistence.js';
import { escapeHtml as h, sha } from './security.js';
const anchor = (id: string) => 's-' + sha(id).slice(0, 20);
export function languagePair(p: Pair): string {
  return (['nl', 'en'] as const)
    .map(
      (lang) =>
        `<div data-lang="${lang}" lang="${lang}" class="language"><span class="badge">${lang.toUpperCase()} · ${p[lang] === null ? 'missing / ontbreekt' : 'site source / bron'}</span>${p[lang] === null ? `<p class="missing">${lang === 'nl' ? 'Deze taalversie ontbreekt.' : 'This language version is unavailable.'}</p>` : `<p>${h(p[lang]).replace(/\n/g, '<br>')}</p>`}</div>`,
    )
    .join('');
}
function blockHtml(b: Block) {
  if (b.kind === 'table' && b.rows)
    return `<div class="table-wrap">${(['nl', 'en'] as const).map((lang) => `<table data-lang="${lang}" lang="${lang}"><tbody>${b.rows!.map((row, i) => `<tr>${row.map((cell, j) => `<${i === 0 ? 'th' : 'td'} rowspan="${b.rowSpans?.[i]?.[j] || 1}" colspan="${b.colSpans?.[i]?.[j] || 1}">${cell[lang] === null ? '<span class="missing">Translation pending</span>' : h(cell[lang])}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}</div>`;
  return `<div class="block ${/^h[1-6]$/.test(b.kind) ? 'heading' : ''}" id="${anchor(b.id)}">${languagePair(b.text)}</div>`;
}
function sectionHtml(s: Section) {
  return `<section class="study-section" id="${anchor(s.id)}" data-search><h2>${languagePair(s.title)}</h2><p class="badge">${h(s.kind)} · ${h(s.status)}</p>${s.gaps.map((g) => `<p class="missing">${h(g)}</p>`).join('')}${s.blocks.map(blockHtml).join('')}${s.questions.map((q) => `<article class="question" id="${anchor(q.id)}"><h3>${h(q.displayId)} · ${h(q.kind)}</h3>${languagePair(q.text)}${q.subparts.map((p) => `<div>${h(p.id)}${languagePair(p.text)}</div>`).join('')}<ol>${q.options.map((o) => `<li value="${Math.max(1, Number(o.id) || q.options.indexOf(o) + 1)}"><b>${h(o.id)}</b>${languagePair(o.text)}</li>`).join('')}</ol>${q.visualRefs.map((id) => `<a href="#${anchor(id)}">Source / Bron</a>`).join(' ')}<details class="answer"><summary><span data-lang="nl">Opgeslagen antwoord</span><span data-lang="en">Saved answer</span></summary>${q.answers.map((a) => `<p class="badge">${h(a.origin)}</p>${a.origin === 'unavailable' ? '<p>Unavailable / Niet beschikbaar</p>' : languagePair(a.text)}`).join('')}</details></article>`).join('')}${s.visuals.map((v) => `<figure id="${anchor(v.id)}">${v.file ? `<img src="${h(v.file)}" alt="${h(v.caption.nl || v.caption.en || v.sourceId)}" loading="lazy">` : '<p class="missing">Image unavailable / Afbeelding niet beschikbaar</p>'}<figcaption>${h(v.sourceId)}${languagePair(v.caption)}${languagePair(v.description)}<p>${h(v.attribution)} ${h(v.license)}</p><p class="badge">${h(v.assetStatus)} · ${h(v.inspectionStatus)}</p></figcaption></figure>`).join('')}</section>`;
}
export function renderHtml(book: Book): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'"><title>${h(book.title.nl || book.title.en || 'Study book')}</title><link rel="stylesheet" href="viewer.css"><script src="viewer.js" defer></script></head><body><header><h1>${languagePair(book.title)}</h1><label><span data-lang="nl">Taal</span><span data-lang="en">Language</span><select id="language"><option value="nl">Nederlands</option><option value="en">English</option><option value="both">NL + EN</option></select></label><label><span data-lang="nl">Zoeken</span><span data-lang="en">Search</span><input type="search" id="search"></label><button id="print"><span data-lang="nl">Afdrukken</span><span data-lang="en">Print</span></button><label><input id="print-answers" type="checkbox"><span data-lang="nl">Antwoorden afdrukken</span><span data-lang="en">Print answers</span></label><p class="status">${h(book.report.status)} · ${book.report.inspected} / ${book.report.expected ?? '?'} sections · ${book.report.translationPending} missing language blocks</p></header><div class="layout"><nav aria-label="Table of contents"><ul>${book.sections.map((s) => `<li><a href="#${anchor(s.id)}">${languagePair(s.title)}</a></li>`).join('')}</ul></nav><main><details><summary><span data-lang="nl">Volledigheidsrapport</span><span data-lang="en">Coverage report</span></summary><ul>${book.report.limitations.map((l) => `<li>${h(l)}</li>`).join('')}</ul></details>${book.sections.map(sectionHtml).join('')}</main></div></body></html>`;
}
const mdEscape = (s: string) => s.replace(/[\\`*_{}[\]<>|]/g, '\\$&');
const mdPair = (p: Pair) =>
  `*${mdEscape(p.nl ?? '[NL unavailable]')}*\n\n${mdEscape(p.en ?? '[EN unavailable]')}\n\n`;
export function renderMarkdown(book: Book, sections = book.sections) {
  return (
    `# ${mdEscape(book.title.nl || book.title.en || 'Book')}\n\nStatus: ${book.report.status}; mode: authorized_verbatim; language versions: site source.\n\n` +
    sections
      .map(
        (s) =>
          `## ${s.id}\n\n${mdPair(s.title)}${s.blocks.map((b) => (b.rows ? b.rows.map((row) => row.map(mdPair).join(' | ')).join('\n') + '\n\n' : mdPair(b.text))).join('')}${s.questions.map((q) => `### ${q.displayId} (${q.id})\n\n${mdPair(q.text)}${q.subparts.map((p) => `${p.id}\n\n${mdPair(p.text)}`).join('')}${q.options.map((o) => `${o.id}\n\n${mdPair(o.text)}`).join('')}${q.answers.map((a) => `Answer origin: ${a.origin}\n\n${mdPair(a.text)}`).join('')}`).join('')}${s.visuals.map((v) => `${v.file ? `![${mdEscape(v.sourceId || 'Source')}](../../viewer/${v.file})\n\n` : ''}${mdPair(v.caption)}Status: ${v.assetStatus}; inspection: ${v.inspectionStatus}\n\n`).join('')}${s.gaps.map((g) => `- ${mdEscape(g)}\n`).join('')}`,
      )
      .join('\n')
  );
}
export async function exportBook(book: Book, root: string) {
  await mkdir(join(root, 'viewer'), { recursive: true, mode: 0o700 });
  await atomicJson(join(root, 'data/book.json'), book);
  await atomicJson(join(root, 'scope-inventory.json'), book.inventory);
  await atomicJson(join(root, 'extraction-report.json'), book.report);
  await atomicJson(join(root, 'manifest.json'), {
    schemaVersion: book.schemaVersion,
    bookId: book.bookId,
    adapterVersion: book.adapterVersion,
    capturedAt: book.capturedAt,
    status: book.report.status,
    sourceUrl: book.sourceUrl,
    languages: ['nl', 'en'],
  });
  await atomicJson(
    join(root, 'viewer/media/media-manifest.json'),
    book.sections.flatMap((s) => s.visuals),
  );
  for (const chapterId of new Set(book.sections.map((s) => s.chapterId))) {
    const sections = book.sections.filter((s) => s.chapterId === chapterId);
    const filename = 'chapter-' + sha(chapterId).slice(0, 16);
    await atomicJson(join(root, 'data/chapters', `${filename}.json`), {
      schemaVersion: '1.0',
      id: chapterId,
      sections,
    });
    await mkdir(join(root, 'content/chapters'), { recursive: true, mode: 0o700 });
    await writeFile(
      join(root, 'content/chapters', `${filename}_content_EN-NL.md`),
      renderMarkdown(book, sections),
      { mode: 0o600 },
    );
  }
  await writeFile(
    join(root, 'extraction-report.md'),
    `# Coverage\n\n\`\`\`json\n${JSON.stringify(book.report, null, 2)}\n\`\`\`\n`,
    { mode: 0o600 },
  );
  await writeFile(join(root, 'viewer/index.html'), renderHtml(book), { mode: 0o600 });
  for (const asset of ['viewer.css', 'viewer.js'])
    await copyFile(new URL(`./viewer/${asset}`, import.meta.url), join(root, 'viewer', asset));
}
export async function readBook(path: string): Promise<Book> {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const { validateBook } = await import('./schemas.js');
  validateBook(data);
  return data as Book;
}
