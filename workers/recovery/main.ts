import { PROJECT_NAME } from "../../backend/config/project";
import { readWorkerConfig } from "../../backend/config/worker";
import { readMonitoringConfig } from "../../backend/config/monitoring";
import { SqliteApplicationStore } from "../../backend/applications/sqlite-store";
import { HealthMonitor } from "../../backend/monitoring/monitor";
import { SqliteMonitoringStore } from "../../backend/monitoring/sqlite-store";
import { scheduleMonitoring } from "../../backend/monitoring/scheduler";
import { FAILURE_THRESHOLD, HEALTH_INTERVAL_MS, HEALTH_TIMEOUT_MS } from "../../backend/monitoring/types";

function log(event: string, details: Record<string, unknown> = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      service: `${PROJECT_NAME}-recovery-worker`,
      event,
      ...details,
      recoveryEnabled: false,
    })}\n`,
  );
}

function main() {
  const { heartbeatIntervalMs } = readWorkerConfig();
  const config = readMonitoringConfig();
  let applications: SqliteApplicationStore | undefined;
  let store: SqliteMonitoringStore | undefined;
  let monitor: HealthMonitor | undefined;
  try {
    if (config) {
      applications = new SqliteApplicationStore(config.databasePath);
      store = new SqliteMonitoringStore(config.databasePath);
      monitor = new HealthMonitor({ applications, store, allowedOrigins: config.allowedOrigins, onEvent: log });
    }
  } catch (error) {
    store?.close();
    applications?.close();
    throw error;
  }

  let stopping = false;
  let stopPolling = () => {};
  const heartbeat = setInterval(() => log(monitor ? "worker.heartbeat" : "worker.idle"), heartbeatIntervalMs);

  function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    stopPolling();
    void (async () => {
      await monitor?.stop();
      store?.close();
      applications?.close();
      log("worker.stopped");
    })().catch(() => {
      process.exitCode = 1;
      log("worker.failed", { code: "shutdown_failed" });
    }).finally(() => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  log("worker.started", {
    monitoringEnabled: Boolean(monitor),
    ...(monitor ? { healthIntervalMs: HEALTH_INTERVAL_MS, healthTimeoutMs: HEALTH_TIMEOUT_MS, failureThreshold: FAILURE_THRESHOLD } : {}),
  });
  if (monitor) stopPolling = scheduleMonitoring(monitor, () => {
    process.exitCode = 1;
    log("worker.failed", { code: "monitoring_failed" });
    shutdown();
  });
}

try {
  main();
} catch {
  process.exitCode = 1;
  log("worker.failed", { code: "worker_configuration_error" });
}
