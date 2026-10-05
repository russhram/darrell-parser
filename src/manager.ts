import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Config } from './config.js';
import type { Job, Options } from './model.js';
import { Store } from './persistence.js';
export const defaultOptions: Options = {
  textMode: 'authorized_verbatim',
  textPermission: 'authorized',
  imagePermission: 'authorized',
  languages: ['nl', 'en'],
  answerPolicy: 'visible_only',
};
export class Manager {
  worker?: ChildProcess;
  activeId?: string;
  events = new EventEmitter();
  constructor(
    public c: Config,
    public store: Store,
  ) {
    for (const job of store.list())
      if (
        [
          'queued',
          'authenticating',
          'discovering',
          'extracting',
          'validating',
          'rendering',
        ].includes(job.state)
      ) {
        job.state = 'partial';
        job.message = 'Previous process stopped; checkpoints retained. Resume explicitly.';
        store.save(job);
      }
  }
  create(): Job {
    const date = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      state: 'queued',
      stage: 'queued',
      createdAt: date,
      updatedAt: date,
      selectedIds: [],
      options: { ...defaultOptions },
      inventory: null,
      sections: [],
      report: null,
      message: '',
      cancelRequested: false,
    };
    this.store.save(job);
    return job;
  }
  start(id: string, operation: 'discover' | 'extract') {
    if (this.worker) throw new Error('Another worker is active');
    const job = this.store.get(id);
    if (!job) throw new Error('Unknown job');
    job.cancelRequested = false;
    job.state = 'queued';
    this.store.save(job);
    const source = import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js';
    // Runtime environment is inherited by the child, but never serialized into state/export.
    const child = fork(new URL(source, import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: process.execArgv.filter((a) => !a.startsWith('--env-file')),
    });
    this.worker = child;
    this.activeId = id;
    child.on('message', () => this.events.emit(id));
    child.on('exit', () => {
      const latest = this.store.get(id);
      if (
        latest &&
        ![
          'completed',
          'partial',
          'failed',
          'cancelled',
          'needs_user_action',
          'awaiting_scope',
        ].includes(latest.state)
      ) {
        latest.state = 'partial';
        latest.message = 'Worker interrupted; resume saved checkpoints.';
        this.store.save(latest);
      }
      this.worker = undefined;
      this.activeId = undefined;
      this.events.emit(id);
    });
    child.send({ action: 'run', config: this.c, id, operation });
  }
  cancel(id: string) {
    const job = this.store.get(id);
    if (!job) throw new Error('Unknown job');
    job.cancelRequested = true;
    this.store.save(job);
    if (this.activeId === id) this.worker?.send({ action: 'cancel' });
    else {
      job.state = 'cancelled';
      this.store.save(job);
    }
  }
  async close() {
    const child = this.worker;
    if (child) {
      child.send({ action: 'cancel' });
      await new Promise<void>((r) => {
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          r();
        });
      });
    }
  }
}
