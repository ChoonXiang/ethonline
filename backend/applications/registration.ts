import { randomUUID } from "node:crypto";
import { PROJECT_NAME } from "../config/project";
import { ApplicationError, type ApplicationStore, type RegistrationInput, type RegistrationResult } from "./types";
import { validateRegistration } from "./validation";

export function registerApplication(
  value: unknown,
  allowedOrigins: readonly string[],
  store: ApplicationStore,
): RegistrationResult {
  const input = validateRegistration(value, allowedOrigins);
  const now = Date.now();
  const result = store.insertIfAbsent({
    ...input,
    schemaVersion: 1,
    applicationId: `application_${randomUUID()}`,
    status: "disarmed",
    armingId: null,
    currentEndpoint: input.primaryEndpoint,
    expectedService: `${PROJECT_NAME}-demo-api`,
    healthPath: "/healthz",
    functionalPath: "/api/message",
    createdAt: now,
    updatedAt: now,
  });

  for (const key of Object.keys(input) as (keyof RegistrationInput)[]) {
    if (result.application[key] !== input[key]) throw new ApplicationError("service_name_conflict");
  }
  return result;
}
