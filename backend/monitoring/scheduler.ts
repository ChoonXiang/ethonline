import { HEALTH_INTERVAL_MS } from "./types";

export function scheduleMonitoring(monitor: { tick(): Promise<void> }, onError: () => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    try {
      const pending = monitor.tick();
      // Claims are dispatched synchronously; schedule from the last possible claim,
      // so a delayed scan cannot cause the next five-second tick to be skipped.
      const nextTickAt = Date.now() + HEALTH_INTERVAL_MS;
      await pending;
      if (!stopped) timer = setTimeout(() => { void poll(); }, Math.max(0, nextTickAt - Date.now()));
    } catch {
      stopped = true;
      onError();
    }
  }
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}
