import { ApplicationError, type RegistrationInput } from "./types";

const fields = [
  "displayName", "serviceName", "primaryEndpoint", "imageDigest",
  "expectedVersion", "policyRef", "policyVersion", "credentialRef",
] as const satisfies readonly (keyof RegistrationInput)[];

export function normalizeHttpsOrigin(value: string): string | undefined {
  if (!/^https:\/\/[^/?#\\%\s]+\/?$/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || value.includes("@")) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function invalid(field: keyof RegistrationInput | "body"): never {
  throw new ApplicationError("invalid_registration", field);
}

export function validateRegistration(value: unknown, allowedOrigins: readonly string[]): RegistrationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("body");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.some((field) => field === key))) invalid("body");

  const read = (field: keyof RegistrationInput, max: number): string => {
    const item = input[field];
    if (typeof item !== "string" || !item.trim() || item.length > max || /[\u0000-\u001f\u007f]/.test(item)) invalid(field);
    if (field !== "displayName" && item !== item.trim()) invalid(field);
    return item;
  };

  const displayName = read("displayName", 100).trim();
  // The MVP accepts ASCII .eth names; chain ownership is checked before arming.
  const rawServiceName = read("serviceName", 253);
  if (!/^[a-zA-Z0-9.-]+$/.test(rawServiceName)) invalid("serviceName");
  const serviceName = rawServiceName.toLowerCase();
  const labels = serviceName.split(".");
  if (labels.length < 2 || labels.at(-1) !== "eth" || labels.some((label) =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label.startsWith("xn--"),
  )) invalid("serviceName");

  const primaryEndpoint = normalizeHttpsOrigin(read("primaryEndpoint", 2048));
  if (!primaryEndpoint || !allowedOrigins.includes(primaryEndpoint)) invalid("primaryEndpoint");

  const imageDigest = read("imageDigest", 512);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]{1,5})?(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?@sha256:[a-f0-9]{64}$/.test(imageDigest)) invalid("imageDigest");

  const reference = (field: "policyRef" | "policyVersion" | "credentialRef") => {
    const item = read(field, 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(item) || item.includes("://")) invalid(field);
    return item;
  };

  return {
    displayName,
    serviceName,
    primaryEndpoint,
    imageDigest,
    expectedVersion: read("expectedVersion", 128),
    policyRef: reference("policyRef"),
    policyVersion: reference("policyVersion"),
    credentialRef: reference("credentialRef"),
  };
}
