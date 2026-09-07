import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../../app/api/health/route";

test("control API liveness does not imply recovery readiness and is never cached", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.recoveryReady, false);
});
