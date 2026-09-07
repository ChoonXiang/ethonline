# [project-name] MVP Contract

Defined: 2026-09-07. Scope: backend task 1, defining the MVP. This document specifies
future behavior; it does not claim that the integrations are implemented or tested.
Numeric defaults are initial engineering choices and can be revised before implementation.

## 1. Product Outcome

A developer registers one stateless HTTP application and arms recovery. When its
primary instance fails, [project-name] automatically evaluates a recovery policy, pays
for temporary compute, launches the approved application image, verifies it, and
updates the service's ENSv2 endpoint. An independent ENS-aware client reconnects
using the same name. An incident record explains the decision and result.

The acceptance scenario requires no operator intervention between stopping the
primary instance and the client successfully calling the replacement.

## 2. Partner And Prize Scope

Use exactly these three partners, targeting one prize per partner. These targets
come from the supplied ETHOnline prize brief, assuming a new project built during
the event. They are qualification targets, not a guarantee of an award.

| Partner | Single Target | Required MVP Evidence |
| --- | --- | --- |
| Hedera | AI & Agentic Payments on Hedera | Publicly reachable x402 compute service; at least one real Hedera testnet payment settled through Blocky402; that payment buys the replacement lease. |
| Chainlink | Best Confidential Workflow | A registered confidential TEE handler processes private policy inputs and a provisioning-preflight credential; its actual result controls recovery. A successful CRE CLI simulation is sufficient under the supplied brief. |
| ENS | Best Use of ENSv2 | Real ENSv2 Sepolia name resolution, a Permissioned Resolver, a record-scoped endpoint update, and demonstrated revocation. |

Ordinary hosting and development tools are infrastructure dependencies; do not add
another prize-partner integration. Public repository, setup/architecture/payment
documentation, and a demo video no longer than five minutes are submission deliverables.

## 3. Demo Application And Compute

The application is `[project-name]-demo-api`, release `1.0.0`, packaged as one container
image pinned by its immutable SHA-256 digest. Both primary and replacement use
that digest. It has no database, persistent disk, session state, or application secrets.

| Endpoint | Successful Response Contract |
| --- | --- |
| `GET /healthz` | HTTP 200 JSON with `status: "ok"`, `service: "[project-name]-demo-api"`, `version: "1.0.0"`, and a nonempty per-instance `instanceId`. |
| `GET /api/message` | HTTP 200 JSON with `message: "[project-name] demo API is available"`, the same service/version, and the responding `instanceId`. |

The primary and replacement must have different instance IDs and URLs. The
provider's deployment receipt must also identify the actual image digest; an
application's self-reported version alone is insufficient verification.

Build one team-operated provider, `[project-name]-compute-demo`, exposing a public x402
service that sells a ten-minute container lease. It creates a fresh container on a
recovery host with preallocated capacity, assigns a reachable HTTPS endpoint, and
enforces lease expiry independently of the recovery worker. Primary failure must
not stop the broker, recovery host, worker, or incident store.

This demonstrates purchasing and launching real compute capacity. Creating a new
cloud account or virtual machine is outside the MVP. A custom broker provides
control over x402 settlement and lease enforcement; a cloud-native provisioning
adapter can follow later. A mock provider is useful for tests but cannot satisfy
the paid deployment demonstration.

The agent selects the sole configured provider if it meets the policy. Multiple
provider comparisons and LLM-based decisions are outside this first demonstration.

## 4. Registration Contract

Registration is an authenticated, single-owner operation. Recovery starts only
after registration validates and the owner explicitly arms it.

| Required Input | Meaning And Validation |
| --- | --- |
| `displayName` | Human-readable application label. |
| `serviceName` | An actual owned ENSv2 Sepolia name; examples such as `api.<owned-name>.eth` are illustrative, never assumed registered. |
| `primaryEndpoint` | Absolute HTTPS origin on the configured demo host allowlist, with no embedded credentials. |
| `imageDigest` and `expectedVersion` | An available immutable container image reference and the release the checks must observe. Mutable tags alone are rejected. |
| `policyRef` and `policyVersion` | References to an immutable private policy containing approved provider/image, budgets, lease duration, and recovery limits. |
| `credentialRef` | Workflow secret reference for the provider's deployment-preflight credential, not the credential itself. |

The backend assigns `applicationId` and tracks `currentEndpoint`, initially the
primary endpoint. The demo fixes the health and functional paths above. Network,
resolver, provider URL, allowed hosts, payment recipient, and signer references
are validated deployment configuration, not caller-controlled payment destinations.

Before arming, verify primary health, matching ENS endpoint, agent permissions,
available balances, provider support, and access to the configured CRE execution
mode. Never store raw private policy inputs or credentials in ordinary application
records or incident logs. Each incident binds to the configuration and policy
version captured when it opened. Disarming still prevents new side effects.

## 5. Detection And Recovery Limits

| Setting | Initial Demo Default |
| --- | --- |
| Health-check interval | 5 seconds, without overlapping probes per application. |
| Request timeout | 2 seconds; redirects are not followed. |
| Failure threshold | 3 consecutive failed checks of the current endpoint. |
| Successful check | HTTP 200, valid response shape, expected service and version. |
| Failure conditions | Connection/TLS/DNS error, timeout, other HTTP status, invalid JSON, or mismatched health response. |
| Replacement verification | 3 consecutive passing health checks, 5 seconds apart, plus a successful functional request and matching deployment digest. |
| Deployment readiness deadline | 60 seconds after confirmed settlement. |
| Recovery deadline | 180 seconds after the incident opens; no new purchase or endpoint submission after this deadline. |
| Demonstration timing target | Successful client reconnection within 120 seconds of the first failed probe; record actual elapsed time. |
| Paid provisioning limit | 1 logical purchase and 1 replacement instance per incident. |
| Read-only transport retries | At most 2 additional attempts, after 1 and 3 seconds, within the recovery deadline. This does not change scheduled health-check thresholds. |
| Automatic recovery limit | 1 incident per arming; another recovery requires the owner to rearm. |
| Compute lease | 600 seconds from container creation; no automatic renewal. |
| Minimum lease remaining at cutover | 120 seconds. |
| Endpoint cache in demo client | At most 5 seconds, invalidated immediately after a failed request. |

A passing health check resets the failure counter. Opening an incident is atomic:
concurrent checks cannot open duplicate recoveries. Recheck the primary immediately
before purchasing; if it has recovered, close the incident as unnecessary without
payment. After payment, continue verification of the purchased replacement.

Transport retries reuse the same operation identity. A retry never authorizes a
second payment or replacement. Persist progress so a restarted worker reconciles
an existing payment, deployment, or ENS transaction before taking further action.
Deadline expiry stops new recovery actions but does not stop reconciliation or cleanup.

## 6. Spending And Lease Contract

Use Hedera testnet HBAR with x402's exact-payment scheme and Blocky402. Native HBAR
uses asset ID `0.0.0`; discover the supported network and facilitator fee payer
from the configured facilitator, rather than copying example account IDs.
See the [Blocky402 network documentation](https://blocky402.com/docs/networks/).

| Limit | Initial Demo Default |
| --- | --- |
| Advertised compute price | 0.1 HBAR per minute; a fixed 10-minute lease costs 1 HBAR. This is our demo service price. |
| Maximum HBAR per incident | 2 HBAR, including any charges passed on to the recovery payer. |
| Maximum HBAR per application | 5 HBAR across a rolling 24-hour window, counting settled spend and outstanding reservations. |
| Quote validity | 60 seconds; an expired or changed quote requires a new policy decision before signing. |
| ENS transaction budget | 0.001 Sepolia ETH per incident and 0.005 Sepolia ETH per application per rolling 24 hours. |

Represent amounts as integer atomic-unit strings: 1 HBAR is `100000000` tinybars.
Track HBAR and Sepolia ETH separately; do not silently convert one budget into the
other. ENS setup transactions and the already rented recovery host are operator
setup costs outside incident budgets and must be disclosed as such.

Bind each quote and policy approval to `applicationId`, `incidentId`, policy
version, provider, image digest, lease duration, network, asset, payment recipient,
amount, quote ID, and expiry. Reserve the authorized amount atomically before
signing. Record actual settlement, release unused reservations only when safe,
and count failed-but-paid deployments against the budget. An ambiguous settlement
retains its reservation until reconciled.

The worker calls the provider's protected resource and answers its x402 payment
challenge. The provider verifies and settles through Blocky402, then fulfills the
lease once. A payment signature or successful verification alone is not confirmed
settlement. Duplicate requests return the same logical deployment and receipt.

The service charges for a fixed amount of compute time, prepaid in one request;
this does not claim streaming payments or measured per-second billing. A paid
deployment failure does not imply an automatic refund. The provider must terminate
the container at lease expiry, including if the worker is offline.

## 7. Confidential Policy Boundary

The required CRE workflow registers `handlerInTee`, retrieves the private policy
and provider-preflight credential through secret references, obtains the provider's
deployment-preflight response, and evaluates provider, image, quoted cost, lease,
and available spending allowance. This preflight reserves no paid compute.

Only the decision and the approved incident/quote binding leave the confidential
handler. Raw policy values, provider credentials, and private preflight responses
do not enter public logs or ENS. Actual prices, recipients, endpoints, and chain
transactions are observable; this is not a claim of private payments.

The worker may act only on a successful, current workflow result for that exact
incident and quote, followed by the atomic budget reservation. A denial, unavailable
workflow, or mismatched result prevents payment and endpoint changes. Cloud or host
administration credentials stay on the provider; the CRE credential is limited to
the provider's deployment-preflight service. The paying agent requires no vendor
API subscription or host administration credential.

The baseline is an automatically invoked CRE CLI simulation integrated into each
recovery, using synthetic policy values and a synthetic preflight credential for
the demo preflight endpoint. The simulator never receives host, payer, or ENS keys.
Capture its actual result and execution evidence, labeled `cre-simulation`.
Handwritten approval fixtures do not count as CRE execution.

Simulation is not hardware-protected execution; real confidentiality is not a
baseline MVP claim. Chainlink documents that live Confidential Workflows need
[private beta access](https://docs.chain.link/cre/account/confidential-workflows-access).
A live upgrade must verify the delivered CRE report and keep secrets inside the
enclave. The [official template](https://docs.chain.link/cre-templates/hello-confidential-workflows)
explains the handler and simulation boundary. Under the supplied prize brief,
successful confidential-workflow simulation is an allowed submission route.

## 8. ENS Identity And Successful Cutover

Store the current HTTPS origin in the application-defined text key
`[project-name].endpoint` on the service's ENSv2 Sepolia Permissioned Resolver.
Use this spelling consistently as the record contract.

Delegate permission for only that key on only that service name to the recovery
signer. The owner retains administration. The agent receives no role-management,
name-transfer, address-record, other-text-record, or resolver-upgrade permission.
Record-specific grants and revocation are supported by the
[Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/).
Spend and health rules remain worker-enforced; ENS permissions limit which record
the signer can edit, not which URL values it can write.

After replacement verification, re-read the current endpoint and permissions. If
the endpoint differs from the incident's expected previous value, stop for
reconciliation rather than overwriting an owner's change. Immediately before
submitting, require a fresh passing health check and sufficient lease time.

Await a successful Sepolia receipt with two block confirmations and read back
the same endpoint through ENSv2 resolution. If the transaction outcome is uncertain,
retain the candidate and reconcile before teardown or resubmission. There is no
atomic transaction spanning Hedera settlement, container deployment, and ENS.

The independent client receives only the service name and Sepolia resolution
configuration. It re-resolves after failure and successfully calls `/api/message`
using the resolved URL, with the new instance ID and expected version. It must
not receive the replacement URL from the orchestrator. Ordinary HTTP clients do
not automatically follow ENS text records.

Mark the incident `recovered` only when settlement, deployment, pre-cutover health,
confirmed ENS readback, and the client's functional request have all succeeded.
An endpoint transaction alone does not establish recovery.

## 9. Failure And Cleanup Outcomes

| Condition | Required Behavior |
| --- | --- |
| Transient primary failure | Reset the failure count on a passing check; no purchase. |
| Policy denial, invalid quote, insufficient funds, or emergency stop | No new payment or ENS write; record the reason. |
| Payment outcome unknown | Reconcile using the same payment/operation identity; never initiate a fresh payment to guess the outcome. |
| Paid instance fails verification | Leave ENS unchanged, request termination, retain payment evidence and any unresolved cleanup status. |
| Agent permission revoked or ENS update fails | Do not claim recovery; reconcile transaction state before cleaning up a possibly published target. |
| Recovery deadline exceeded | Stop new recovery actions; retain enough evidence to reconcile late results and clean up. |
| Cutover published but client cannot verify | Record incomplete recovery; retain the instance until reconciliation or lease expiry. Never roll back to a known-dead primary. |
| Owner changes endpoint during recovery | Preserve the observed owner change and stop automated cutover. The MVP does not claim onchain compare-and-swap protection against simultaneous writes. |
| Lease expires | Provider stops the container. Record lease expiry separately from historical recovery success; no automatic renewal or new incident without rearming. |

After the demonstration, restore the primary and verify it before an owner-driven
endpoint reset. Do not point ENS back to an unhealthy primary. Record cleanup
failures and outstanding instances even after recovery reaches a terminal result.

## 10. Evidence And Acceptance

Each incident stores ordered, timestamped events with application/incident and
operation IDs: failure checks, policy version and decision, CRE execution mode
and reference, quote, amount/network/asset/recipient, payment receipt, deployment
ID and digest, lease times, verification results, previous/new endpoint, ENS
transaction and readback, client result, and cleanup outcome. Redact credentials
and private inputs. A durable event log is sufficient; HCS anchoring is optional.

| ID | Acceptance Scenario | Pass Condition |
| --- | --- | --- |
| A1 | Register and arm | Actual owned name, healthy primary, pinned image, configured provider, limits, and permissions validate; registration returns an application ID. |
| A2 | One failed probe | Primary recovers before the threshold; no incident purchase or endpoint write occurs. |
| A3 | Stop the primary | The worker detects 3 failures and opens exactly one incident automatically. |
| A4 | Confidential policy enforcement | A real CRE simulation approves the affordable case and denies an over-budget or unapproved-image case; denial causes zero payment and zero ENS writes. |
| A5 | Purchase and deploy | A publicly reachable x402 service settles a real Blocky402 Hedera testnet payment and launches a fresh container using the approved digest. |
| A6 | Verify and reconnect | Replacement checks pass, the permitted ENS write confirms and resolves correctly, and the independent client returns the new instance ID through the unchanged service name. |
| A7 | Failed or duplicated recovery | Duplicate delivery or worker restart causes no extra charge/container; an unhealthy replacement is never published. |
| A8 | Delegation boundaries | Agent can update only the endpoint key; another key and another name reject it; after owner revocation, endpoint writes reject it too. |
| A9 | Account and terminate | Evidence accounts for all settled and reserved spend; lease expiry stops the container even with the worker offline. |

The happy-path demo must complete before the 180-second incident deadline. Report
both time from first failure and time from incident creation; the 120-second
target is a goal to measure, not an untested availability guarantee.

## 11. Real, Simulated, And Deferred

| Component | Required Baseline |
| --- | --- |
| Failure | Operator actually stops the primary container/process; the monitor observes the resulting outage. |
| Policy execution | Actual CRE CLI simulation invoked by the recovery worker, explicitly labeled; synthetic confidential inputs. |
| Payment | Actual Hedera testnet settlement through Blocky402, with a verifiable transaction reference. |
| Replacement | Fresh running container on the separate recovery host, with a real reachable HTTPS URL. |
| Service identity | Actual ENSv2 Sepolia records, delegated writes, resolution, and revocation. |
| Recovery client | Real functional request using the endpoint resolved from ENS. |
| Unit tests | Deterministic mocks allowed, clearly separated from submission evidence. |

Deferred: stateful recovery, database replication, arbitrary customer containers,
multiple providers, provider reputation, dynamic auctions, mainnet money, streaming
payments, automatic renewal/failback, LLM planning, multi-tenant billing, HCS audit
anchoring, and a dashboard. A CLI is sufficient for registration and demonstration.

Before implementing each integration, validate its access and versions: Blocky402's
live `/supported` response and a small paid request; installed CRE CLI/SDK simulation
support; ENSv2 Sepolia deployment addresses/ABI and record-level delegation. These
are subsequent implementation checks, not claims that task 1 has executed them.
