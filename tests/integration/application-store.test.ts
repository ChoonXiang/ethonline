import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerApplication } from "../../backend/applications/registration";
import { SqliteApplicationStore } from "../../backend/applications/sqlite-store";
import { ApplicationError } from "../../backend/applications/types";
import { allowedOrigins, registration } from "../helpers/applications";

test("registered applications remain disarmed and survive closing and reopening storage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "applications-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "data", "applications.sqlite");
  const first = new SqliteApplicationStore(path);
  let result;
  try {
    result = registerApplication(registration, allowedOrigins, first);
    assert.equal(result.created, true);
    assert.match(result.application.applicationId, /^application_[0-9a-f-]{36}$/);
    assert.equal(result.application.status, "disarmed");
    assert.equal(result.application.armingId, null);
    assert.equal(result.application.currentEndpoint, "https://primary.example");
    assert.equal(result.application.expectedService, "[project-name]-demo-api");
    assert.equal(result.application.healthPath, "/healthz");
    assert.equal(result.application.functionalPath, "/api/message");
    assert.ok(Number.isSafeInteger(result.application.createdAt));
  } finally {
    first.close();
  }

  const reopened = new SqliteApplicationStore(path);
  try {
    assert.deepEqual(reopened.get(result.application.applicationId), result.application);
    assert.deepEqual(reopened.list(), [result.application]);
    assert.equal(reopened.get("unknown"), undefined);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    reopened.close();
  }
});

test("duplicate registration replays the same application and conflicting changes cannot overwrite it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "applications-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "applications.sqlite");
  const first = new SqliteApplicationStore(path);
  const second = new SqliteApplicationStore(path);
  try {
    const original = registerApplication(registration, allowedOrigins, first).application;
    const retry = registerApplication({ ...registration, serviceName: "API.EXAMPLE.ETH" }, allowedOrigins, second);
    assert.equal(retry.created, false);
    assert.deepEqual(retry.application, original);
    for (const key of ["displayName", "expectedVersion", "policyVersion", "credentialRef"]) {
      assert.throws(() => registerApplication({ ...registration, [key]: "changed" }, allowedOrigins, second),
        (error: unknown) => error instanceof ApplicationError && error.code === "service_name_conflict");
    }
    assert.deepEqual(second.list(), [original]);
  } finally {
    first.close();
    second.close();
  }
});
