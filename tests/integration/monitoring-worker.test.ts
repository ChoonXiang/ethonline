import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerApplication } from "../../backend/applications/registration";
import { SqliteApplicationStore } from "../../backend/applications/sqlite-store";
import { SqliteMonitoringStore } from "../../backend/monitoring/sqlite-store";
import { probeHealth } from "../../backend/monitoring/probe";
import { createDemoServer } from "../../demo/api/server.mjs";
import { registration } from "../helpers/applications";
import { startProcess } from "../helpers/process";

test("worker observes a real HTTPS API outage once and preserves its evidence across restart", { timeout: 40_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "monitoring-worker-"));
  const workers: ReturnType<typeof startProcess>[] = [];
  const resources: { apps?: SqliteApplicationStore; healthStore?: SqliteMonitoringStore } = {};
  t.after(async () => {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill("SIGKILL");
      await worker.exited;
    }
    resources.healthStore?.close();
    resources.apps?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const certPath = join(directory, "cert.pem");
  const keyPath = join(directory, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
  const demo = createDemoServer();
  const server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) },
    (request, response) => demo.emit("request", request, response));
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `https://localhost:${address.port}`;
  const path = join(directory, "applications.sqlite");
  const apps = new SqliteApplicationStore(path);
  resources.apps = apps;
  const healthStore = new SqliteMonitoringStore(path);
  resources.healthStore = healthStore;
  const application = registerApplication({ ...registration, primaryEndpoint: endpoint }, [endpoint], apps).application;
  // An untrusted certificate fails with the production transport, before the worker trusts this test CA.
  assert.equal((await probeHealth(application, { allowedOrigins: [endpoint] })).reason, "network_error");
  const env = {
    APPLICATION_ALLOWED_ORIGINS: endpoint, APPLICATION_DATABASE_PATH: path,
    NODE_EXTRA_CA_CERTS: certPath, CONTROL_API_TOKEN: undefined,
    RECOVERY_WORKER_HEARTBEAT_MS: "1000",
  };
  const worker = startProcess(t, ["--import", "tsx", "workers/recovery/main.ts"], env);
  workers.push(worker);
  assert.equal((await worker.ready).monitoringEnabled, true);
  await worker.waitForEvent((event) => event.event === "health.checked" && event.status === "healthy");
  assert.equal(healthStore.get(application).status, "healthy");
  assert.ok(healthStore.get(application).lastHealthyInstanceId);
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const outage = await worker.waitForEvent((event) => event.event === "outage.detected", 20_000);
  assert.equal(outage.recoveryEnabled, false);
  assert.equal(healthStore.get(application).status, "unhealthy");
  assert.equal(healthStore.get(application).consecutiveFailures, 3);
  assert.equal(healthStore.get(application).failureChecks.length, 3);
  assert.equal(apps.get(application.applicationId)?.status, "disarmed");
  worker.child.kill("SIGTERM");
  assert.deepEqual(await worker.exited, { code: 0, signal: null });
  assert.equal(worker.events.filter((event) => event.event === "outage.detected").length, 1);

  const restarted = startProcess(t, ["--import", "tsx", "workers/recovery/main.ts"], env);
  workers.push(restarted);
  await restarted.ready;
  await restarted.waitForEvent((event) => event.event === "health.checked", 7_000);
  restarted.child.kill("SIGINT");
  assert.deepEqual(await restarted.exited, { code: 0, signal: null });
  assert.equal(healthStore.get(application).consecutiveFailures, 4);
  assert.equal(restarted.events.filter((event) => event.event === "outage.detected").length, 0);
});

test("invalid worker monitoring configuration exits unsuccessfully without exposing its values", { timeout: 10_000 }, async (t) => {
  const worker = startProcess(t, ["--import", "tsx", "workers/recovery/main.ts"], {
    APPLICATION_ALLOWED_ORIGINS: "https://secret:credential@primary.example",
  });
  const startup = assert.rejects(worker.ready);
  assert.deepEqual(await worker.exited, { code: 1, signal: null });
  await startup;
  assert.ok(worker.events.some((event) => event.event === "worker.failed"));
  assert.ok(!JSON.stringify(worker.events).includes("credential"));
});
