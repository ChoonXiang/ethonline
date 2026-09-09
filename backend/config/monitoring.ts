import { readApplicationStorageConfig } from "./applications";

export function readMonitoringConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.APPLICATION_ALLOWED_ORIGINS === undefined || env.APPLICATION_ALLOWED_ORIGINS === "") return undefined;
  return readApplicationStorageConfig(env);
}
