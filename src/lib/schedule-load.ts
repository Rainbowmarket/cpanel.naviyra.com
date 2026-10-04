/** Start external data loading after commit; cancel a pending load on cleanup. */
export function scheduleLoad(load: () => void | Promise<void>): () => void {
  const timer = window.setTimeout(() => {
    void Promise.resolve().then(load).catch((error: unknown) => {
      console.error("Data loading failed:", error);
    });
  }, 0);
  return () => window.clearTimeout(timer);
}
