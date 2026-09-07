# Hedera Payment Adapter

Tasks 9 and 10 add x402/Blocky402 integration. This folder owns the paying client,
supported-network discovery, validated payment requirements, receipts, and
reconciliation. The resource server lives in `services/compute/`.

Only act on the exact approved incident and quote after an atomic budget
reservation. Reconcile an unknown settlement without creating a second payment.
Store HBAR amounts in integer tinybar strings. No SDK, account, signer, or
settlement implementation is configured yet.
