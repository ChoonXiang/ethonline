# Backend Structure

Task 2 keeps one package and lockfile. Next.js serves the control API; a separate
Node.js worker owns future scheduling and recovery. The demo API can fail
independently. CRE will get its own runtime and dependency configuration in task 7.

```text
app/api/health/route.ts       Next.js control API liveness endpoint
backend/
  api/                       API application services
  config/                    Identity and validated configuration
  recovery/                  Recovery state machine and orchestration (task 3)
  adapters/
    providers/               Compute provider client (task 8)
    hedera/                  x402 paying client (task 10)
    cre/                     Workflow invocation and result checks (task 7)
    ens/                     ENSv2 endpoint resolution and updates (tasks 13-14)
  audit/                     Durable incident/operation storage (task 16)
workers/recovery/main.ts     Independent worker entrypoint
services/compute/            x402 server and lease enforcement (task 9)
workflows/cre/               Independent confidential workflow (task 7)
demo/
  api/                       Stateless application fixture
  client/                    ENS-aware client (task 15)
infra/demo/                  Dockerfile and primary-only Compose setup
tests/
  unit/                      Module tests
  integration/               Local HTTP and process tests
  helpers/                   Test lifecycle utilities
```

## Boundaries

`app/api/` calls `backend/api/` for individual requests. It never starts a monitor
on import. `workers/recovery/` owns process lifecycle and will call
`backend/recovery/`. Both use the same durable store once implemented. Next.js
in-memory state is not a communication channel between these processes.

Each adapter owns its partner SDK and transport details. The compute server owns
fulfillment and lease expiry independently of the primary and worker. The demo
client resolves ENS independently of the orchestrator.

The main TypeScript check excludes `workflows/cre/` because CRE has an independent
compiler/runtime. Introduce a separate check/simulation command with that workflow.
Other TypeScript files share the strict compiler setup. The standalone demo
JavaScript files enable `@ts-check` and are included in the compiler inputs.

Backend modules stay out of client components and read configuration at executable
entrypoints. Load future secrets only in the process needing them, without a
`NEXT_PUBLIC_` prefix.

## Commands

| Command | What It Runs |
| --- | --- |
| `pnpm dev` | Next.js API and existing starter UI on port 3000. |
| `pnpm worker` | Worker bootstrap, validated heartbeat, and signal handling. |
| `pnpm worker:dev` | The worker with Node's source watcher. |
| `pnpm demo:api` | Demo server on loopback port 4001 by default. |
| `pnpm typecheck` | Next.js route type generation and TypeScript checks. |
| `pnpm test` | Unit and local integration tests. |

The worker reports recovery disabled until later tasks connect the state machine,
registration, monitoring, and adapters. No adapter returns fabricated success.
The name remains `[project-name]`; technical package/image identifiers use the
existing `ethonline` slug where brackets are invalid.

tsx runs TypeScript processes/tests through its documented
[Node loader](https://tsx.is/dev-api/). It is a development dependency; production
worker packaging must either compile JavaScript or include tsx explicitly.
Task 2 does not define production worker deployment.

Next: implement the recovery state machine against the [MVP contract](mvp-contract.md).
