# Backend Tests

Run `pnpm test`, or select `pnpm test:unit` / `pnpm test:integration`.
Tests use Node's built-in runner with tsx to execute TypeScript.

`unit/` checks configuration. `integration/` exercises the actual demo HTTP
listener and worker/demo process lifecycle, including shutdown and outage behavior.
They use loopback addresses and ephemeral ports, without partner credentials,
testnet transactions, or a Docker daemon.

These tests verify task 2, not a recovery, paid deployment, CRE workflow, or ENS
update. Live partner tests must have separate explicit commands and configuration
in task 19 so the default test command cannot spend funds.
