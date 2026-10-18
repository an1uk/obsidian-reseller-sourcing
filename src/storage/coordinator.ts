/** One vault-wide mutation lane shared by live and practice notebooks. */
export class MutationCoordinator {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => {});
    return next;
  }
}
