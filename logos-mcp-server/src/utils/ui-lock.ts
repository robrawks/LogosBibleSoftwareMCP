/**
 * ui-lock.ts
 *
 * Serialises every operation that drives the Logos UI (mouse drags, key
 * strokes, `open logos4:` dispatches, window screenshots). MCP clients may
 * invoke tools concurrently; two UI operations interleaving would mix their
 * drags and keystrokes on screen. Not re-entrant: composite operations must
 * take the lock once and call the unlocked internals.
 */

let tail: Promise<void> = Promise.resolve();

export async function withUiLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const previous = tail;
  tail = previous.then(() => mine);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
