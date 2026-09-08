import { createHash } from "node:crypto";
import type { OperationKind } from "./types";

export function fingerprint(value: unknown): string {
  const json = JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en")));
    }
    return item;
  });
  return createHash("sha256").update(json).digest("hex");
}

export function operationId(incidentId: string, kind: OperationKind): string {
  return `${kind}_${fingerprint([incidentId, kind])}`;
}
