import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { TestContext } from "node:test";

export function startProcess(
  t: TestContext,
  args: string[],
  env: Readonly<Record<string, string | undefined>> = {},
) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const events: Record<string, unknown>[] = [];
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });

  const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => reject(new Error(`Process exited before startup: ${stderr}`)));
    lines.on("line", (line) => {
      try {
        const event = JSON.parse(line);
        events.push(event);
        for (const listener of listeners) listener(event);
        if (event.event?.endsWith(".started")) resolve(event);
      } catch {
        // Runtime diagnostics are not service startup evidence.
      }
    });
  });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  t.after(async () => {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  });

  function waitForEvent(predicate: (event: Record<string, unknown>) => boolean, timeoutMs = 5_000) {
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); listeners.delete(listener); child.off("close", onClose); };
      const listener = (event: Record<string, unknown>) => {
        if (predicate(event)) { cleanup(); resolve(event); }
      };
      const onClose = () => { cleanup(); reject(new Error(`Process exited while waiting for an event: ${stderr}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for a process event")); }, timeoutMs);
      listeners.add(listener);
      child.once("close", onClose);
    });
  }

  return { child, ready, exited, events, waitForEvent };
}
