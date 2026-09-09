import type { Application } from "../applications/types";
import { FAILURE_THRESHOLD, type ApplicationHealth, type HealthCheck, type RecordedHealth } from "./types";

export function targetIdentity(application: Application): string {
  return JSON.stringify([
    application.currentEndpoint, application.expectedService, application.expectedVersion, application.healthPath,
    application.updatedAt,
  ]);
}

export function initialHealth(application: Application): ApplicationHealth {
  return {
    applicationId: application.applicationId, endpoint: application.currentEndpoint,
    status: "unknown", consecutiveFailures: 0, lastCheck: null,
    lastHealthyAt: null, lastHealthyInstanceId: null, firstFailedAt: null,
    outageDetectedAt: null, failureChecks: [],
  };
}

export function recordHealth(previous: ApplicationHealth, check: HealthCheck): RecordedHealth {
  const consecutiveFailures = check.healthy ? 0 : previous.consecutiveFailures + 1;
  const outageDetected = consecutiveFailures === FAILURE_THRESHOLD;
  const outageResolved = check.healthy && previous.status === "unhealthy";
  return {
    outageDetected, outageResolved,
    health: {
      ...previous, lastCheck: check, consecutiveFailures,
      status: check.healthy ? "healthy" : consecutiveFailures >= FAILURE_THRESHOLD ? "unhealthy" : "degraded",
      lastHealthyAt: check.healthy ? check.checkedAt : previous.lastHealthyAt,
      lastHealthyInstanceId: check.healthy ? check.instanceId : previous.lastHealthyInstanceId,
      firstFailedAt: check.healthy ? null : previous.firstFailedAt ?? check.checkedAt,
      outageDetectedAt: check.healthy ? null : outageDetected ? check.checkedAt : previous.outageDetectedAt,
      failureChecks: check.healthy ? [] : [...previous.failureChecks, check].slice(-FAILURE_THRESHOLD),
    },
  };
}
