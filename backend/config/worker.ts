export function readWorkerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const value = env.RECOVERY_WORKER_HEARTBEAT_MS;

  if (value === undefined) {
    return { heartbeatIntervalMs: 30_000 };
  }

  const heartbeatIntervalMs = Number(value);

  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 1_000 ||
    heartbeatIntervalMs > 60_000
  ) {
    throw new Error(
      "RECOVERY_WORKER_HEARTBEAT_MS must be an integer from 1000 to 60000.",
    );
  }

  return { heartbeatIntervalMs };
}
