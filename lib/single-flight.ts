/**
 * ONE RUN AT A TIME.
 *
 * A disabled button is one React render away from the tap that disabled it, so
 * a thumb tapping five times on a slow phone can start five requests before the
 * first re-render lands. When the request sends an e-mail, that is five e-mails
 * for one intent.
 *
 * A gate closes that window because it flips synchronously: the first call sets
 * `busy` in the same tick it is made, and every call after it returns `false`
 * without touching the work. The gate reopens when the run settles — including
 * when it throws, so a failed send never locks the button for good.
 */
export type Gate = {
  /** True while a run is in flight. */
  readonly busy: boolean;
  /** Runs `fn` unless a run is already in flight. Resolves to whether it ran. */
  run(fn: () => Promise<void>): Promise<boolean>;
};

export function createGate(): Gate {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(fn: () => Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try {
        await fn();
      } finally {
        busy = false;
      }
      return true;
    },
  };
}
