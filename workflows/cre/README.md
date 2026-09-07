# Confidential CRE Workflow

Task 7 adds the confidential handler and its independent CRE project/toolchain.
Pin compatible CLI/SDK versions then. The main Next.js TypeScript check excludes
this directory; workflow compilation and simulation will have their own commands.

The handler evaluates private policy and deployment-preflight responses using
secret references. Only the approved incident/quote binding may leave it. The
backend invokes it through `backend/adapters/cre/`.

Baseline evidence comes from an actual CRE CLI simulation with synthetic inputs.
Live TEE execution requires separate access. There is no runnable workflow yet.
