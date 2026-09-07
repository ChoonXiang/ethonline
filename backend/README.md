# Backend

TypeScript modules shared by the Next.js API and the recovery worker. Keep
framework request handling in `app/api/` and process lifecycle in `workers/`.
Neither may start recovery work as an import side effect.

| Directory | Responsibility | Current State |
| --- | --- | --- |
| `api/` | Application services called by HTTP handlers. | Control API liveness response. |
| `config/` | Project identity and explicit environment parsing. | Worker heartbeat configuration. |
| `recovery/` | Recovery transitions and orchestration. | Reserved for task 3 onward. |
| `adapters/providers/` | Compute quotes, deployment status, and termination. | Boundary documented; no implementation. |
| `adapters/hedera/` | Budget-bound x402 client and settlement reconciliation. | Boundary documented; no implementation. |
| `adapters/cre/` | CRE invocation and incident/quote decision validation. | Boundary documented; no implementation. |
| `adapters/ens/` | Service endpoint resolution and delegated updates. | Boundary documented; no implementation. |
| `audit/` | Durable incident events and operation records. | Boundary documented; no implementation. |

Business modules must not import React, Next.js, executable worker entrypoints,
or demo service entrypoints. Keep partner SDKs inside their adapters or the
separate workflow. Client components must not import backend modules.

See the [backend structure](../docs/backend-structure.md) for process boundaries.
