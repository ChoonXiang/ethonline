import { fingerprint } from "./identity";
import type { HealthObservation, Incident, QuoteBinding, RecoveryState } from "./types";

export class RecoveryError extends Error {
  constructor(public readonly code: string) {
    super(`Recovery transition rejected: ${code}`);
    this.name = "RecoveryError";
  }
}

export function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RecoveryError(code);
}

export function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function nonempty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.origin === value;
  } catch {
    return false;
  }
}

export function isTerminal(state: RecoveryState): boolean {
  return ["recovered", "unnecessary", "blocked", "failed", "cancelled", "timed_out"].includes(state);
}

export function canCleanUp(incident: Incident): boolean {
  return isTerminal(incident.state) && incident.state !== "recovered" &&
    safeReplacementIdentity(incident) && !incident.cleanup &&
    incident.endpointObservation?.endpoint !== incident.deployment!.endpoint &&
    ["not_started", "failed"].includes(incident.operations.endpoint.status);
}

export function safeReplacementIdentity(incident: Incident): boolean {
  const receipt = incident.deployment;
  return !!receipt && nonempty(receipt.deploymentId) && nonempty(receipt.instanceId) &&
    receipt.instanceId !== incident.snapshot.primaryInstanceId &&
    isHttpsOrigin(receipt.endpoint) && receipt.endpoint !== incident.snapshot.primaryEndpoint;
}

export function inState(incident: Incident, ...states: RecoveryState[]) {
  requireCondition(states.includes(incident.state), "invalid_transition");
}

export function fresh(checkedAt: number, now: number, earliest: number) {
  requireCondition(validTime(checkedAt) && checkedAt >= earliest && checkedAt <= now && now - checkedAt <= 2_000, "stale_observation");
}

export function validateQuote(incident: Incident, quote: QuoteBinding, now: number) {
  for (const key of ["applicationId", "incidentId", "policyVersion", "providerId", "imageDigest"] as const) {
    requireCondition(quote[key] === incident.snapshot[key], "binding_mismatch");
  }
  requireCondition(quote.leaseSeconds === 600 && quote.network === "hedera:testnet" && quote.asset === "0.0.0", "invalid_quote");
  requireCondition(nonempty(quote.payTo) && nonempty(quote.quoteId) && /^[1-9]\d*$/.test(quote.amountAtomic), "invalid_quote");
  requireCondition(validTime(quote.expiresAt) && quote.expiresAt > now, "quote_expired");
  requireCondition(quote.expiresAt - now <= 60_000, "invalid_quote");
}

export function sameBinding(left: unknown, right: unknown) {
  requireCondition(fingerprint(left) === fingerprint(right), "binding_mismatch");
}

export function passingObservation(incident: Incident, observation: HealthObservation, now: number) {
  requireCondition(incident.deployment, "invalid_transition");
  requireCondition(
    observation.healthy && observation.instanceId === incident.deployment.instanceId &&
    observation.version === incident.snapshot.expectedVersion && validTime(observation.checkedAt) &&
    observation.checkedAt >= incident.deployment.readyAt && observation.checkedAt <= now,
    "invalid_observation",
  );
}

export function validDeployment(incident: Incident): boolean {
  const receipt = incident.deployment!;
  return safeReplacementIdentity(incident) && receipt.imageDigest === incident.snapshot.imageDigest &&
    validTime(receipt.createdAt) && validTime(receipt.readyAt) && validTime(receipt.expiresAt) &&
    receipt.createdAt >= incident.payment!.settledAt && receipt.readyAt >= receipt.createdAt &&
    receipt.readyAt <= incident.updatedAt && receipt.readyAt <= incident.payment!.settledAt + 60_000 &&
    receipt.expiresAt === receipt.createdAt + 600_000;
}
