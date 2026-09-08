import assert from "node:assert/strict";
import { test } from "node:test";
import { createIncident, transition } from "../../backend/recovery/state-machine";
import { advanceThrough, at, binding, health, recoveryEvents, snapshot } from "../helpers/recovery";

test("recovery needs settlement, deployment, verification, ENS readback, then independent client success", () => {
  let incident = createIncident(snapshot, at(0));
  const states = ["purchase_ready", "purchasing", "provisioning", "verifying", "cutover_ready", "updating_endpoint", "verifying_client", "recovered"];
  Object.values(recoveryEvents()).forEach((event, index) => {
    const previous = JSON.stringify(incident);
    const next = transition(incident, event, incident.revision);
    assert.equal(JSON.stringify(incident), previous, "does not mutate stored input");
    incident = next;
    assert.equal(incident.state, states[index]);
    assert.equal(incident.revision, index + 1);
  });
  assert.equal(incident.reservation?.status, "settled");
  assert.equal(incident.payment?.transactionId, "test-settlement-1");
  assert.equal(incident.deployment?.deploymentId, "deployment-1");
  assert.equal(incident.endpoint?.transactionId, "test-ens-tx-1");
  assert.equal(incident.journal.length, 8);
});

test("duplicate delivery is a no-op across a JSON restart and an old revision", () => {
  const original = advanceThrough("purchase");
  const restored = JSON.parse(JSON.stringify(original));
  const replayed = transition(restored, recoveryEvents().purchase, 1);
  assert.deepEqual(replayed, original);
  assert.equal(replayed.operations.purchase.id, original.operations.purchase.id);
  assert.throws(() => transition(restored, {
    ...recoveryEvents().purchase, reservationId: "another-reservation",
  }, 1), { code: "event_conflict" });
});

test("concurrent stale writers and attempts to start another purchase are rejected", () => {
  const incident = advanceThrough("purchase");
  assert.throws(() => transition(incident, recoveryEvents().settlement, 1), { code: "revision_conflict" });
  assert.throws(() => transition(incident, {
    ...recoveryEvents().purchase, id: "second-purchase", at: at(2_500),
  }, incident.revision), { code: "invalid_transition" });
  assert.throws(() => transition(incident, {
    ...recoveryEvents().settlement, operationId: "other-incident-operation",
  }, incident.revision), { code: "operation_mismatch" });
});

test("an incident cannot skip payment, deployment, or ENS confirmation", () => {
  const initial = createIncident(snapshot, at(0));
  for (const event of [recoveryEvents().deployment, recoveryEvents().confirmation, recoveryEvents().client]) {
    assert.throws(() => transition(initial, event, initial.revision), { code: "invalid_transition" });
  }
  const cutover = advanceThrough("cutover");
  assert.throws(() => transition(cutover, recoveryEvents().client, cutover.revision), { code: "invalid_transition" });
});

test("approval binds every quote field and the incident snapshot", () => {
  const initial = createIncident(snapshot, at(0));
  for (const [field, value] of Object.entries(binding)) {
    const changed = { ...binding, [field]: typeof value === "number" ? value + 1 : `${value}-changed` };
    assert.throws(() => transition(initial, {
      ...recoveryEvents().approval, approval: { ...recoveryEvents().approval.approval, binding: changed },
    }, 0), { code: "binding_mismatch" }, field);
  }
  const other = { ...binding, incidentId: "another-incident" };
  assert.throws(() => transition(initial, {
    ...recoveryEvents().approval, quote: other, approval: { ...recoveryEvents().approval.approval, binding: other },
  }, 0), { code: "binding_mismatch" });
});

test("a changed or expired quote needs a new approval before purchase", () => {
  let incident = advanceThrough("approval");
  assert.throws(() => transition(incident, {
    ...recoveryEvents().purchase, at: at(60_000), primaryCheckedAt: at(60_000),
  }, incident.revision), { code: "quote_expired" });
  const renewed = { ...binding, quoteId: "quote-2", expiresAt: at(100_000) };
  incident = transition(incident, {
    ...recoveryEvents().approval, id: "renewal", at: at(60_000), quote: renewed,
    approval: { ...recoveryEvents().approval.approval, binding: renewed },
  }, incident.revision);
  incident = transition(incident, {
    ...recoveryEvents().purchase, at: at(61_000), primaryCheckedAt: at(61_000),
  }, incident.revision);
  assert.equal(incident.state, "purchasing");
  assert.equal(incident.quote?.quoteId, "quote-2");
});

test("purchase requires fresh primary failure and a reservation reference", () => {
  const incident = advanceThrough("approval");
  for (const patch of [
    { primaryCheckedAt: at(-1) },
    { primaryCheckedAt: at(3_000) },
    { primaryHealthy: true },
    { reservationId: "" },
  ]) {
    assert.throws(() => transition(incident, { ...recoveryEvents().purchase, ...patch }, incident.revision));
  }
});

test("primary recovery and policy denial terminate without starting a purchase", () => {
  const initial = createIncident(snapshot, at(0));
  for (const [event, state] of [
    [{ id: "healthy", type: "primary.recovered", at: at(1_000), checkedAt: at(1_000) }, "unnecessary"],
    [{ id: "denied", type: "policy.denied", at: at(1_000), reason: "policy_denied" }, "blocked"],
  ] as const) {
    const incident = transition(initial, event, 0);
    assert.equal(incident.state, state);
    assert.equal(incident.operations.purchase.status, "not_started");
    assert.equal(incident.reservation, undefined);
  }
});

test("settlement evidence must match the purchased amount and recipient", () => {
  const incident = advanceThrough("purchase");
  for (const patch of [{ amountAtomic: "1" }, { payTo: "0.0.999" }, { network: "another-network" }, { asset: "other-asset" }]) {
    assert.throws(() => transition(incident, {
      ...recoveryEvents().settlement, receipt: { ...recoveryEvents().settlement.receipt, ...patch },
    }, incident.revision), { code: "binding_mismatch" });
  }
});

test("unknown payment keeps its reservation until an authoritative result arrives", () => {
  let incident = advanceThrough("purchase");
  incident = transition(incident, {
    id: "unknown", type: "purchase.unknown", at: at(2_500), operationId: incident.operations.purchase.id,
  }, incident.revision);
  assert.equal(incident.reservation?.status, "held");
  assert.throws(() => transition(incident, {
    id: "release", type: "reservation.released", at: at(2_600), reservationId: "reservation-1",
  }, incident.revision), { code: "invalid_transition" });
  const settled = transition(incident, recoveryEvents().settlement, incident.revision);
  assert.equal(settled.reservation?.status, "settled");
  const failed = transition(incident, {
    id: "failed", type: "purchase.failed", at: at(3_000), operationId: incident.operations.purchase.id,
  }, incident.revision);
  assert.equal(failed.reservation?.status, "release_pending");
  const released = transition(failed, {
    id: "release", type: "reservation.released", at: at(3_100), reservationId: "reservation-1",
  }, failed.revision);
  assert.equal(released.reservation?.status, "released");
  assert.equal(released.state, "failed");
});

test("disarming stops new purchases and endpoint writes while accepting late settlement", () => {
  for (const last of ["approval", "purchase", "verification"] as const) {
    const initial = advanceThrough(last);
    const stopped = transition(initial, { id: "stop", type: "stop", at: at(16_500), reason: "disarmed" }, initial.revision);
    assert.equal(stopped.state, "cancelled");
    const event = last === "verification" ? recoveryEvents().cutover : { ...recoveryEvents().purchase, id: "another-start", at: at(17_000), primaryCheckedAt: at(17_000) };
    assert.throws(() => transition(stopped, event, stopped.revision), { code: "invalid_transition" });
    if (last === "purchase") {
      const settled = transition(stopped, { ...recoveryEvents().settlement, at: at(17_000) }, stopped.revision);
      assert.equal(settled.state, "cancelled");
      assert.equal(settled.reservation?.status, "settled");
    }
  }
});

test("deadline boundary forbids new effects even if no timer event was delivered", () => {
  const approval = advanceThrough("approval");
  assert.throws(() => transition(approval, {
    ...recoveryEvents().purchase, at: at(180_000), primaryCheckedAt: at(180_000),
  }, approval.revision), { code: "deadline_exceeded" });
  const ready = advanceThrough("verification");
  assert.throws(() => transition(ready, {
    ...recoveryEvents().cutover, at: at(180_000), health: health(180_000),
  }, ready.revision), { code: "deadline_exceeded" });
  assert.throws(() => transition(ready, { id: "early", type: "deadline.elapsed", at: at(179_999) }, ready.revision));
});

test("late success is retained as evidence but cannot turn a timed-out recovery into success", () => {
  const confirming = advanceThrough("confirmation");
  const late = { ...recoveryEvents().client, at: at(180_000), observation: health(180_000) };
  const automatic = transition(confirming, late, confirming.revision);
  assert.equal(automatic.state, "timed_out");
  assert.equal(automatic.client?.observation.instanceId, "replacement-1");
  const expired = transition(confirming, { id: "expired", type: "deadline.elapsed", at: at(180_000) }, confirming.revision);
  const reconciled = transition(expired, late, expired.revision);
  assert.equal(reconciled.state, "timed_out");
  assert.equal(reconciled.reason, "deadline_exceeded");
});

test("wrong image, reused instance, wrong lease, and late readiness fail with deployment evidence retained", () => {
  const paid = advanceThrough("settlement");
  for (const patch of [
    { imageDigest: `registry.example/demo@sha256:${"b".repeat(64)}` },
    { instanceId: snapshot.primaryInstanceId },
    { endpoint: snapshot.primaryEndpoint },
    { expiresAt: at(605_000) },
    { readyAt: at(63_001) },
  ]) {
    const failed = transition(paid, {
      ...recoveryEvents().deployment, at: at(63_001), receipt: { ...recoveryEvents().deployment.receipt, ...patch },
    }, paid.revision);
    assert.equal(failed.state, "failed");
    assert.equal(failed.reason, "invalid_deployment");
    assert.equal(failed.reservation?.status, "settled");
    assert.equal(failed.deployment?.deploymentId, "deployment-1");
  }
});

test("replacement checks reject missing, failed, rapid, future, and mismatched observations", () => {
  const deployed = advanceThrough("deployment");
  for (const observations of [
    [health(5_000), health(10_000)],
    [health(5_000), { ...health(10_000), healthy: false }, health(15_000)],
    [health(5_000), health(9_999), health(15_000)],
    [health(5_000), health(10_000), health(17_000)],
    [health(5_000), health(10_000), { ...health(15_000), instanceId: "other" }],
    [health(5_000), health(10_000), { ...health(15_000), version: "2.0.0" }],
  ]) {
    assert.throws(() => transition(deployed, { ...recoveryEvents().verification, health: observations }, deployed.revision));
  }
  assert.throws(() => transition(deployed, {
    ...recoveryEvents().verification, functional: { ...health(16_000), healthy: false },
  }, deployed.revision), { code: "invalid_observation" });
});

test("cutover preserves owner changes and revoked permission without recording a submitted transaction", () => {
  const ready = advanceThrough("verification");
  for (const [patch, reason] of [
    [{ observedEndpoint: "https://owner-choice.example" }, "owner_changed_endpoint"],
    [{ permissionGranted: false }, "permission_revoked"],
  ] as const) {
    const blocked = transition(ready, { ...recoveryEvents().cutover, ...patch }, ready.revision);
    assert.equal(blocked.state, "blocked");
    assert.equal(blocked.reason, reason);
    assert.equal(blocked.operations.endpoint.status, "not_started");
  }
  assert.throws(() => transition(ready, {
    ...recoveryEvents().cutover, at: at(20_000), health: health(17_000),
  }, ready.revision), { code: "stale_observation" });
  assert.throws(() => transition(ready, {
    ...recoveryEvents().cutover, preflightCheckedAt: at(14_000),
  }, ready.revision), { code: "stale_observation" });
});

test("ENS receipt must match the persisted transaction and have two confirmations", () => {
  const updating = advanceThrough("cutover");
  assert.equal(updating.operations.endpoint.transactionId, "test-ens-tx-1");
  for (const patch of [
    { transactionId: "other-tx" }, { confirmations: 1 },
  ]) {
    assert.throws(() => transition(updating, { ...recoveryEvents().confirmation, ...patch }, updating.revision), { code: "invalid_receipt" });
  }
});

test("client evidence must come through the registered ENS name and replacement instance", () => {
  const confirmed = advanceThrough("confirmation");
  for (const patch of [
    { serviceName: "other.example.eth" }, { resolvedEndpoint: snapshot.primaryEndpoint },
    { observation: { ...health(26_000), instanceId: snapshot.primaryInstanceId } },
  ]) {
    assert.throws(() => transition(confirmed, { ...recoveryEvents().client, ...patch }, confirmed.revision));
  }
});

test("unknown ENS outcome forbids cleanup until a definitive failed receipt is reconciled", () => {
  let incident = advanceThrough("cutover");
  incident = transition(incident, { id: "ens-unknown", type: "endpoint.unknown", at: at(18_000), operationId: incident.operations.endpoint.id }, incident.revision);
  incident = transition(incident, { id: "stop", type: "stop", at: at(19_000), reason: "emergency_stop" }, incident.revision);
  const cleanup = {
    id: "cleanup", type: "cleanup.started", at: at(21_000), operationId: incident.operations.cleanup.id,
    observedEndpoint: snapshot.primaryEndpoint, preflightCheckedAt: at(21_000),
  } as const;
  assert.throws(() => transition(incident, cleanup, incident.revision), { code: "unsafe_cleanup" });
  incident = transition(incident, { id: "ens-failed", type: "endpoint.failed", at: at(20_000), operationId: incident.operations.endpoint.id, transactionId: "test-ens-tx-1" }, incident.revision);
  incident = transition(incident, cleanup, incident.revision);
  assert.equal(incident.state, "cancelled");
  assert.equal(incident.operations.cleanup.status, "pending");
  incident = transition(incident, { id: "cleanup-unknown", type: "cleanup.unknown", at: at(22_000), operationId: incident.operations.cleanup.id }, incident.revision);
  assert.equal(incident.operations.cleanup.status, "unknown");
  incident = transition(incident, { id: "cleaned", type: "cleanup.completed", at: at(23_000), operationId: incident.operations.cleanup.id, receiptRef: "test-termination-1" }, incident.revision);
  assert.equal(incident.cleanup?.outcome, "terminated");
});

test("published candidates are retained after client failure and lease expiry preserves history", () => {
  const confirmed = advanceThrough("confirmation");
  const failed = transition(confirmed, { id: "client-failed", type: "client.failed", at: at(26_000) }, confirmed.revision);
  for (const incident of [failed, advanceThrough("client")]) {
    assert.throws(() => transition(incident, {
      id: "cleanup", type: "cleanup.started", at: at(27_000), operationId: incident.operations.cleanup.id,
      observedEndpoint: "https://replacement.example", preflightCheckedAt: at(27_000),
    }, incident.revision), { code: "unsafe_cleanup" });
    assert.throws(() => transition(incident, { id: "expiry", type: "lease.expired", at: at(603_999), receiptRef: "test-expiry" }, incident.revision));
    const expired = transition(incident, { id: "expiry", type: "lease.expired", at: at(604_000), receiptRef: "test-expiry" }, incident.revision);
    assert.equal(expired.state, incident.state);
    assert.equal(expired.cleanup?.outcome, "expired");
  }
});

test("delayed client observations survive timeout reconciliation without changing the historical outcome", () => {
  const confirmed = advanceThrough("confirmation");
  const expired = transition(confirmed, {
    id: "timeout", type: "deadline.elapsed", at: at(180_000),
  }, confirmed.revision);
  const reconciled = transition(expired, {
    ...recoveryEvents().client, at: at(181_000),
  }, expired.revision);
  assert.equal(reconciled.state, "timed_out");
  assert.equal(reconciled.client?.observation.checkedAt, at(26_000));
  assert.equal(reconciled.updatedAt, at(181_000));
});
