import { normalizeHttpsOrigin } from "../applications/validation";
import { HEALTH_TIMEOUT_MS, type HealthCheck, type HealthFailureReason, type HealthTarget } from "./types";

interface ProbeOptions {
  allowedOrigins: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const MAX_BODY_BYTES = 16_384;

export async function probeHealth(target: HealthTarget, options: ProbeOptions): Promise<HealthCheck> {
  const checkedAt = Date.now();
  const failed = (reason: HealthFailureReason, httpStatus?: number): HealthCheck => ({
    checkedAt, healthy: false, instanceId: "", version: "", reason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
  if (options.signal?.aborted) return failed("cancelled");
  const origin = normalizeHttpsOrigin(target.currentEndpoint);
  if (!origin || !options.allowedOrigins.includes(origin)) return failed("endpoint_not_allowed");

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? HEALTH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (options.fetch ?? fetch)(new URL(target.healthPath, origin), {
      method: "GET", redirect: "manual", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json" }, signal,
    });
    reader = response.body?.getReader();
    if (response.status !== 200) return failed("http_status", response.status);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) return failed("response_too_large");
      chunks.push(value);
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      return failed("invalid_json");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return failed("invalid_response");
    const body = value as Record<string, unknown>;
    if (body.status !== "ok" || body.service !== target.expectedService || body.version !== target.expectedVersion ||
      typeof body.instanceId !== "string" || !body.instanceId.trim() || body.instanceId.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(body.instanceId)) return failed("invalid_response");
    return { checkedAt, healthy: true, instanceId: body.instanceId, version: target.expectedVersion, httpStatus: 200 };
  } catch {
    return failed(options.signal?.aborted ? "cancelled" : timeout.signal.aborted ? "timeout" : "network_error");
  } finally {
    clearTimeout(timer);
    // Dispose unread bodies (including redirects) without waiting on the remote peer.
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    timeout.abort();
  }
}
