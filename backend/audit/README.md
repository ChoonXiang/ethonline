# Audit And Persistence

Task 16 implements durable events. Task 3 establishes the incident and operation
records needed for restart reconciliation. The API and worker must use the same
durable store; an in-memory array cannot provide restart recovery.

Preserve operation IDs, payment/deployment/ENS references, timestamps, spending
reservations, and cleanup outcomes. Exclude raw private policy inputs, credentials,
and payment signatures. Database selection and schema follow in those tasks.
`var/` is ignored for future local data/artifacts; it is not an implemented store.
