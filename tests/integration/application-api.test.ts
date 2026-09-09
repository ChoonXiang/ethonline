import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { GET, POST } from "../../app/api/applications/route";
import { GET as GET_ONE } from "../../app/api/applications/[applicationId]/route";
import { GET as GET_HEALTH } from "../../app/api/applications/[applicationId]/health/route";
import { GET as HEALTH } from "../../app/api/health/route";
import { SqliteMonitoringStore } from "../../backend/monitoring/sqlite-store";
import { registration } from "../helpers/applications";

const ownerToken = "test-owner-token-0123456789abcdef0123456789";

async function configure(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "application-api-"));
  const values = {
    CONTROL_API_TOKEN: ownerToken,
    APPLICATION_ALLOWED_ORIGINS: "https://primary.example",
    APPLICATION_DATABASE_PATH: join(directory, "applications.sqlite"),
  };
  const previous = Object.keys(values).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, values);
  t.after(async () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });
  return values.APPLICATION_DATABASE_PATH;
}

function request(method = "GET", body?: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/applications", {
    method,
    headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json", ...headers },
    body,
  });
}

test("all application routes authenticate before reading the body or opening storage", async (t) => {
  const path = await configure(t);
  for (const authorization of ["", "Bearer wrong", `Basic ${ownerToken}`]) {
    const incoming = request("POST", "not json", { authorization, cookie: `token=${ownerToken}` });
    const response = await POST(incoming);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(incoming.bodyUsed, false);
    assert.equal((await GET(request("GET", undefined, { authorization }))).status, 401);
    assert.equal((await GET_ONE(request("GET", undefined, { authorization }), {
      params: Promise.resolve({ applicationId: "unknown" }),
    })).status, 401);
    assert.equal((await GET_HEALTH(request("GET", undefined, { authorization }), {
      params: Promise.resolve({ applicationId: "unknown" }),
    })).status, 401);
  }
  const queryToken = new Request(`http://localhost/api/applications?token=${ownerToken}`);
  assert.equal((await GET(queryToken)).status, 401);
  await assert.rejects(access(path));
});

test("missing registration configuration returns 503 while control API liveness stays available", async (t) => {
  const path = await configure(t);
  delete process.env.CONTROL_API_TOKEN;
  const response = await POST(request("POST", JSON.stringify(registration)));
  assert.equal(response.status, 503);
  assert.equal((await GET(request())).status, 503);
  assert.equal(HEALTH().status, 200);
  assert.deepEqual(await response.json(), { error: { code: "registration_unavailable" } });
  await assert.rejects(access(path));
});

test("create, get, and list expose the same persisted disarmed application", async (t) => {
  await configure(t);
  const created = await POST(request("POST", JSON.stringify(registration)));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const { application } = await created.json();
  assert.equal(application.status, "disarmed");
  assert.equal(application.armingId, null);
  assert.equal(application.currentEndpoint, "https://primary.example");
  assert.equal(created.headers.get("location"), `/api/applications/${application.applicationId}`);

  const detail = await GET_ONE(request(), { params: Promise.resolve({ applicationId: application.applicationId }) });
  assert.equal(detail.status, 200);
  assert.deepEqual(await detail.json(), { application });
  const listed = await GET(request());
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await listed.json(), { applications: [application] });
  assert.ok(!JSON.stringify(application).includes(ownerToken));
});

test("POST retries return 200 with the same identity and conflicting input returns 409", async (t) => {
  await configure(t);
  const first = await POST(request("POST", JSON.stringify(registration)));
  const original = await first.json();
  const retry = await POST(request("POST", JSON.stringify({ ...registration, primaryEndpoint: "https://primary.example/" })));
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), original);
  const conflict = await POST(request("POST", JSON.stringify({ ...registration, policyVersion: "policy-v2" })));
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: { code: "service_name_conflict" } });
  assert.deepEqual(await (await GET(request())).json(), { applications: [original.application] });
});

test("invalid registration never writes a record or echoes submitted secrets", async (t) => {
  await configure(t);
  for (const input of [
    { ...registration, privateKey: "sensitive-private-key" },
    { ...registration, credentialRef: "https://secrets.example?token=sensitive-private-key" },
    { ...registration, imageDigest: "registry.example/demo:latest" },
    { ...registration, primaryEndpoint: "https://unapproved.example" },
    { ...registration, status: "armed" },
    null,
  ]) {
    const response = await POST(request("POST", JSON.stringify(input)));
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.ok(!body.includes("sensitive-private-key"));
    assert.equal(JSON.parse(body).error.code, "invalid_registration");
  }
  assert.deepEqual(await (await GET(request())).json(), { applications: [] });
});

test("the API rejects malformed JSON, unsupported media types, and oversized bodies", async (t) => {
  await configure(t);
  assert.equal((await POST(request("POST", "{"))).status, 400);
  assert.equal((await POST(request("POST", JSON.stringify(registration), { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request("POST", "{}", { "content-length": "16385" }))).status, 413);
  assert.equal((await POST(request("POST", JSON.stringify({ ...registration, displayName: "x".repeat(17000) })))).status, 413);
  const chunk = new TextEncoder().encode("x".repeat(9_000));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const incoming = new Request("http://localhost/api/applications", {
    method: "POST", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
    body: stream, duplex: "half",
  } as RequestInit);
  assert.equal((await POST(incoming)).status, 413);
  assert.deepEqual(await (await GET(request())).json(), { applications: [] });
});

test("unknown application IDs return 404 and database errors do not expose local details", async (t) => {
  await configure(t);
  const missing = await GET_ONE(request(), { params: Promise.resolve({ applicationId: "' OR 1=1 --" }) });
  assert.equal(missing.status, 404);
  process.env.APPLICATION_DATABASE_PATH = tmpdir();
  const failed = await GET(request());
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: { code: "internal_error" } });
});

test("health status reads persisted worker evidence and distinguishes an unchecked application", async (t) => {
  const path = await configure(t);
  const created = await POST(request("POST", JSON.stringify(registration)));
  const { application } = await created.json();
  const context = { params: Promise.resolve({ applicationId: application.applicationId }) };
  const unchecked = await GET_HEALTH(request(), context);
  assert.equal(unchecked.status, 200);
  assert.equal((await unchecked.json()).health.status, "unknown");
  const store = new SqliteMonitoringStore(path);
  try {
    const claim = store.claim(application, 1_000)!;
    store.record(claim, { checkedAt: 1_000, healthy: false, instanceId: "", version: "", reason: "timeout" }, 3_000);
  } finally { store.close(); }
  const response = await GET_HEALTH(request(), context);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { health } = await response.json();
  assert.equal(health.status, "degraded");
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastCheck.reason, "timeout");
  assert.equal((await GET_HEALTH(request(), { params: Promise.resolve({ applicationId: "unknown" }) })).status, 404);
});
