# Compute Resource Server

Task 9 adds the independently deployed x402 service. It owns provider-side
verification and Blocky402 settlement, deployment fulfillment, idempotent receipts,
and lease expiry enforcement even when the worker is offline.

The paying client is in `backend/adapters/hedera/`; the compute adapter is in
`backend/adapters/providers/`. Host credentials stay on this service. The separate
deployment-preflight request must not itself purchase compute.

No resource server, deployment engine, payment gating, or lease enforcement exists
yet. The local demo container is only the application to recover.
