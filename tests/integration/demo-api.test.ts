import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { createDemoServer } from "../../demo/api/server.mjs";

async function startDemo(t: TestContext) {
  const server = createDemoServer();
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("health and functional requests identify the same live demo instance", async (t) => {
  const endpoint = await startDemo(t);
  const healthResponse = await fetch(`${endpoint}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("cache-control"), "no-store");
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  assert.equal(health.service, "[project-name]-demo-api");
  assert.equal(health.version, "1.0.0");
  assert.match(health.instanceId, /^[0-9a-f-]{36}$/);

  const messageResponse = await fetch(`${endpoint}/api/message`);
  assert.equal(messageResponse.status, 200);
  const message = await messageResponse.json();
  assert.equal(message.instanceId, health.instanceId);
  assert.equal(message.version, health.version);
  assert.equal(message.message, "[project-name] demo API is available");

  const secondEndpoint = await startDemo(t);
  const second = await fetch(`${secondEndpoint}/healthz`).then((r) => r.json());
  assert.notEqual(second.instanceId, health.instanceId);
});

test("demo exposes read-only endpoints and no remote shutdown route", async (t) => {
  const endpoint = await startDemo(t);
  const post = await fetch(`${endpoint}/healthz`, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");

  const head = await fetch(`${endpoint}/healthz`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const unknown = await fetch(`${endpoint}/simulate-failure`, { method: "POST" });
  assert.equal(unknown.status, 404);
  assert.equal((await fetch(`${endpoint}/healthz`)).status, 200);
});
