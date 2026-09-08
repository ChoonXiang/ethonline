export type RecoveryState =
  | "detected" | "purchase_ready" | "purchasing" | "provisioning"
  | "verifying" | "cutover_ready" | "updating_endpoint" | "verifying_client"
  | "recovered" | "unnecessary" | "blocked" | "failed" | "cancelled" | "timed_out";

export type FailureReason =
  | "policy_denied" | "workflow_unavailable" | "insufficient_budget"
  | "purchase_failed" | "deployment_failed" | "invalid_deployment"
  | "replacement_unhealthy" | "owner_changed_endpoint" | "permission_revoked"
  | "lease_too_short" | "endpoint_failed" | "endpoint_readback_mismatch" | "client_failed"
  | "disarmed" | "emergency_stop" | "deadline_exceeded" | "deployment_deadline_exceeded";

export interface IncidentSnapshot {
  incidentId: string;
  applicationId: string;
  armingId: string;
  policyVersion: string;
  providerId: string;
  imageDigest: string;
  expectedVersion: string;
  serviceName: string;
  primaryEndpoint: string;
  primaryInstanceId: string;
}

export interface QuoteBinding {
  applicationId: string;
  incidentId: string;
  policyVersion: string;
  providerId: string;
  imageDigest: string;
  leaseSeconds: number;
  network: string;
  asset: string;
  payTo: string;
  amountAtomic: string;
  quoteId: string;
  expiresAt: number;
}

export interface PolicyApproval {
  binding: QuoteBinding;
  mode: "cre-simulation" | "cre-live";
  executionRef: string;
}

export interface PaymentReceipt {
  transactionId: string;
  settledAt: number;
  network: string;
  asset: string;
  payTo: string;
  amountAtomic: string;
}

export interface DeploymentReceipt {
  deploymentId: string;
  endpoint: string;
  instanceId: string;
  imageDigest: string;
  createdAt: number;
  readyAt: number;
  expiresAt: number;
}

// Adapters set healthy only after checking HTTP status, response shape, and service.
export interface HealthObservation {
  checkedAt: number;
  healthy: boolean;
  instanceId: string;
  version: string;
}

export type OperationKind = "purchase" | "endpoint" | "cleanup";
export interface OperationRecord {
  id: string;
  status: "not_started" | "pending" | "unknown" | "succeeded" | "failed";
  startedAt?: number;
  transactionId?: string;
}

export interface Incident {
  schemaVersion: 1;
  snapshot: IncidentSnapshot;
  state: RecoveryState;
  revision: number;
  openedAt: number;
  updatedAt: number;
  deadlineAt: number;
  reason?: FailureReason;
  operations: Record<OperationKind, OperationRecord>;
  quote?: QuoteBinding;
  approval?: PolicyApproval;
  reservation?: { id: string; amountAtomic: string; status: "held" | "settled" | "release_pending" | "released" };
  payment?: PaymentReceipt;
  deployment?: DeploymentReceipt;
  deploymentStatus: "not_requested" | "pending" | "ready" | "failed";
  verification?: { health: HealthObservation[]; functional: HealthObservation };
  endpointObservation?: { endpoint: string; checkedAt: number };
  endpoint?: { transactionId: string; confirmations: number; readbackEndpoint: string };
  client?: { serviceName: string; resolvedEndpoint: string; observation: HealthObservation };
  cleanup?: { outcome: "terminated" | "expired"; receiptRef: string; at: number };
  journal: Array<{
    eventId: string;
    fingerprint: string;
    type: RecoveryEvent["type"];
    at: number;
    from: RecoveryState;
    to: RecoveryState;
    revision: number;
    operationId?: string;
  }>;
}

type EventPayload =
  | { type: "policy.approved"; quote: QuoteBinding; approval: PolicyApproval }
  | { type: "policy.denied"; reason: "policy_denied" | "workflow_unavailable" | "insufficient_budget" }
  | { type: "primary.recovered"; checkedAt: number }
  | { type: "purchase.started"; operationId: string; reservationId: string; primaryCheckedAt: number; primaryHealthy: boolean }
  | { type: "purchase.unknown"; operationId: string }
  | { type: "purchase.settled"; operationId: string; receipt: PaymentReceipt }
  | { type: "purchase.failed"; operationId: string }
  | { type: "deployment.ready"; operationId: string; receipt: DeploymentReceipt }
  | { type: "deployment.failed"; operationId: string }
  | { type: "deployment.deadline_elapsed" }
  | { type: "replacement.verified"; health: HealthObservation[]; functional: HealthObservation }
  | { type: "replacement.failed" }
  | { type: "endpoint.started"; operationId: string; transactionId: string; preflightCheckedAt: number; observedEndpoint: string; permissionGranted: boolean; health: HealthObservation }
  | { type: "endpoint.unknown"; operationId: string }
  | { type: "endpoint.confirmed"; operationId: string; transactionId: string; confirmations: number; readbackEndpoint: string }
  | { type: "endpoint.failed"; operationId: string; transactionId: string }
  | { type: "client.verified"; serviceName: string; resolvedEndpoint: string; observation: HealthObservation }
  | { type: "client.failed" }
  | { type: "stop"; reason: "disarmed" | "emergency_stop" }
  | { type: "deadline.elapsed" }
  | { type: "cleanup.started"; operationId: string; observedEndpoint: string; preflightCheckedAt: number }
  | { type: "cleanup.unknown"; operationId: string }
  | { type: "cleanup.completed"; operationId: string; receiptRef: string }
  | { type: "lease.expired"; receiptRef: string }
  | { type: "reservation.released"; reservationId: string };

export type RecoveryEvent = { id: string; at: number } & EventPayload;
