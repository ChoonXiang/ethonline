import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { readApplicationConfig } from "../../backend/config/applications";

const env = {
  CONTROL_API_TOKEN: "test-owner-token-0123456789abcdef0123456789",
  APPLICATION_ALLOWED_ORIGINS: "https://PRIMARY.example:443/, https://second.example",
};

test("application config canonicalizes an explicit origin allowlist and uses persistent local storage", () => {
  const config = readApplicationConfig(env);
  assert.deepEqual(config.allowedOrigins, ["https://primary.example", "https://second.example"]);
  assert.equal(config.databasePath, resolve("var/applications.sqlite"));
  assert.equal(config.ownerToken, env.CONTROL_API_TOKEN);
});

test("application config fails closed for missing authentication or invalid allowlists", () => {
  for (const input of [
    {}, { ...env, CONTROL_API_TOKEN: "" }, { ...env, CONTROL_API_TOKEN: "short" },
    { ...env, CONTROL_API_TOKEN: "a".repeat(31) + " " },
    { ...env, CONTROL_API_TOKEN: env.CONTROL_API_TOKEN + "\n" },
    { ...env, APPLICATION_ALLOWED_ORIGINS: "" },
    { ...env, APPLICATION_ALLOWED_ORIGINS: "*" },
    { ...env, APPLICATION_ALLOWED_ORIGINS: "http://primary.example" },
    { ...env, APPLICATION_ALLOWED_ORIGINS: "https://primary.example/path" },
    { ...env, APPLICATION_ALLOWED_ORIGINS: "https://primary.example," },
    { ...env, APPLICATION_DATABASE_PATH: ":memory:" },
    { ...env, APPLICATION_DATABASE_PATH: " " },
  ]) {
    assert.throws(() => readApplicationConfig(input));
  }
});
