import type { Application } from "../applications/types";
import type { HealthObservation } from "../recovery/types";

export const HEALTH_INTERVAL_MS = 5_000;
export const HEALTH_TIMEOUT_MS = 2_000;
export const FAILURE_THRESHOLD = 3;

export type HealthTarget = Pick<Application, "currentEndpoint" | "expectedService" | "expectedVersion" | "healthPath">;
export type HealthFailureReason =
  | "http_status" | "network_error" | "timeout" | "cancelled"
  | "invalid_json" | "invalid_response" | "response_too_large" | "endpoint_not_allowed";

export interface HealthCheck extends HealthObservation {
  reason?: HealthFailureReason;
  httpStatus?: number;
}

export interface ApplicationHealth {
  applicationId: string;
  endpoint: string;
  status: "unknown" | "healthy" | "degraded" | "unhealthy";
  consecutiveFailures: number;
  lastCheck: HealthCheck | null;
  lastHealthyAt: number | null;
  lastHealthyInstanceId: string | null;
  firstFailedAt: number | null;
  outageDetectedAt: number | null;
  failureChecks: HealthCheck[];
}

export interface ProbeClaim {
  id: string;
  applicationId: string;
}

export interface RecordedHealth {
  health: ApplicationHealth;
  outageDetected: boolean;
  outageResolved: boolean;
}
