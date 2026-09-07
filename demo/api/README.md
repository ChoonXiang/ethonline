# Stateless Demo API

Run `pnpm demo:api` from the repository root. It defaults to
`http://127.0.0.1:4001`. Override `DEMO_HOST` / `DEMO_PORT` in `.env.local`;
port `0` selects an available port for process tests.

`GET /healthz` and `GET /api/message` implement the task 1 response contract.
Each instance generates a stable UUID; restarting creates a new ID. The server
has no storage or third-party runtime dependencies. `.mjs` keeps the same files
runnable directly in Node and the demo container.

Stop with Ctrl+C to create a local outage. No public route kills the process.
Both SIGINT and SIGTERM close the listener.

The [Docker configuration](../../infra/demo/README.md) packages this server.
Local HTTP is a development fixture. The prize demonstration still needs HTTPS,
a digest-pinned image, and a paid deployment on the recovery host.
