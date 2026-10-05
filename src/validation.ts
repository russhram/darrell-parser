import type { Job, Pair, Report } from './model.js';
export function report(job: Job): Report {
  const sections = job.sections,
    questions = sections.flatMap((s) => s.questions),
    visuals = sections.flatMap((s) => s.visuals);
  let translationPending = 0;
  const check = (p: Pair) => {
    if (job.options.languages.some((l) => p[l] === null)) translationPending++;
  };
  for (const s of sections) {
    check(s.title);
    for (const b of s.blocks) {
      check(b.text);
      b.rows?.flat().forEach(check);
    }
    for (const q of s.questions) {
      check(q.text);
      q.options.forEach((o) => check(o.text));
      q.subparts.forEach((o) => check(o.text));
      q.answers.filter((a) => a.origin !== 'unavailable').forEach((a) => check(a.text));
    }
    s.visuals.forEach((v) => check(v.caption));
  }
  const limitations = [...(job.inventory?.limitations || []), ...sections.flatMap((s) => s.gaps)];
  if (visuals.some((v) => v.inspectionStatus === 'inspection_pending'))
    limitations.push('Visual inspection pending; no chart/map values have been inferred.');
  if (translationPending)
    limitations.push('native_language_pending: some requested language versions are unavailable.');
  const count = (state: string) => sections.filter((s) => s.status === state).length;
  const r: Report = {
    status: 'partial',
    expected: job.inventory?.reliable ? job.selectedIds.length : null,
    discovered: job.inventory?.items.length || 0,
    inspected: sections.length,
    captured: count('captured'),
    partial: count('partial'),
    unavailable: count('unavailable'),
    excluded: count('excluded'),
    unsupported: count('unsupported'),
    questions: questions.length,
    subparts: questions.reduce((n, q) => n + q.subparts.length, 0),
    visibleAnswers: questions.filter((q) => q.answers.some((a) => a.origin === 'visible_in_source'))
      .length,
    feedbackAnswers: questions.filter((q) => q.answers.some((a) => a.origin === 'feedback_only'))
      .length,
    missingAnswers: questions.filter(
      (q) => !q.answers.some((a) => a.origin === 'visible_in_source'),
    ).length,
    images: visuals.length,
    savedImages: visuals.filter((v) => v.assetStatus === 'asset_saved').length,
    translationPending,
    limitations,
  };
  if (
    r.expected !== null &&
    sections.length === r.expected &&
    !r.partial &&
    !r.unavailable &&
    !r.unsupported &&
    !r.excluded &&
    !limitations.length
  )
    r.status = 'completed';
  return r;
}
