# Recovery

Task 3 defines incident states, allowed transitions, operation identities, and
restart reconciliation against the [MVP contract](../../docs/mvp-contract.md).

Orchestration depends on explicit provider, payment, policy, identity, and audit
boundaries. It must not import Next.js or start timers at module scope. The worker
owns scheduling. No state machine or recovery execution exists yet.
