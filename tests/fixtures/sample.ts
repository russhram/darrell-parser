import type { Book, Job } from '../../src/model.js';
import { defaultOptions } from '../../src/manager.js';
import { sha } from '../../src/security.js';
import { report } from '../../src/validation.js';
export function sample(): { job: Job; book: Book } {
  const pair = { nl: 'Rivier', en: 'River' };
  const job: Job = {
    id: 'fixture-job',
    state: 'partial',
    stage: 'rendering',
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
    selectedIds: ['section-1'],
    options: defaultOptions,
    inventory: {
      schemaVersion: '1.0',
      bookId: 'fixture',
      title: pair,
      reliable: true,
      limitations: [],
      items: [
        {
          id: 'section-1',
          parentId: null,
          title: pair,
          kind: 'theory',
          order: 0,
          url: 'https://apps.noordhoff.nl/se/content/book/fixture/theory',
          chapterId: 'chapter-1',
        },
      ],
    },
    sections: [
      {
        id: 'section-1',
        chapterId: 'chapter-1',
        title: pair,
        kind: 'theory',
        status: 'captured',
        blocks: [
          {
            id: 'block-1',
            kind: 'p',
            text: { nl: 'Een rivier stroomt naar de zee.', en: 'A river flows to the sea.' },
            visualRefs: [],
            provenance: {
              sourceUrl: 'https://apps.noordhoff.nl/se/content/book/fixture/theory',
              locator: 'p',
              capturedAt: '2026-10-05T00:00:00Z',
              hash: sha('test'),
            },
          },
        ],
        questions: [
          {
            id: 'question-1',
            displayId: 'Q1.1.1',
            kind: 'short_text',
            text: { nl: 'Waar stroomt de rivier naartoe?', en: 'Where does the river flow?' },
            subparts: [],
            options: [{ id: 'A', text: { nl: 'De zee', en: 'The sea' } }],
            answers: [
              { origin: 'visible_in_source', text: { nl: 'Naar de zee', en: 'To the sea' } },
            ],
            visualRefs: [],
            status: 'captured',
            provenance: {
              sourceUrl: 'https://apps.noordhoff.nl/se/content/book/fixture/theory',
              locator: 'question-1',
              capturedAt: '2026-10-05T00:00:00Z',
              hash: sha('question'),
            },
          },
        ],
        visuals: [],
        gaps: [],
      },
    ],
    report: null,
    message: 'Fixture',
    cancelRequested: false,
  };
  job.report = report(job);
  return {
    job,
    book: {
      schemaVersion: '1.0',
      adapterVersion: 'fixture',
      bookId: 'fixture',
      title: pair,
      originalLanguage: 'nl',
      sourceUrl: 'https://apps.noordhoff.nl/se/content/book/fixture',
      capturedAt: job.createdAt,
      inventory: job.inventory!,
      sections: job.sections,
      report: job.report,
    },
  };
}
