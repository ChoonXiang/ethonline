import { PROJECT_NAME } from "../../backend/config/project";
import { readWorkerConfig } from "../../backend/config/worker";

const { heartbeatIntervalMs } = readWorkerConfig();

function log(event: string) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      service: `${PROJECT_NAME}-recovery-worker`,
      event,
      recoveryEnabled: false,
    })}\n`,
  );
}

const heartbeat = setInterval(() => log("worker.idle"), heartbeatIntervalMs);

function shutdown() {
  clearInterval(heartbeat);
  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);
  log("worker.stopped");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
log("worker.started");
