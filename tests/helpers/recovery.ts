import { createIncident, transition } from "../../backend/recovery/state-machine";
import type { IncidentSnapshot, QuoteBinding, RecoveryEvent } from "../../backend/recovery/types";

export const at = (offset: number) => 1_800_000_000_000 + offset;

export const snapshot: IncidentSnapshot = {
  incidentId: "incident-1",
  applicationId: "application-1",
  armingId: "arming-1",
  policyVersion: "policy-v1",
  providerId: "[project-name]-compute-demo",
  imageDigest: `registry.example/demo@sha256:${"a".repeat(64)}`,
  expectedVersion: "1.0.0",
  serviceName: "api.example.eth",
  primaryEndpoint: "https://primary.example",
  primaryInstanceId: "primary-1",
};

export const binding: QuoteBinding = {
  applicationId: snapshot.applicationId,
  incidentId: snapshot.incidentId,
  policyVersion: snapshot.policyVersion,
  providerId: snapshot.providerId,
  imageDigest: snapshot.imageDigest,
  leaseSeconds: 600,
  network: "hedera:testnet",
  asset: "0.0.0",
  payTo: "0.0.1234",
  amountAtomic: "100000000",
  quoteId: "quote-1",
  expiresAt: at(60_000),
};

export const health = (offset: number) => ({
  checkedAt: at(offset),
  healthy: true,
  instanceId: "replacement-1",
  version: "1.0.0",
});

// Synthetic adapter observations only; these are not partner execution evidence.
export function recoveryEvents() {
  const incident = createIncident(snapshot, at(0));
  const purchaseId = incident.operations.purchase.id;
  const endpointId = incident.operations.endpoint.id;
  return {
    approval: {
      id: "approval", type: "policy.approved", at: at(1_000),
      quote: binding,
      approval: { binding, mode: "cre-simulation", executionRef: "test-fixture-run" },
    },
    purchase: {
      id: "purchase", type: "purchase.started", at: at(2_000),
      operationId: purchaseId, reservationId: "reservation-1", primaryCheckedAt: at(2_000), primaryHealthy: false,
    },
    settlement: {
      id: "settlement", type: "purchase.settled", at: at(3_000), operationId: purchaseId,
      receipt: {
        transactionId: "test-settlement-1", settledAt: at(3_000),
        network: "hedera:testnet", asset: "0.0.0", payTo: "0.0.1234", amountAtomic: "100000000",
      },
    },
    deployment: {
      id: "deployment", type: "deployment.ready", at: at(5_000), operationId: purchaseId,
      receipt: {
        deploymentId: "deployment-1", endpoint: "https://replacement.example",
        instanceId: "replacement-1", imageDigest: snapshot.imageDigest,
        createdAt: at(4_000), readyAt: at(5_000), expiresAt: at(604_000),
      },
    },
    verification: {
      id: "verification", type: "replacement.verified", at: at(16_000),
      health: [health(5_000), health(10_000), health(15_000)], functional: health(16_000),
    },
    cutover: {
      id: "cutover", type: "endpoint.started", at: at(17_000), operationId: endpointId,
      transactionId: "test-ens-tx-1", preflightCheckedAt: at(17_000),
      observedEndpoint: snapshot.primaryEndpoint, permissionGranted: true, health: health(17_000),
    },
    confirmation: {
      id: "confirmation", type: "endpoint.confirmed", at: at(25_000), operationId: endpointId,
      transactionId: "test-ens-tx-1", confirmations: 2, readbackEndpoint: "https://replacement.example",
    },
    client: {
      id: "client", type: "client.verified", at: at(26_000), serviceName: snapshot.serviceName,
      resolvedEndpoint: "https://replacement.example", observation: health(26_000),
    },
  } satisfies Record<string, RecoveryEvent>;
}

export function advanceThrough(last: keyof ReturnType<typeof recoveryEvents>) {
  let incident = createIncident(snapshot, at(0));
  for (const [key, event] of Object.entries(recoveryEvents())) {
    incident = transition(incident, event, incident.revision);
    if (key === last) break;
  }
  return incident;
}
