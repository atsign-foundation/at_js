import { AtError } from './error.js';

/** The most events and stream errors a subscription buffers for an app that is not consuming them. */
export const MAX_BUFFERED_EVENTS = 4096;

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
  private readonly buffer: T[] = [];
  private waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private failures: unknown[] = [];
  private done = false;
  private overflowed = false;

  constructor(private readonly onDone: () => void) {}

  push(value: T): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else if (this.pending < MAX_BUFFERED_EVENTS) this.buffer.push(value);
    else this.overflow();
  }

  /** Events and failures a reader has not taken yet. */
  private get pending(): number {
    return this.buffer.length + this.failures.length;
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
    else if (this.pending < MAX_BUFFERED_EVENTS) this.failures.push(error);
    else this.overflow();
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    this.buffer.length = 0;
    this.failures = [];
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
    if (this.failures.length > 0) return Promise.reject(this.failures.shift());
    if (this.buffer.length > 0) {
      return Promise.resolve({ value: this.buffer.shift() as T, done: false });
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
