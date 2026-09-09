import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { registerApplication } from "../../backend/applications/registration";
import { SqliteApplicationStore } from "../../backend/applications/sqlite-store";
import { SqliteMonitoringStore } from "../../backend/monitoring/sqlite-store";
import { allowedOrigins, registration } from "../helpers/applications";

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "monitoring-"));
  const path = join(directory, "applications.sqlite");
  const apps = new SqliteApplicationStore(path);
  const application = registerApplication(registration, allowedOrigins, apps).application;
  const store = new SqliteMonitoringStore(path);
  t.after(async () => { store.close(); apps.close(); await rm(directory, { recursive: true, force: true }); });
  return { path, application, apps, store };
}

const failed = (checkedAt: number) => ({ checkedAt, healthy: false as const, instanceId: "", version: "", reason: "network_error" as const });
const healthy = (checkedAt: number) => ({ checkedAt, healthy: true as const, instanceId: "primary-1", version: "1.0.0" });

test("three consecutive failures mark an outage; a passing check resets the streak", async (t) => {
  const { application, store, apps } = await setup(t);
  assert.equal(store.get(application)?.status, "unknown");
  for (const [at, result, expectedStatus, failures] of [
    [0, failed(0), "degraded", 1], [5_000, failed(5_000), "degraded", 2],
    [10_000, healthy(10_000), "healthy", 0], [15_000, failed(15_000), "degraded", 1],
    [20_000, failed(20_000), "degraded", 2], [25_000, failed(25_000), "unhealthy", 3],
    [30_000, failed(30_000), "unhealthy", 4], [35_000, healthy(35_000), "healthy", 0],
  ] as const) {
    const claim = store.claim(application, at);
    assert.ok(claim);
    const recorded = store.record(claim, result, at + 1);
    assert.equal(recorded?.health.status, expectedStatus);
    assert.equal(recorded?.health.consecutiveFailures, failures);
    assert.equal(recorded?.outageDetected, at === 25_000);
    if (at === 25_000) {
      assert.equal(recorded?.health.firstFailedAt, 15_000);
      assert.equal(recorded?.health.outageDetectedAt, 25_000);
      assert.equal(recorded?.health.lastHealthyInstanceId, "primary-1");
      assert.deepEqual(recorded?.health.failureChecks.map((check) => check.checkedAt), [15_000, 20_000, 25_000]);
    }
  }
  assert.equal(store.get(application)?.outageDetectedAt, null);
  assert.deepEqual(store.get(application)?.failureChecks, []);
  assert.equal(apps.get(application.applicationId)?.status, "disarmed");
  assert.equal(apps.get(application.applicationId)?.armingId, null);
});

test("independent workers cannot overlap probes, double-count a delivery, or bypass the interval", async (t) => {
  const { path, application, store } = await setup(t);
  const second = new SqliteMonitoringStore(path);
  t.after(() => second.close());
  const claim = store.claim(application, 0);
  assert.ok(claim);
  assert.equal(second.claim(application, 0), undefined);
  assert.equal(second.claim(application, 5_000), undefined);
  assert.ok(store.record(claim, failed(0), 1));
  assert.equal(second.record(claim, failed(0), 2), undefined);
  assert.equal(second.claim(application, 4_999), undefined);
  assert.ok(second.claim(application, 5_000));
  assert.equal(second.get(application)?.consecutiveFailures, 1);
});

test("a restart preserves failures and expired probe ownership rejects late results", async (t) => {
  const { path, application, store } = await setup(t);
  const first = store.claim(application, 0)!;
  store.record(first, failed(0), 1);
  const abandoned = store.claim(application, 5_000)!;
  const restarted = new SqliteMonitoringStore(path);
  assert.equal(restarted.get(application)?.consecutiveFailures, 1);
  assert.equal(restarted.record(abandoned, failed(5_000), 12_000), undefined);
  const replacement = restarted.claim(application, 12_000);
  assert.ok(replacement);
  assert.equal(store.record(abandoned, failed(5_000), 12_001), undefined);
  restarted.record(replacement, failed(12_000), 12_001);
  restarted.close();
  assert.equal(store.get(application)?.consecutiveFailures, 2);
});

test("endpoint changes invalidate old probes and start a fresh health streak", async (t) => {
  const { path, application, store, apps } = await setup(t);
  const first = store.claim(application, 0)!;
  store.record(first, failed(0), 1);
  const inFlight = store.claim(application, 5_000)!;
  const changed = { ...application, currentEndpoint: "https://replacement.example" };
  const database = new DatabaseSync(path);
  database.prepare("UPDATE applications SET record_json = ? WHERE application_id = ?")
    .run(JSON.stringify(changed), application.applicationId);
  database.close();
  assert.equal(store.record(inFlight, failed(5_000), 5_001), undefined);
  assert.equal(store.claim(application, 10_000), undefined);
  assert.equal(store.get(apps.get(application.applicationId)!)?.status, "unknown");
  const next = store.claim(changed, 10_000)!;
  const result = store.record(next, failed(10_000), 10_001);
  assert.equal(result?.health.consecutiveFailures, 1);
  assert.equal(result?.health.endpoint, "https://replacement.example");
});

test("cancelled probes release ownership without recording a failure", async (t) => {
  const { application, store } = await setup(t);
  const claim = store.claim(application, 0)!;
  store.release(claim);
  assert.equal(store.record(claim, failed(0), 1), undefined);
  assert.equal(store.get(application)?.consecutiveFailures, 0);
  assert.ok(store.claim(application, 5_000));
});

test("returning to a previous endpoint cannot revive checks from an older application update", async (t) => {
  const { path, application, store, apps } = await setup(t);
  store.record(store.claim(application, 0)!, failed(0), 1);
  store.record(store.claim(application, 5_000)!, failed(5_000), 5_001);
  const inFlight = store.claim(application, 10_000)!;
  const database = new DatabaseSync(path);
  try {
    const update = database.prepare("UPDATE applications SET record_json = ? WHERE application_id = ?");
    update.run(JSON.stringify({ ...application, currentEndpoint: "https://replacement.example", updatedAt: application.updatedAt + 1 }), application.applicationId);
    update.run(JSON.stringify({ ...application, updatedAt: application.updatedAt + 2 }), application.applicationId);
  } finally { database.close(); }
  assert.equal(store.record(inFlight, failed(10_000), 10_001), undefined);
  assert.equal(store.claim(application, 15_000), undefined);
  const current = apps.get(application.applicationId)!;
  assert.equal(store.get(current).status, "unknown");
  const fresh = store.claim(current, 15_000)!;
  const result = store.record(fresh, failed(15_000), 15_001);
  assert.equal(result?.health.consecutiveFailures, 1);
  assert.equal(result?.outageDetected, false);
});
