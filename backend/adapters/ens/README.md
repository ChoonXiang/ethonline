# ENSv2 Adapter

Tasks 13 and 14 add Sepolia resolution, delegated endpoint writes, transaction
confirmation/readback, and revocation verification.

Use `[project-name].endpoint` from the MVP contract. The agent may edit only that
key on the configured name. Reconcile uncertain transactions before repeating a
write or terminating an instance that might already be published. The independent
demonstration client lives in `demo/client/`.

Deployment addresses, ABI, signer, and an owned name are not configured yet.
