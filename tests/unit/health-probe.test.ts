import assert from "node:assert/strict";
import { test } from "node:test";
import { probeHealth } from "../../backend/monitoring/probe";

const target = {
  currentEndpoint: "https://primary.example",
  expectedService: "[project-name]-demo-api",
  expectedVersion: "1.0.0",
  healthPath: "/healthz" as const,
};
const body = { status: "ok", service: "[project-name]-demo-api", version: "1.0.0", instanceId: "primary-1" };
const options = { allowedOrigins: ["https://primary.example"] };

test("health probes use the registered path without credentials, caching, or redirects", async () => {
  const result = await probeHealth(target, {
    ...options,
    fetch: async (url, init) => {
      assert.equal(String(url), "https://primary.example/healthz");
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return Response.json(body);
    },
  });
  assert.equal(result.healthy, true);
  assert.equal(result.instanceId, "primary-1");
  assert.equal(result.version, "1.0.0");
  assert.ok(Number.isSafeInteger(result.checkedAt));
});

test("non-200, redirects, malformed JSON, and mismatched identities cannot pass", async () => {
  const cases = [
    { response: () => new Response(null, { status: 503 }), reason: "http_status" },
    { response: () => new Response(null, { status: 302, headers: { location: "https://unapproved.example" } }), reason: "http_status" },
    { response: () => new Response("{"), reason: "invalid_json" },
    ...[null, [], {}, { ...body, status: "down" }, { ...body, service: "other" },
      { ...body, version: "2.0.0" }, { ...body, instanceId: " " }, { ...body, instanceId: 3 }]
      .map((value) => ({ response: () => Response.json(value), reason: "invalid_response" })),
    { response: () => new Response("x".repeat(16_385)), reason: "response_too_large" },
  ];
  for (const { response, reason } of cases) {
    const result = await probeHealth(target, { ...options, fetch: async () => response() });
    assert.equal(result.healthy, false);
    assert.equal(result.reason, reason);
    assert.equal(result.instanceId, "");
  }
});

test("unapproved and non-HTTPS destinations are rejected before opening a connection", async () => {
  for (const endpoint of ["https://unapproved.example", "http://primary.example", "https://user:secret@primary.example", "https://primary.example/path"]) {
    const result = await probeHealth({ ...target, currentEndpoint: endpoint }, {
      ...options,
      fetch: async () => { assert.fail("a rejected destination must never be fetched"); },
    });
    assert.equal(result.reason, "endpoint_not_allowed");
  }
});

test("network failures produce safe evidence without leaking the exception", async () => {
  const result = await probeHealth(target, {
    ...options, fetch: async () => { throw new Error("secret connection detail"); },
  });
  assert.equal(result.reason, "network_error");
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("the deadline includes reading a stalled response body", { timeout: 2_000 }, async () => {
  const result = await probeHealth(target, {
    ...options, timeoutMs: 20,
    fetch: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":'));
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
      },
    })),
  });
  assert.equal(result.reason, "timeout");
});

test("shutdown cancellation is distinguished from an application outage", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await probeHealth(target, {
    ...options, signal: controller.signal,
    fetch: async () => { assert.fail("cancelled probes must not start"); },
  });
  assert.equal(result.reason, "cancelled");
});
