# Provider Adapter

Task 8 defines quoting, deployment status, endpoint inspection, and termination.
Task 11 connects paid provisioning. Preserve incident/operation IDs across retries;
carry image digest, lease duration, cost, expiry, and provider identity in records.

The Hedera adapter handles payment authorization and settlement. This adapter
must not initiate an independent second payment. The first real provider is the
separately running [compute service](../../../services/compute/README.md).
No provider client is implemented yet.
