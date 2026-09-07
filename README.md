# [project-name]

An autonomous recovery agent for stateless APIs, built for ETHOnline with Hedera,
Chainlink CRE, and ENSv2.

The [MVP contract](docs/mvp-contract.md) defines the recovery behavior and prize
requirements. The [backend structure](docs/backend-structure.md) describes process
boundaries and where subsequent tasks belong.

Task 1 defines the MVP. Task 2 provides a control API health endpoint, an idle
recovery worker, a stateless demo API, local container configuration, and tests.
Recovery logic and partner integrations are not implemented yet.

## Run Locally

Use Node.js 22.18 or newer and pnpm 11.25.0 (pinned in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The control API is at `http://localhost:3000/api/health`. It reports API liveness
and `recoveryReady: false`; it does not claim partner connectivity.
The original starter page is still at `/`.

Run the independent processes in separate terminals:

```bash
pnpm worker
```

```bash
pnpm demo:api
```

The worker emits JSON startup/idle/shutdown events with `recoveryEnabled: false`.
The demo responds at `http://127.0.0.1:4001/healthz` and `/api/message`.
Stop it with Ctrl+C to create a local outage. `pnpm worker:dev` restarts the worker
when its source changes.

All three commands work with defaults. Optional worker/demo settings are listed
in [.env.example](.env.example) and read from an ignored `.env.local` file.
Partner credentials are not needed for the scaffold.

## Check The Scaffold

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`typecheck` generates Next.js route types before checking TypeScript. Tests use
local sockets and child processes, with no paid or external integration calls.
The starter page's Google fonts require network access during `build`.

See [local demo infrastructure](infra/demo/README.md) for Docker instructions.
The local HTTP demo and mutable development image tag are not the final HTTPS,
digest-pinned, paid hosting demonstration.
