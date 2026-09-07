# CRE Execution Adapter

Task 7 invokes the [confidential workflow](../../../workflows/cre/README.md) and
validates its result against the current incident, policy version, and quote.
Reject failed, stale, mismatched, or unavailable results.

The baseline runs the actual CRE CLI simulation with synthetic confidential inputs
and labels its evidence `cre-simulation`. A local approval fixture is not a CRE
execution. Construct the subprocess environment explicitly so it cannot inherit
worker, payment, or ENS credentials.

CRE has an independent toolchain. Do not import its SDK into Next.js or the worker.
No workflow invocation or successful confidential execution is claimed yet.
