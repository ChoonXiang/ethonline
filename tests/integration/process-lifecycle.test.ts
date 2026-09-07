import assert from "node:assert/strict";
import { test } from "node:test";
import { startProcess } from "../helpers/process";

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`worker starts without integrations and exits cleanly on ${signal}`, { timeout: 10_000 }, async (t) => {
    const worker = startProcess(t, ["--import", "tsx", "workers/recovery/main.ts"], {
      RECOVERY_WORKER_HEARTBEAT_MS: "1000",
    });
    const startup = await worker.ready;
    assert.equal(startup.event, "worker.started");
    assert.equal(startup.recoveryEnabled, false);
    assert.equal(worker.child.kill(signal), true);
    assert.deepEqual(await worker.exited, { code: 0, signal: null });
  });
}

test("stopping the demo process creates an independently observable outage", { timeout: 10_000 }, async (t) => {
  const demo = startProcess(t, ["demo/api/main.mjs"], {
    DEMO_HOST: "127.0.0.1",
    DEMO_PORT: "0",
  });
  const startup = await demo.ready;
  const endpoint = `http://127.0.0.1:${startup.port}/healthz`;
  assert.equal((await fetch(endpoint)).status, 200);
  assert.equal(demo.child.kill("SIGTERM"), true);
  assert.deepEqual(await demo.exited, { code: 0, signal: null });
  await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(1_000) }));
});
