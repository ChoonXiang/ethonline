import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { readMonitoringConfig } from "../../backend/config/monitoring";

test("monitoring stays idle without a configured allowlist", () => {
  assert.equal(readMonitoringConfig({}), undefined);
  assert.equal(readMonitoringConfig({ APPLICATION_ALLOWED_ORIGINS: "" }), undefined);
});

test("monitoring shares registration storage and origins without needing the owner API secret", () => {
  const config = readMonitoringConfig({
    APPLICATION_ALLOWED_ORIGINS: "https://PRIMARY.example:443/",
    APPLICATION_DATABASE_PATH: "var/shared.sqlite",
  });
  assert.deepEqual(config, { allowedOrigins: ["https://primary.example"], databasePath: resolve("var/shared.sqlite") });
});

test("malformed monitoring configuration fails closed", () => {
  for (const env of [
    { APPLICATION_ALLOWED_ORIGINS: "http://localhost:4001" },
    { APPLICATION_ALLOWED_ORIGINS: "https://primary.example," },
    { APPLICATION_ALLOWED_ORIGINS: "https://primary.example", APPLICATION_DATABASE_PATH: ":memory:" },
  ]) assert.throws(() => readMonitoringConfig(env));
});
