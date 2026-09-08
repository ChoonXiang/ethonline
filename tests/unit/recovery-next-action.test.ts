import assert from "node:assert/strict";
import { test } from "node:test";
import { nextAction, readRetryAt } from "../../backend/recovery/next-action";
import { createIncident, transition } from "../../backend/recovery/state-machine";
import { advanceThrough, at, recoveryEvents, snapshot } from "../helpers/recovery";

test("planner selects the next step and gives the independent client only the ENS name", () => {
  assert.deepEqual(nextAction(createIncident(snapshot, at(0)), at(0)), { type: "evaluate_policy" });
  for (const [last, type] of [
    ["approval", "prepare_purchase"], ["purchase", "reconcile_purchase"],
    ["settlement", "reconcile_deployment"], ["deployment", "verify_replacement"],
    ["verification", "prepare_cutover"], ["cutover", "reconcile_endpoint"],
    ["client", "retain_lease"],
  ] as const) {
    const incident = advanceThrough(last);
    assert.equal(nextAction(incident, incident.updatedAt).type, type);
  }
  assert.deepEqual(nextAction(advanceThrough("confirmation"), at(25_000)), {
    type: "verify_client", serviceName: "api.example.eth",
  });
});

test("JSON restart reconciles persisted intent without resubmitting a purchase or ENS write", () => {
  for (const last of ["purchase", "cutover"] as const) {
    const incident = advanceThrough(last);
    const restored = JSON.parse(JSON.stringify(incident));
    assert.deepEqual(nextAction(restored, at(30_000)), {
      type: last === "purchase" ? "reconcile_purchase" : "reconcile_endpoint",
      operationId: incident.operations[last === "purchase" ? "purchase" : "endpoint"].id,
      ...(last === "cutover" ? { transactionId: "test-ens-tx-1" } : {}),
    });
  }
});

test("timeout stops new recovery but continues reconciling a late paid deployment for cleanup", () => {
  let incident = advanceThrough("purchase");
  assert.deepEqual(nextAction(incident, at(180_000)), { type: "expire_incident" });
  incident = transition(incident, { id: "timeout", type: "deadline.elapsed", at: at(180_000) }, incident.revision);
  assert.equal(incident.reservation?.status, "held");
  assert.deepEqual(nextAction(incident, at(181_000)), { type: "reconcile_purchase", operationId: incident.operations.purchase.id });
  incident = transition(incident, { ...recoveryEvents().settlement, at: at(182_000) }, incident.revision);
  assert.deepEqual(nextAction(incident, at(183_000)), { type: "reconcile_deployment", operationId: incident.operations.purchase.id });
  incident = transition(incident, { ...recoveryEvents().deployment, at: at(184_000) }, incident.revision);
  assert.equal(incident.state, "timed_out");
  assert.deepEqual(nextAction(incident, at(185_000)), { type: "prepare_cleanup", operationId: incident.operations.cleanup.id });
});

test("deployment readiness timeout retains the pending provider operation for reconciliation", () => {
  const paid = advanceThrough("settlement");
  assert.equal(nextAction(paid, at(62_999)).type, "reconcile_deployment");
  assert.equal(nextAction(paid, at(63_000)).type, "expire_deployment");
  assert.throws(() => transition(paid, { id: "timeout", type: "deployment.deadline_elapsed", at: at(62_999) }, paid.revision));
  const expired = transition(paid, { id: "timeout", type: "deployment.deadline_elapsed", at: at(63_000) }, paid.revision);
  assert.equal(expired.state, "failed");
  assert.equal(expired.reason, "deployment_deadline_exceeded");
  assert.equal(nextAction(expired, at(64_000)).type, "reconcile_deployment");
});

test("published and unresolved endpoints keep their lease while failures before publication allow cleanup", () => {
  for (const last of ["deployment", "cutover", "confirmation"] as const) {
    const initial = advanceThrough(last);
    const stopped = transition(initial, { id: "stop", type: "stop", at: at(30_000), reason: "disarmed" }, initial.revision);
    const expected = { deployment: "prepare_cleanup", cutover: "reconcile_endpoint", confirmation: "retain_lease" };
    assert.equal(nextAction(stopped, at(31_000)).type, expected[last]);
  }
});

test("lease expiry requires provider evidence and does not erase recovery success", () => {
  const recovered = advanceThrough("client");
  assert.equal(nextAction(recovered, at(604_000)).type, "reconcile_lease");
  const expired = transition(recovered, { id: "expired", type: "lease.expired", at: at(604_000), receiptRef: "test-expiry" }, recovered.revision);
  assert.equal(expired.state, "recovered");
  assert.deepEqual(nextAction(expired, at(605_000)), { type: "none" });
});

test("only authoritative non-settlement permits reservation release", () => {
  const purchase = advanceThrough("purchase");
  const failed = transition(purchase, { id: "failed", type: "purchase.failed", at: at(3_000), operationId: purchase.operations.purchase.id }, purchase.revision);
  assert.deepEqual(nextAction(failed, at(4_000)), { type: "release_reservation", reservationId: "reservation-1" });
  const released = transition(failed, { id: "release", type: "reservation.released", at: at(5_000), reservationId: "reservation-1" }, failed.revision);
  assert.deepEqual(nextAction(released, at(6_000)), { type: "none" });
});

test("read retries stop after two additional attempts and at the recovery deadline", () => {
  assert.equal(readRetryAt(at(0), 1, at(180_000)), at(1_000));
  assert.equal(readRetryAt(at(0), 2, at(180_000)), at(3_000));
  assert.equal(readRetryAt(at(0), 3, at(180_000)), undefined);
  assert.equal(readRetryAt(at(0), 0, at(180_000)), undefined);
  assert.equal(readRetryAt(at(179_000), 1, at(180_000)), undefined);
});

test("a rejected receipt identifying the primary cannot authorize cleanup or expiry", () => {
  const paid = advanceThrough("settlement");
  for (const patch of [
    { instanceId: snapshot.primaryInstanceId },
    { endpoint: snapshot.primaryEndpoint },
    { endpoint: "http://replacement.example" },
  ]) {
    const rejected = transition(paid, {
      ...recoveryEvents().deployment,
      receipt: { ...recoveryEvents().deployment.receipt, ...patch },
    }, paid.revision);
    assert.deepEqual(nextAction(rejected, at(6_000)), { type: "manual_review", reason: "unsafe_deployment_identity" });
    assert.throws(() => transition(rejected, {
      id: "cleanup", type: "cleanup.started", at: at(6_000), operationId: rejected.operations.cleanup.id,
      observedEndpoint: snapshot.primaryEndpoint, preflightCheckedAt: at(6_000),
    }, rejected.revision), { code: "unsafe_cleanup" });
    assert.throws(() => transition(rejected, {
      id: "expired", type: "lease.expired", at: at(604_000), receiptRef: "test-expiry",
    }, rejected.revision), { code: "invalid_transition" });
  }
  const wrongImage = transition(paid, {
    ...recoveryEvents().deployment, receipt: { ...recoveryEvents().deployment.receipt, imageDigest: "wrong-image" },
  }, paid.revision);
  assert.equal(nextAction(wrongImage, at(6_000)).type, "prepare_cleanup");
});

test("an owner-published candidate is retained even though the agent never submitted its write", () => {
  const ready = advanceThrough("verification");
  const blocked = transition(ready, {
    ...recoveryEvents().cutover, observedEndpoint: "https://replacement.example",
  }, ready.revision);
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.operations.endpoint.status, "not_started");
  assert.equal(blocked.endpointObservation?.endpoint, "https://replacement.example");
  assert.deepEqual(nextAction(blocked, at(18_000)), { type: "retain_lease" });
  assert.throws(() => transition(blocked, {
    id: "cleanup", type: "cleanup.started", at: at(18_000), operationId: blocked.operations.cleanup.id,
    observedEndpoint: "https://replacement.example", preflightCheckedAt: at(18_000),
  }, blocked.revision), { code: "unsafe_cleanup" });
});

test("a successful ENS transaction with different readback closes incomplete recovery without endless reconciliation", () => {
  const updating = advanceThrough("cutover");
  const incomplete = transition(updating, {
    ...recoveryEvents().confirmation, readbackEndpoint: "https://owner-choice.example",
  }, updating.revision);
  assert.equal(incomplete.state, "failed");
  assert.equal(incomplete.reason, "endpoint_readback_mismatch");
  assert.equal(incomplete.operations.endpoint.status, "succeeded");
  assert.equal(incomplete.endpoint?.transactionId, "test-ens-tx-1");
  assert.equal(incomplete.endpoint?.readbackEndpoint, "https://owner-choice.example");
  assert.deepEqual(nextAction(incomplete, at(26_000)), { type: "retain_lease" });
  assert.equal(nextAction(incomplete, at(604_000)).type, "reconcile_lease");
});

test("cleanup rereads ENS so a newly owner-published candidate is retained", () => {
  const deployed = advanceThrough("deployment");
  const failed = transition(deployed, { id: "unhealthy", type: "replacement.failed", at: at(6_000) }, deployed.revision);
  assert.equal(nextAction(failed, at(7_000)).type, "prepare_cleanup");
  const event = {
    id: "cleanup", type: "cleanup.started", at: at(9_000), operationId: failed.operations.cleanup.id,
    observedEndpoint: "https://replacement.example", preflightCheckedAt: at(9_000),
  } as const;
  assert.throws(() => transition(failed, { ...event, preflightCheckedAt: at(6_000) }, failed.revision), { code: "stale_observation" });
  const retained = transition(failed, event, failed.revision);
  assert.equal(retained.operations.cleanup.status, "not_started");
  assert.equal(nextAction(retained, at(10_000)).type, "retain_lease");
});
