import { canCleanUp, isTerminal, requireCondition, safeReplacementIdentity, validTime } from "./guards";
import type { Incident } from "./types";

export type RecoveryAction =
  | { type: "evaluate_policy" | "verify_replacement" | "expire_incident" | "expire_deployment" | "retain_lease" | "none" }
  | { type: "prepare_purchase" | "reconcile_purchase" | "reconcile_deployment" | "prepare_cutover" | "prepare_cleanup" | "reconcile_cleanup"; operationId: string }
  | { type: "reconcile_endpoint"; operationId: string; transactionId: string }
  | { type: "verify_client"; serviceName: string }
  | { type: "release_reservation"; reservationId: string }
  | { type: "manual_review"; reason: "unsafe_deployment_identity" }
  | { type: "reconcile_lease"; deploymentId: string };

export function nextAction(incident: Incident, now: number): RecoveryAction {
  requireCondition(validTime(now) && now >= incident.updatedAt, "invalid_timestamp");
  const terminal = isTerminal(incident.state);
  const { purchase, endpoint, cleanup } = incident.operations;
  if (!terminal && now >= incident.deadlineAt) return { type: "expire_incident" };
  if (!terminal && incident.state === "provisioning" && now >= incident.payment!.settledAt + 60_000) {
    return { type: "expire_deployment" };
  }
  // Persisted intent is potentially submitted, even if a crash hid the response.
  if (["pending", "unknown"].includes(purchase.status)) {
    return { type: "reconcile_purchase", operationId: purchase.id };
  }
  if (purchase.status === "succeeded" && incident.deploymentStatus === "pending") {
    return { type: "reconcile_deployment", operationId: purchase.id };
  }
  if (["pending", "unknown"].includes(endpoint.status)) {
    return { type: "reconcile_endpoint", operationId: endpoint.id, transactionId: endpoint.transactionId! };
  }
  if (["pending", "unknown"].includes(cleanup.status)) {
    return { type: "reconcile_cleanup", operationId: cleanup.id };
  }
  if (incident.reservation?.status === "release_pending") {
    return { type: "release_reservation", reservationId: incident.reservation.id };
  }
  if (incident.deployment && !safeReplacementIdentity(incident)) {
    return { type: "manual_review", reason: "unsafe_deployment_identity" };
  }
  if (incident.deployment && !incident.cleanup && now >= incident.deployment.expiresAt) {
    return { type: "reconcile_lease", deploymentId: incident.deployment.deploymentId };
  }
  if (terminal) {
    if (canCleanUp(incident)) return { type: "prepare_cleanup", operationId: cleanup.id };
    if (incident.deployment && !incident.cleanup) return { type: "retain_lease" };
    return { type: "none" };
  }
  switch (incident.state) {
    case "detected": return { type: "evaluate_policy" };
    case "purchase_ready": return { type: "prepare_purchase", operationId: purchase.id };
    case "verifying": return { type: "verify_replacement" };
    case "cutover_ready": return { type: "prepare_cutover", operationId: endpoint.id };
    case "verifying_client": return { type: "verify_client", serviceName: incident.snapshot.serviceName };
    default: throw new Error("Incident has no valid next action");
  }
}

/** Absolute offsets from the original read attempt, never a write retry policy. */
export function readRetryAt(startedAt: number, retry: number, deadlineAt: number): number | undefined {
  requireCondition(validTime(startedAt) && validTime(deadlineAt), "invalid_timestamp");
  const offset = retry === 1 ? 1_000 : retry === 2 ? 3_000 : undefined;
  if (offset === undefined) return undefined;
  const at = startedAt + offset;
  return validTime(at) && at < deadlineAt ? at : undefined;
}
