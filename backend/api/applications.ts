import { createHash, timingSafeEqual } from "node:crypto";
import { registerApplication } from "../applications/registration";
import { SqliteApplicationStore } from "../applications/sqlite-store";
import { ApplicationError } from "../applications/types";
import { ApplicationConfigError, readApplicationConfig, type ApplicationConfig } from "../config/applications";

const MAX_BODY_BYTES = 16_384;

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function withOwner(request: Request, operation: (config: ApplicationConfig) => Response | Promise<Response>) {
  try {
    const config = readApplicationConfig(process.env);
    const token = /^Bearer ([\x21-\x7e]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const hash = (value: string) => createHash("sha256").update(value).digest();
    if (!token || !timingSafeEqual(hash(token), hash(config.ownerToken))) throw new HttpError(401, "unauthorized");
    return await operation(config);
  } catch (error) {
    if (error instanceof ApplicationConfigError) return json({ error: { code: "registration_unavailable" } }, 503);
    if (error instanceof ApplicationError) {
      return json({ error: { code: error.code, ...(error.field ? { field: error.field } : {}) } },
        error.code === "service_name_conflict" ? 409 : 400);
    }
    if (error instanceof HttpError) {
      return json({ error: { code: error.code } }, error.status,
        error.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
    }
    return json({ error: { code: "internal_error" } }, 500);
  }
}

function withStore(config: ApplicationConfig, operation: (store: SqliteApplicationStore) => Response) {
  const store = new SqliteApplicationStore(config.databasePath);
  try {
    return operation(store);
  } finally {
    store.close();
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "unsupported_media_type");
  }
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid_json");

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "payload_too_large");
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json");
  } finally {
    reader.releaseLock();
  }
}

export function postApplication(request: Request) {
  return withOwner(request, async (config) => {
    const input = await readJson(request);
    return withStore(config, (store) => {
      const result = registerApplication(input, config.allowedOrigins, store);
      return json({ application: result.application }, result.created ? 201 : 200, {
        Location: `/api/applications/${result.application.applicationId}`,
      });
    });
  });
}

export function listApplications(request: Request) {
  return withOwner(request, (config) => withStore(config, (store) => json({ applications: store.list() })));
}

export function getApplication(request: Request, applicationId: string) {
  return withOwner(request, (config) => withStore(config, (store) => {
    const application = store.get(applicationId);
    if (!application) throw new HttpError(404, "application_not_found");
    return json({ application });
  }));
}
