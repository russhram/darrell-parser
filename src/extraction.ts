import type { Frame } from 'playwright';
import type { NoordhoffAdapter } from './adapters/noordhoff.js';
import type { InventoryItem, Language, Pair, Provenance, Section } from './model.js';
import { sha, safeUrl } from './security.js';

export interface Raw {
  title: string;
  blocks: {
    key: string;
    kind: string;
    text: string;
    emphasis: string[];
    rows?: string[][];
    rowSpans?: number[][];
    colSpans?: number[][];
  }[];
  questions: {
    key: string;
    displayId: string;
    kind: string;
    text: string;
    subparts: { key: string; text: string }[];
    options: { key: string; text: string }[];
    answer: string | null;
    feedback: string | null;
  }[];
  visuals: {
    key: string;
    sourceId: string;
    caption: string;
    url: string;
    kind: string;
    attribution: string | null;
    license: string | null;
  }[];
}
export async function readFrame(frame: Frame, main: string, question: string): Promise<Raw> {
  return frame.evaluate(
    ({ main, question }) => {
      const root = document.querySelector(main);
      if (!root) return { title: '', blocks: [], questions: [], visuals: [] };
      const visible = (n: Element) => {
        const style = getComputedStyle(n);
        return (
          !n.closest('[hidden], [aria-hidden="true"]') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };
      const text = (n: Element | null) =>
        n ? ((n as HTMLElement).innerText ?? n.textContent ?? '') : '';
      const key = (n: Element, prefix: string, i: number) =>
        n.getAttribute('data-id') ||
        n.getAttribute('data-question-id') ||
        n.getAttribute('data-source-id') ||
        n.id ||
        `${prefix}-${i}`;
      const blocks = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul,ol,table,math')]
        .filter(
          (n) =>
            visible(n) &&
            !n.closest(`${question}, nav, form, [data-account], [data-student-answer]`) &&
            !n.parentElement?.closest('ul,ol,table'),
        )
        .map((n, i) => {
          const table =
            n.tagName === 'TABLE'
              ? [...n.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')])
              : undefined;
          return {
            key: key(n, 'block', i),
            kind: n.tagName.toLowerCase(),
            text: n.tagName === 'MATH' ? n.textContent || '' : text(n),
            emphasis: [...n.querySelectorAll('strong,b,em,i,dfn')].map(text),
            ...(table
              ? {
                  rows: table.map((row) => row.map(text)),
                  rowSpans: table.map((row) => row.map((c) => (c as HTMLTableCellElement).rowSpan)),
                  colSpans: table.map((row) => row.map((c) => (c as HTMLTableCellElement).colSpan)),
                }
              : {}),
          };
        });
      const questions = [...root.querySelectorAll(question)].filter(visible).map((n, i) => {
        const prompt = n.querySelector('[data-prompt], .question-text, .exercise-text, legend');
        const copy = n.cloneNode(true) as HTMLElement;
        copy
          .querySelectorAll(
            'input,textarea,button,select,[data-student-answer],[data-answer],[data-feedback],.answer,.feedback',
          )
          .forEach((e) => e.remove());
        return {
          key: key(n, 'question', i),
          displayId: n.getAttribute('data-number') || `Q${i + 1}`,
          kind:
            n.getAttribute('data-kind') ||
            (n.querySelector('input[type="radio"]')
              ? 'single_choice'
              : n.querySelector('input[type="checkbox"]')
                ? 'multiple_choice'
                : 'short_text'),
          text: prompt ? text(prompt) : copy.textContent || '',
          subparts: [...n.querySelectorAll('[data-subpart], .subquestion')]
            .filter(visible)
            .map((s, j) => ({ key: key(s, 'subpart', j), text: text(s) })),
          options: [...n.querySelectorAll('[data-option-id], .option-label')]
            .filter(visible)
            .map((o, j) => ({
              key: o.getAttribute('data-option-id') || String(j + 1),
              text: text(o),
            })),
          answer:
            [...n.querySelectorAll('[data-answer], .model-answer')]
              .filter(visible)
              .map(text)
              .join('\n') || null,
          feedback:
            [...n.querySelectorAll('[data-feedback], .feedback')]
              .filter(visible)
              .map(text)
              .join('\n') || null,
        };
      });
      const visuals = [
        ...root.querySelectorAll('img, svg, canvas, [data-source-id][data-image-url]'),
      ]
        .filter(visible)
        .map((n, i) => {
          const figure = n.closest('figure, [data-source-id]');
          return {
            key: key(figure || n, 'visual', i),
            sourceId: figure?.getAttribute('data-source-id') || '',
            caption:
              text(figure?.querySelector('figcaption, .caption') || null) ||
              n.getAttribute('alt') ||
              '',
            url:
              (n as HTMLImageElement).currentSrc ||
              n.getAttribute('src') ||
              n.getAttribute('data-image-url') ||
              '',
            kind: n.tagName.toLowerCase(),
            attribution: figure?.getAttribute('data-attribution') || null,
            license: figure?.getAttribute('data-license') || null,
          };
        });
      return { title: text(root.querySelector('h1,h2')), blocks, questions, visuals };
    },
    { main, question },
  );
}
const pair = (): Pair => ({ nl: null, en: null });
export async function extract(
  adapter: NoordhoffAdapter,
  item: InventoryItem,
  languages: Language[],
): Promise<{ section: Section; assets: Map<string, string>; snapshots: Map<string, string> }> {
  const section: Section = {
    id: item.id,
    chapterId: item.chapterId,
    title: { ...item.title },
    kind: item.kind,
    status: 'captured',
    blocks: [],
    questions: [],
    visuals: [],
    gaps: [],
  };
  const assets = new Map<string, string>(),
    snapshots = new Map<string, string>();
  let originalHash = '';
  for (const lang of languages) {
    if (!(await adapter.language(lang))) {
      section.gaps.push(`native_language_unavailable:${lang}`);
      continue;
    }
    for (const [frameIndex, frame] of (await adapter.frames()).entries()) {
      if (
        frameIndex > 0 &&
        !((await frame.locator('html').getAttribute('lang')) || '').startsWith(lang)
      ) {
        section.gaps.push(`frame_language_unavailable:${frameIndex}:${lang}`);
        continue;
      }
      const root = frame.locator(adapter.p.main).first();
      if (!(await root.count())) continue;
      // Trigger lazy educational media without clicking exercise actions.
      await root.evaluate(async (el) => {
        const target = el as HTMLElement;
        const old = target.scrollTop;
        target.scrollTop = target.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 100));
        target.scrollTop = old;
      });
      const raw = await readFrame(frame, adapter.p.main, adapter.p.question);
      const contentHash = sha(JSON.stringify({ blocks: raw.blocks, questions: raw.questions }));
      if (!originalHash) originalHash = contentHash;
      else if (
        lang !== languages[0] &&
        contentHash === originalHash &&
        raw.blocks.some((b) => b.text.length > 30)
      ) {
        section.gaps.push(`native_language_unchanged:${lang}`);
        continue;
      }
      if (raw.title && frameIndex === 0) section.title[lang] = raw.title;
      const prefix = `${adapter.c.bookId}/${item.chapterId}/${item.id}/frame-${frameIndex}`;
      const prov = (key: string, value: string): Provenance => ({
        sourceUrl: safeUrl(frame.url()),
        locator: key,
        capturedAt: new Date().toISOString(),
        hash: sha(value),
      });
      for (const b of raw.blocks) {
        const id = `${prefix}/${b.key}`;
        let block = section.blocks.find((x) => x.id === id);
        if (!block) {
          block = {
            id,
            kind: b.kind,
            text: pair(),
            emphasis: b.emphasis,
            visualRefs: [],
            provenance: prov(b.key, b.text),
            ...(b.rows
              ? {
                  rows: b.rows.map((row) => row.map(() => pair())),
                  rowSpans: b.rowSpans,
                  colSpans: b.colSpans,
                }
              : {}),
          };
          section.blocks.push(block);
        }
        block.text[lang] = b.text;
        b.rows?.forEach((row, i) =>
          row.forEach((cell, j) => {
            if (block!.rows?.[i]?.[j]) block!.rows[i][j][lang] = cell;
            else section.gaps.push(`table_alignment:${id}`);
          }),
        );
      }
      for (const q of raw.questions) {
        const id = `${prefix}/${q.key}`;
        let question = section.questions.find((x) => x.id === id);
        if (!question) {
          question = {
            id,
            displayId: q.displayId,
            kind: q.kind,
            text: pair(),
            subparts: q.subparts.map((s) => ({ id: s.key, text: pair() })),
            options: q.options.map((o) => ({ id: o.key, text: pair() })),
            answers: [],
            visualRefs: [],
            status: 'captured',
            provenance: prov(q.key, q.text),
          };
          section.questions.push(question);
        }
        question.text[lang] = q.text;
        for (const [entries, target] of [
          [q.subparts, question.subparts],
          [q.options, question.options],
        ] as const) {
          for (const e of entries) {
            const t = target.find((t) => t.id === e.key);
            if (t) t.text[lang] = e.text;
            else {
              section.gaps.push(`question_alignment:${id}`);
              question.status = 'partial';
            }
          }
        }
        for (const [origin, value] of [
          ['visible_in_source', q.answer],
          ['feedback_only', q.feedback],
        ] as const) {
          if (!value) continue;
          let answer = question.answers.find((a) => a.origin === origin);
          if (!answer) {
            answer = { origin, text: pair() };
            question.answers.push(answer);
          }
          answer.text[lang] = value;
        }
      }
      for (const v of raw.visuals) {
        const id = `${prefix}/${v.key}`;
        let visual = section.visuals.find((x) => x.id === id);
        if (!visual) {
          visual = {
            id,
            sourceId: v.sourceId,
            kind: v.kind,
            caption: pair(),
            description: pair(),
            attribution: v.attribution,
            license: v.license,
            sourceUrl: safeUrl(v.url) || safeUrl(frame.url()),
            file: null,
            hash: null,
            bytes: 0,
            assetStatus: 'inspection_pending',
            inspectionStatus: 'inspection_pending',
          };
          section.visuals.push(visual);
        }
        visual.caption[lang] = v.caption;
        if (v.url) assets.set(id, v.url);
      }
      // Reconstruct passive HTML from normalized source blocks; never persist raw app DOM.
      snapshots.set(`${item.id}-${lang}-${frameIndex}`, JSON.stringify(raw.blocks));
    }
  }
  for (const q of section.questions) {
    if (!q.answers.length) q.answers.push({ origin: 'unavailable', text: pair() });
    q.visualRefs = section.visuals
      .filter((v) => v.sourceId && Object.values(q.text).some((t) => t?.includes(v.sourceId)))
      .map((v) => v.id);
    if (q.visualRefs.some((id) => !assets.has(id))) q.status = 'partial';
  }
  for (const b of section.blocks)
    b.visualRefs = section.visuals
      .filter((v) => v.sourceId && Object.values(b.text).some((t) => t?.includes(v.sourceId)))
      .map((v) => v.id);
  if (!section.blocks.length && !section.questions.length) {
    section.status = 'unavailable';
    section.gaps.push('No readable learning content');
  } else if (section.gaps.length) section.status = 'partial';
  return { section, assets, snapshots };
}
