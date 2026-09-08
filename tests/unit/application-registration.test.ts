import assert from "node:assert/strict";
import { test } from "node:test";
import { ApplicationError } from "../../backend/applications/types";
import { validateRegistration } from "../../backend/applications/validation";
import { allowedOrigins, registration } from "../helpers/applications";

test("registration normalizes service names and origins before storing or comparing them", () => {
  const result = validateRegistration({
    ...registration,
    displayName: "  Demo API  ",
    serviceName: "API.EXAMPLE.ETH",
    primaryEndpoint: "https://PRIMARY.example:443/",
  }, allowedOrigins);
  assert.deepEqual(result, registration);
});

test("registration rejects missing fields, unexpected fields, and caller-controlled recovery state", () => {
  const invalid: unknown[] = [null, [], true, "application"];
  for (const key of Object.keys(registration)) {
    invalid.push({ ...registration, [key]: undefined });
    invalid.push({ ...registration, [key]: "" });
    invalid.push({ ...registration, [key]: 42 });
  }
  for (const key of ["applicationId", "ownerId", "currentEndpoint", "status", "armingId", "providerUrl", "payTo", "privateKey", "credential", "policy", "healthPath"]) {
    invalid.push({ ...registration, [key]: "untrusted-value" });
  }
  for (const input of invalid) {
    assert.throws(() => validateRegistration(input, allowedOrigins), ApplicationError);
  }
});

test("registration accepts only an exact configured HTTPS origin without credentials or URL suffixes", () => {
  for (const primaryEndpoint of [
    "http://primary.example", "https://unapproved.example", "https://primary.example.evil.test",
    "https://primary.example:8443", "https://primary.example/path", "https://primary.example/../",
    "https://primary.example?", "https://primary.example/#", "https://primary.example?key=secret",
    "https://user:secret@primary.example", "https://@primary.example", "https://primary.example\\",
    "https://%70rimary.example", " https://primary.example", "https://primary.example\n",
  ]) {
    assert.throws(() => validateRegistration({ ...registration, primaryEndpoint }, allowedOrigins),
      (error: unknown) => error instanceof ApplicationError && error.field === "primaryEndpoint",
      primaryEndpoint);
  }
  assert.throws(() => validateRegistration(registration, []), ApplicationError);
});

test("registration rejects mutable images, malformed names, and secret values in reference fields", () => {
  const invalid: Record<string, string[]> = {
    imageDigest: ["registry.example/demo:latest", `https://registry.example/demo@sha256:${"a".repeat(64)}`, `registry.example/demo@sha256:${"g".repeat(64)}`, `registry.example/demo@sha256:${"a".repeat(63)}`],
    serviceName: ["eth", "api.example.com", ".eth", "api..eth", "api.example.eth.", "https://api.example.eth", "api_1.eth", "-api.eth", "api-.eth"],
    displayName: [" ", "x".repeat(101), "Demo\nAPI"],
    expectedVersion: [" ", "1.0.0\n", "x".repeat(129)],
    policyRef: ["{\"budget\":100}", "https://user:secret@policy.example", "policy?token=secret"],
    policyVersion: ["v1\nv2", " "],
    credentialRef: ["-----BEGIN PRIVATE KEY-----\nsecret", "secret token", "https://secrets.example?token=secret"],
  };
  for (const [field, values] of Object.entries(invalid)) {
    for (const value of values) {
      assert.throws(() => validateRegistration({ ...registration, [field]: value }, allowedOrigins),
        (error: unknown) => error instanceof ApplicationError && error.field === field,
        field);
    }
  }
});
