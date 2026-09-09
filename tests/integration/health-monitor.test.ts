import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerApplication } from "../../backend/applications/registration";
import { SqliteApplicationStore } from "../../backend/applications/sqlite-store";
import { HealthMonitor } from "../../backend/monitoring/monitor";
import { SqliteMonitoringStore } from "../../backend/monitoring/sqlite-store";
import { allowedOrigins, registration } from "../helpers/applications";

test("monitor discovers registrations after startup and never overlaps ticks for the same app", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "health-monitor-"));
  const path = join(directory, "applications.sqlite");
  const apps = new SqliteApplicationStore(path);
  const store = new SqliteMonitoringStore(path);
  let respond!: (response: Response) => void;
  let requested!: () => void;
  const started = new Promise<void>((resolve) => { requested = resolve; });
  let requests = 0;
  const monitor = new HealthMonitor({
    applications: apps, store, allowedOrigins,
    fetch: async () => {
      requests++;
      requested();
      return new Promise<Response>((resolve) => { respond = resolve; });
    },
    onEvent: () => {},
  });
  t.after(async () => { await monitor.stop(); store.close(); apps.close(); await rm(directory, { recursive: true, force: true }); });
  await monitor.tick();
  assert.equal(requests, 0);
  const application = registerApplication(registration, allowedOrigins, apps).application;
  const first = monitor.tick();
  await started;
  await monitor.tick();
  assert.equal(requests, 1);
  respond(Response.json({ status: "ok", service: "[project-name]-demo-api", version: "1.0.0", instanceId: "primary-1" }));
  await first;
  assert.equal(store.get(application).status, "healthy");
  assert.equal(apps.get(application.applicationId)?.status, "disarmed");
});

test("shutdown aborts an in-flight request without adding a false failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "health-monitor-stop-"));
  const path = join(directory, "applications.sqlite");
  const apps = new SqliteApplicationStore(path);
  const store = new SqliteMonitoringStore(path);
  const application = registerApplication(registration, allowedOrigins, apps).application;
  let requested!: () => void;
  const started = new Promise<void>((resolve) => { requested = resolve; });
  const monitor = new HealthMonitor({
    applications: apps, store, allowedOrigins,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      requested();
    }),
    onEvent: () => { assert.fail("cancelled requests are not health evidence"); },
  });
  t.after(async () => { await monitor.stop(); store.close(); apps.close(); await rm(directory, { recursive: true, force: true }); });
  const tick = monitor.tick();
  await started;
  await monitor.stop();
  await tick;
  assert.equal(store.get(application).status, "unknown");
  assert.equal(store.get(application).consecutiveFailures, 0);
  assert.ok(store.claim(application, Date.now() + 5_000));
  await monitor.tick();
});
