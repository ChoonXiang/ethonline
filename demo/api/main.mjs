// @ts-check
import { createDemoServer } from "./server.mjs";

const portValue = process.env.DEMO_PORT ?? "4001";
const port = Number(portValue);
const host = process.env.DEMO_HOST ?? "127.0.0.1";

if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("DEMO_PORT must be an integer from 0 to 65535.");
}

const server = createDemoServer();

server.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  if (!address || typeof address === "string") return;

  process.stdout.write(
    `${JSON.stringify({ event: "demo.started", host, port: address.port })}\n`,
  );
});

function shutdown() {
  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);

  const deadline = setTimeout(() => server.closeAllConnections(), 5_000);
  deadline.unref();

  server.close(() => {
    clearTimeout(deadline);
    process.stdout.write(`${JSON.stringify({ event: "demo.stopped" })}\n`);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
