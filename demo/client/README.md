# ENS-Aware Demo Client

Task 15 implements an independent client accepting the ENSv2 Sepolia service name
and resolution configuration. Resolve `[project-name].endpoint`, call
`/api/message`, invalidate cached resolution after failure, and verify the new
instance ID after recovery.

The client must not receive the replacement URL from the worker or hold its
signing key. No ENS-aware client is implemented yet.
