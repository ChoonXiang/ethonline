# Local Demo Infrastructure

From the repository root with Docker and Compose installed:

```bash
docker compose -f infra/demo/compose.yaml up --build -d primary
curl http://127.0.0.1:4001/healthz
docker compose -f infra/demo/compose.yaml stop primary
docker compose -f infra/demo/compose.yaml down
```

Run `pnpm demo:api` instead when Docker is unavailable. Only one should bind port
4001 at a time. The image runs as the unprivileged `node` user and contains only
the dependency-free demo API. Compose exposes it on host loopback and disables
automatic restart so the stopped primary remains unavailable.

Only the primary fixture starts here. The worker and control API run independently.
A paid replacement will be created by `services/compute/` in a later task.

`ethonline-demo-api:local` is a development tag; brackets in `[project-name]`
cannot be used in Docker image names. Before the live demo, publish the image,
record its immutable digest, and configure separate primary/recovery hosts with
HTTPS. This Compose file does not perform those steps.
