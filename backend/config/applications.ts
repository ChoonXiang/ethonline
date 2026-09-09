import { resolve } from "node:path";
import { normalizeHttpsOrigin } from "../applications/validation";

export interface ApplicationConfig {
  ownerToken: string;
  allowedOrigins: string[];
  databasePath: string;
}

export class ApplicationConfigError extends Error {
  constructor() {
    super("Application registration is not configured");
    this.name = "ApplicationConfigError";
  }
}

export function readApplicationConfig(env: Readonly<Record<string, string | undefined>>): ApplicationConfig {
  const ownerToken = env.CONTROL_API_TOKEN;
  if (!ownerToken || !/^[\x21-\x7e]{32,256}$/.test(ownerToken)) throw new ApplicationConfigError();
  return { ownerToken, ...readApplicationStorageConfig(env) };
}

export function readApplicationStorageConfig(
  env: Readonly<Record<string, string | undefined>>,
): Pick<ApplicationConfig, "allowedOrigins" | "databasePath"> {
  const entries = env.APPLICATION_ALLOWED_ORIGINS?.split(",").map((entry) => entry.trim());
  if (!entries?.length) throw new ApplicationConfigError();
  const allowedOrigins = entries.map((entry) => {
    const origin = normalizeHttpsOrigin(entry);
    if (!origin) throw new ApplicationConfigError();
    return origin;
  });

  const databasePath = env.APPLICATION_DATABASE_PATH ?? "var/applications.sqlite";
  if (!databasePath.trim() || databasePath !== databasePath.trim() || databasePath === ":memory:" || /[\u0000-\u001f]/.test(databasePath)) {
    throw new ApplicationConfigError();
  }

  return { allowedOrigins: [...new Set(allowedOrigins)], databasePath: resolve(databasePath) };
}
