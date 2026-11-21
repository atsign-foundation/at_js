import { AtError } from './error.js';

/** The most events and stream errors a subscription buffers for an app that is not consuming them. */
export const MAX_BUFFERED_EVENTS = 4096;

type QueueEntry<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * A buffer of at most `MAX_BUFFERED_EVENTS` events and errors together, read as an async iterator.
 * `end()` and `return()` finish it: waiting readers settle done, the buffer is
 * dropped, later pushes are ignored and `onDone` runs once. A push past the
 * cap ends it the same way: on overflow the subscription ends, buffered events
 * are discarded, and `next()` rejects with `AtError('overflow')`; after that it
 * is done. `fail(error)` makes one `next()` reject with [error] without ending
 * the stream; unread errors count against the same cap.
 */
export class EventQueue<T> implements AsyncIterableIterator<T> {
  private readonly entries: QueueEntry<T>[] = [];
  private waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private done = false;
  private overflowed = false;

  constructor(private readonly onDone: () => void) {}

  push(value: T): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else if (this.entries.length < MAX_BUFFERED_EVENTS) this.entries.push({ ok: true, value });
    else this.overflow();
  }

  private overflow(): void {
    this.overflowed = true;
    this.end();
  }

  /** Makes the next `next()` reject with [error]; the stream carries on after it. */
  fail(error: unknown): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.reject(error);
    else if (this.entries.length < MAX_BUFFERED_EVENTS) this.entries.push({ ok: false, error });
    else this.overflow();
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    this.entries.length = 0;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve({ value: undefined, done: true });
    this.onDone();
  }

  next(): Promise<IteratorResult<T>> {
    if (this.overflowed) {
      this.overflowed = false;
      return Promise.reject(
        new AtError(`the subscription buffered more than ${MAX_BUFFERED_EVENTS} events`, 'overflow'),
      );
    }
    const entry = this.entries.shift();
    if (entry !== undefined) {
      return entry.ok ? Promise.resolve({ value: entry.value, done: false }) : Promise.reject(entry.error);
    }
    if (this.done) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  return(): Promise<IteratorResult<T>> {
    this.end();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): this {
    return this;
  }
}
