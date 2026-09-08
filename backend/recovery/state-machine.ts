import { fingerprint, operationId } from "./identity";
import {
  canCleanUp, fresh, inState, isHttpsOrigin, isTerminal, nonempty, passingObservation,
  requireCondition, safeReplacementIdentity, sameBinding, validDeployment, validateQuote, validTime,
} from "./guards";
import type { FailureReason, Incident, IncidentSnapshot, OperationKind, RecoveryEvent, RecoveryState } from "./types";

export { RecoveryError } from "./guards";

export function createIncident(snapshot: IncidentSnapshot, openedAt: number): Incident {
  requireCondition(Object.values(snapshot).every(nonempty), "invalid_snapshot");
  requireCondition(isHttpsOrigin(snapshot.primaryEndpoint) && /@sha256:[a-f0-9]{64}$/.test(snapshot.imageDigest), "invalid_snapshot");
  requireCondition(validTime(openedAt) && validTime(openedAt + 180_000), "invalid_timestamp");
  return {
    schemaVersion: 1,
    snapshot: structuredClone(snapshot),
    state: "detected",
    revision: 0,
    openedAt,
    updatedAt: openedAt,
    deadlineAt: openedAt + 180_000,
    operations: {
      purchase: { id: operationId(snapshot.incidentId, "purchase"), status: "not_started" },
      endpoint: { id: operationId(snapshot.incidentId, "endpoint"), status: "not_started" },
      cleanup: { id: operationId(snapshot.incidentId, "cleanup"), status: "not_started" },
    },
    deploymentStatus: "not_requested",
    journal: [],
  };
}

function finish(incident: Incident, state: RecoveryState, reason?: FailureReason) {
  if (!isTerminal(incident.state)) {
    incident.state = state;
    if (reason) incident.reason = reason;
  }
}

function advance(incident: Incident, state: RecoveryState) {
  if (!isTerminal(incident.state)) incident.state = state;
}

function pendingOperation(incident: Incident, kind: OperationKind) {
  requireCondition(["pending", "unknown"].includes(incident.operations[kind].status), "invalid_transition");
}

function newAction(incident: Incident, now: number) {
  requireCondition(now < incident.deadlineAt, "deadline_exceeded");
  requireCondition(!isTerminal(incident.state), "invalid_transition");
}

function apply(incident: Incident, event: RecoveryEvent) {
  switch (event.type) {
    case "policy.approved":
      newAction(incident, event.at);
      inState(incident, "detected", "purchase_ready");
      sameBinding(event.quote, event.approval.binding);
      validateQuote(incident, event.quote, event.at);
      requireCondition(nonempty(event.approval.executionRef) && ["cre-simulation", "cre-live"].includes(event.approval.mode), "invalid_approval");
      incident.quote = event.quote;
      incident.approval = event.approval;
      incident.state = "purchase_ready";
      return;
    case "policy.denied":
      inState(incident, "detected", "purchase_ready");
      finish(incident, "blocked", event.reason);
      return;
    case "primary.recovered":
      inState(incident, "detected", "purchase_ready");
      fresh(event.checkedAt, event.at, incident.openedAt);
      finish(incident, "unnecessary");
      return;
    case "purchase.started":
      newAction(incident, event.at);
      inState(incident, "purchase_ready");
      requireCondition(incident.operations.purchase.status === "not_started", "invalid_transition");
      requireCondition(incident.quote!.expiresAt > event.at, "quote_expired");
      fresh(event.primaryCheckedAt, event.at, incident.openedAt);
      requireCondition(event.primaryHealthy === false, "primary_healthy");
      requireCondition(nonempty(event.reservationId), "invalid_reservation");
      incident.operations.purchase.status = "pending";
      incident.operations.purchase.startedAt = event.at;
      incident.reservation = { id: event.reservationId, amountAtomic: incident.quote!.amountAtomic, status: "held" };
      incident.deploymentStatus = "pending";
      incident.state = "purchasing";
      return;
    case "purchase.unknown":
      pendingOperation(incident, "purchase");
      incident.operations.purchase.status = "unknown";
      return;
    case "purchase.settled": {
      pendingOperation(incident, "purchase");
      const receipt = event.receipt;
      for (const key of ["network", "asset", "payTo", "amountAtomic"] as const) {
        requireCondition(receipt[key] === incident.quote![key], "binding_mismatch");
      }
      requireCondition(nonempty(receipt.transactionId) && validTime(receipt.settledAt) && receipt.settledAt >= incident.operations.purchase.startedAt! && receipt.settledAt <= event.at, "invalid_receipt");
      incident.payment = receipt;
      incident.operations.purchase.status = "succeeded";
      incident.reservation!.status = "settled";
      advance(incident, "provisioning");
      return;
    }
    case "purchase.failed":
      pendingOperation(incident, "purchase");
      incident.operations.purchase.status = "failed";
      incident.deploymentStatus = "not_requested";
      incident.reservation!.status = "release_pending";
      finish(incident, "failed", "purchase_failed");
      return;
    case "deployment.ready":
      requireCondition(incident.payment && incident.deploymentStatus === "pending", "invalid_transition");
      incident.deployment = event.receipt;
      incident.deploymentStatus = "ready";
      if (validDeployment(incident)) advance(incident, "verifying");
      else finish(incident, "failed", "invalid_deployment");
      return;
    case "deployment.failed":
      requireCondition(incident.payment && incident.deploymentStatus === "pending", "invalid_transition");
      incident.deploymentStatus = "failed";
      finish(incident, "failed", "deployment_failed");
      return;
    case "deployment.deadline_elapsed":
      inState(incident, "provisioning");
      requireCondition(event.at >= incident.payment!.settledAt + 60_000, "deadline_not_reached");
      finish(incident, "failed", "deployment_deadline_exceeded");
      return;
    case "replacement.verified":
      requireCondition(incident.deploymentStatus === "ready" && !incident.verification && (incident.state === "verifying" || isTerminal(incident.state)), "invalid_transition");
      requireCondition(validDeployment(incident), "invalid_deployment");
      requireCondition(event.health.length === 3, "invalid_verification");
      event.health.forEach((observation, index) => {
        passingObservation(incident, observation, event.at);
        if (index > 0) requireCondition(observation.checkedAt - event.health[index - 1].checkedAt >= 5_000, "invalid_verification");
      });
      passingObservation(incident, event.functional, event.at);
      requireCondition(event.functional.checkedAt >= event.health[2].checkedAt, "invalid_verification");
      incident.verification = { health: event.health, functional: event.functional };
      advance(incident, "cutover_ready");
      return;
    case "replacement.failed":
      inState(incident, "verifying", "cutover_ready");
      finish(incident, "failed", "replacement_unhealthy");
      return;
    case "endpoint.started":
      newAction(incident, event.at);
      inState(incident, "cutover_ready");
      requireCondition(incident.operations.endpoint.status === "not_started", "invalid_transition");
      requireCondition(nonempty(event.transactionId), "invalid_receipt");
      fresh(event.preflightCheckedAt, event.at, incident.verification!.functional.checkedAt);
      incident.endpointObservation = { endpoint: event.observedEndpoint, checkedAt: event.preflightCheckedAt };
      if (event.observedEndpoint !== incident.snapshot.primaryEndpoint) {
        finish(incident, "blocked", "owner_changed_endpoint");
        return;
      }
      if (!event.permissionGranted) {
        finish(incident, "blocked", "permission_revoked");
        return;
      }
      if (incident.deployment!.expiresAt - event.at < 120_000) {
        finish(incident, "failed", "lease_too_short");
        return;
      }
      passingObservation(incident, event.health, event.at);
      fresh(event.health.checkedAt, event.at, incident.verification!.functional.checkedAt);
      incident.operations.endpoint.status = "pending";
      incident.operations.endpoint.startedAt = event.at;
      incident.operations.endpoint.transactionId = event.transactionId;
      incident.state = "updating_endpoint";
      return;
    case "endpoint.unknown":
      pendingOperation(incident, "endpoint");
      incident.operations.endpoint.status = "unknown";
      return;
    case "endpoint.confirmed":
      pendingOperation(incident, "endpoint");
      requireCondition(event.transactionId === incident.operations.endpoint.transactionId && Number.isSafeInteger(event.confirmations) && event.confirmations >= 2, "invalid_receipt");
      incident.endpoint = { transactionId: event.transactionId, confirmations: event.confirmations, readbackEndpoint: event.readbackEndpoint };
      incident.operations.endpoint.status = "succeeded";
      if (event.readbackEndpoint === incident.deployment!.endpoint) advance(incident, "verifying_client");
      else finish(incident, "failed", "endpoint_readback_mismatch");
      return;
    case "endpoint.failed":
      pendingOperation(incident, "endpoint");
      requireCondition(event.transactionId === incident.operations.endpoint.transactionId, "invalid_receipt");
      incident.endpoint = { transactionId: event.transactionId, confirmations: 0, readbackEndpoint: "" };
      incident.operations.endpoint.status = "failed";
      finish(incident, "failed", "endpoint_failed");
      return;
    case "client.verified":
      requireCondition(incident.operations.endpoint.status === "succeeded" && !incident.client && (incident.state === "verifying_client" || isTerminal(incident.state)), "invalid_transition");
      requireCondition(event.serviceName === incident.snapshot.serviceName && event.resolvedEndpoint === incident.deployment!.endpoint, "invalid_client_evidence");
      passingObservation(incident, event.observation, event.at);
      requireCondition(event.observation.checkedAt >= incident.operations.endpoint.startedAt!, "invalid_client_evidence");
      incident.client = { serviceName: event.serviceName, resolvedEndpoint: event.resolvedEndpoint, observation: event.observation };
      finish(incident, "recovered");
      return;
    case "client.failed":
      inState(incident, "verifying_client");
      finish(incident, "failed", "client_failed");
      return;
    case "stop":
      finish(incident, "cancelled", event.reason);
      return;
    case "deadline.elapsed":
      requireCondition(event.at >= incident.deadlineAt, "deadline_not_reached");
      finish(incident, "timed_out", "deadline_exceeded");
      return;
    case "cleanup.started":
      requireCondition(canCleanUp(incident), "unsafe_cleanup");
      requireCondition(incident.operations.cleanup.status === "not_started", "invalid_transition");
      fresh(event.preflightCheckedAt, event.at, incident.openedAt);
      incident.endpointObservation = { endpoint: event.observedEndpoint, checkedAt: event.preflightCheckedAt };
      if (event.observedEndpoint === incident.deployment!.endpoint) return;
      incident.operations.cleanup.status = "pending";
      incident.operations.cleanup.startedAt = event.at;
      return;
    case "cleanup.unknown":
      pendingOperation(incident, "cleanup");
      incident.operations.cleanup.status = "unknown";
      return;
    case "cleanup.completed":
      pendingOperation(incident, "cleanup");
      requireCondition(nonempty(event.receiptRef), "invalid_receipt");
      incident.operations.cleanup.status = "succeeded";
      incident.cleanup = { outcome: "terminated", receiptRef: event.receiptRef, at: event.at };
      return;
    case "lease.expired":
      requireCondition(incident.deployment && safeReplacementIdentity(incident) && !incident.cleanup && validTime(incident.deployment.expiresAt) && event.at >= incident.deployment.expiresAt, "invalid_transition");
      requireCondition(nonempty(event.receiptRef), "invalid_receipt");
      incident.operations.cleanup.status = "succeeded";
      incident.cleanup = { outcome: "expired", receiptRef: event.receiptRef, at: event.at };
      return;
    case "reservation.released":
      requireCondition(incident.reservation?.status === "release_pending", "invalid_transition");
      requireCondition(event.reservationId === incident.reservation.id, "invalid_reservation");
      incident.reservation.status = "released";
      return;
    default:
      return unknownEvent(event);
  }
}

function unknownEvent(event: never): never {
  void event;
  throw new Error("Unsupported recovery event");
}

export function transition(current: Incident, event: RecoveryEvent, expectedRevision: number): Incident {
  requireCondition(nonempty(event.id), "invalid_event");
  const eventFingerprint = fingerprint(event);
  const existing = current.journal.find((entry) => entry.eventId === event.id);
  if (existing) {
    requireCondition(existing.fingerprint === eventFingerprint, "event_conflict");
    return current;
  }
  requireCondition(current.revision === expectedRevision, "revision_conflict");
  requireCondition(validTime(event.at) && event.at >= current.updatedAt, "invalid_timestamp");
  if ("operationId" in event) {
    const kind: OperationKind = event.type.startsWith("endpoint.") ? "endpoint" : event.type.startsWith("cleanup.") ? "cleanup" : "purchase";
    requireCondition(event.operationId === current.operations[kind].id, "operation_mismatch");
  }
  const incident = structuredClone(current);
  incident.updatedAt = event.at;
  apply(incident, structuredClone(event));
  // Late receipts remain useful evidence, but cannot satisfy the recovery deadline.
  if (!isTerminal(current.state) && event.at >= current.deadlineAt) {
    incident.state = "timed_out";
    incident.reason = "deadline_exceeded";
  }
  incident.revision += 1;
  incident.journal.push({
    eventId: event.id, fingerprint: eventFingerprint, type: event.type, at: event.at,
    from: current.state, to: incident.state, revision: incident.revision,
    ...("operationId" in event ? { operationId: event.operationId } : {}),
  });
  return incident;
}
