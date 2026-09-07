import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorkerConfig } from "../../backend/config/worker";

test("worker uses a 30-second heartbeat unless explicitly configured", () => {
  assert.equal(readWorkerConfig({}).heartbeatIntervalMs, 30_000);
  assert.equal(
    readWorkerConfig({ RECOVERY_WORKER_HEARTBEAT_MS: "1000" }).heartbeatIntervalMs,
    1_000,
  );
});

test("worker rejects intervals that could create an accidental tight loop", () => {
  const invalidValues = [
    "", " ", "0", "-1", "999", "1000.5", "1e3", "60001", "Infinity",
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => readWorkerConfig({ RECOVERY_WORKER_HEARTBEAT_MS: value }),
      /RECOVERY_WORKER_HEARTBEAT_MS must be an integer from 1000 to 60000/,
    );
  }
});
