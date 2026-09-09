import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleMonitoring } from "../../backend/monitoring/scheduler";

test("scheduling allows a full interval after dispatch delays without skipping the next check", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 0 });
  const startedAt: number[] = [];
  let dueAt = 0;
  const stop = scheduleMonitoring({
    tick: async () => {
      // The first database scan takes 10 ms before this application can be claimed.
      if (!startedAt.length) t.mock.timers.setTime(Date.now() + 10);
      if (Date.now() < dueAt) return;
      startedAt.push(Date.now());
      dueAt = Date.now() + 5_000;
    },
  }, () => assert.fail("the scheduler must not fail"));
  t.after(stop);
  await Promise.resolve();
  t.mock.timers.tick(4_990);
  await Promise.resolve();
  t.mock.timers.tick(10);
  await Promise.resolve();
  assert.deepEqual(startedAt, [10, 5_010]);
  stop();
  t.mock.timers.tick(10_000);
  assert.equal(startedAt.length, 2);
});

test("stopping during a pending tick prevents rescheduling", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 0 });
  let finish!: () => void;
  let calls = 0;
  const stop = scheduleMonitoring({
    tick: () => { calls++; return new Promise<void>((resolve) => { finish = resolve; }); },
  }, () => assert.fail("the scheduler must not fail"));
  stop();
  finish();
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  assert.equal(calls, 1);
});

test("a storage failure is reported and stops further polling", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 0 });
  let failures = 0;
  let calls = 0;
  const stop = scheduleMonitoring({
    tick: async () => { calls++; throw new Error("storage unavailable"); },
  }, () => { failures++; });
  t.after(stop);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  assert.equal(failures, 1);
  assert.equal(calls, 1);
});
