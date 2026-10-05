export type Language = 'nl' | 'en';
export type Status = 'captured' | 'partial' | 'unavailable' | 'excluded' | 'unsupported';
export type JobState =
  | 'queued'
  | 'authenticating'
  | 'discovering'
  | 'needs_user_action'
  | 'awaiting_scope'
  | 'extracting'
  | 'validating'
  | 'rendering'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';
export interface Pair {
  nl: string | null;
  en: string | null;
}
export interface Provenance {
  sourceUrl: string;
  locator: string;
  capturedAt: string;
  hash: string;
}
export interface Block {
  id: string;
  kind: string;
  text: Pair;
  emphasis?: string[];
  rows?: Pair[][];
  rowSpans?: number[][];
  colSpans?: number[][];
  visualRefs: string[];
  provenance: Provenance;
}
export interface Answer {
  origin: 'visible_in_source' | 'feedback_only' | 'unavailable';
  text: Pair;
}
export interface Question {
  id: string;
  displayId: string;
  kind: string;
  text: Pair;
  subparts: { id: string; text: Pair }[];
  options: { id: string; text: Pair }[];
  answers: Answer[];
  visualRefs: string[];
  status: Status;
  provenance: Provenance;
}
export interface Visual {
  id: string;
  sourceId: string;
  kind: string;
  caption: Pair;
  description: Pair;
  attribution: string | null;
  license: string | null;
  sourceUrl: string;
  file: string | null;
  hash: string | null;
  bytes: number;
  assetStatus: 'asset_saved' | 'not_authorized' | 'download_failed' | 'inspection_pending';
  inspectionStatus: 'inspection_pending';
  reason?: string;
}
export interface InventoryItem {
  id: string;
  parentId: string | null;
  title: Pair;
  kind: string;
  order: number;
  url: string;
  locator?: string;
  chapterId: string;
}
export interface Inventory {
  schemaVersion: '1.0';
  bookId: string;
  title: Pair;
  items: InventoryItem[];
  reliable: boolean;
  limitations: string[];
}
export interface Section {
  id: string;
  chapterId: string;
  title: Pair;
  kind: string;
  status: Status;
  blocks: Block[];
  questions: Question[];
  visuals: Visual[];
  gaps: string[];
}
export interface Report {
  status: 'completed' | 'partial';
  expected: number | null;
  discovered: number;
  inspected: number;
  captured: number;
  partial: number;
  unavailable: number;
  excluded: number;
  unsupported: number;
  questions: number;
  subparts: number;
  visibleAnswers: number;
  feedbackAnswers: number;
  missingAnswers: number;
  images: number;
  savedImages: number;
  translationPending: number;
  limitations: string[];
}
export interface Book {
  schemaVersion: '1.0';
  adapterVersion: string;
  bookId: string;
  title: Pair;
  originalLanguage: Language;
  sourceUrl: string;
  capturedAt: string;
  inventory: Inventory;
  sections: Section[];
  report: Report;
}
export interface Options {
  textMode: 'authorized_verbatim' | 'concise_notes';
  textPermission: 'authorized' | 'unknown' | 'public_domain' | 'user_owned';
  imagePermission: 'authorized' | 'unknown' | 'public_domain' | 'user_owned';
  languages: Language[];
  answerPolicy: 'visible_only';
}
export interface Job {
  id: string;
  state: JobState;
  stage: string;
  createdAt: string;
  updatedAt: string;
  selectedIds: string[];
  options: Options;
  inventory: Inventory | null;
  sections: Section[];
  report: Report | null;
  message: string;
  cancelRequested: boolean;
}
