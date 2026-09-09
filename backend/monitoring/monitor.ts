import type { Application, ApplicationStore } from "../applications/types";
import { probeHealth } from "./probe";
import type { SqliteMonitoringStore } from "./sqlite-store";

interface MonitorOptions {
  applications: Pick<ApplicationStore, "list">;
  store: SqliteMonitoringStore;
  allowedOrigins: readonly string[];
  onEvent: (event: string, details: Record<string, unknown>) => void;
  fetch?: typeof fetch;
}

export class HealthMonitor {
  private readonly controller = new AbortController();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly options: MonitorOptions) {}

  async tick(): Promise<void> {
    if (this.controller.signal.aborted) return;
    const checks: Promise<void>[] = [];
    for (const application of this.options.applications.list()) {
      if (this.inFlight.has(application.applicationId)) continue;
      const check = this.check(application).finally(() => this.inFlight.delete(application.applicationId));
      this.inFlight.set(application.applicationId, check);
      checks.push(check);
    }
    const results = await Promise.allSettled(checks);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await Promise.allSettled(this.inFlight.values());
  }

  private async check(application: Application): Promise<void> {
    const { store, onEvent } = this.options;
    const claim = store.claim(application, Date.now());
    if (!claim) return;
    try {
      const check = await probeHealth(application, { ...this.options, signal: this.controller.signal });
      if (this.controller.signal.aborted || check.reason === "cancelled") return;
      const result = store.record(claim, check, Date.now());
      if (!result) return;
      onEvent("health.checked", {
        applicationId: application.applicationId, status: result.health.status,
        consecutiveFailures: result.health.consecutiveFailures, check,
      });
      if (result.outageDetected || result.outageResolved) {
        onEvent(result.outageDetected ? "outage.detected" : "outage.resolved", {
          applicationId: application.applicationId, endpoint: result.health.endpoint,
          firstFailedAt: result.health.firstFailedAt, detectedAt: result.health.outageDetectedAt,
          checkedAt: check.checkedAt, recoveryEnabled: false,
        });
      }
    } finally {
      store.release(claim);
    }
  }
}
