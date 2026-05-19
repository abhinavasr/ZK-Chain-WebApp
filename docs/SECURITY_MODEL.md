# Security Model

## On-chain data

Allowed: commitments, hashes, nullifiers, statuses, timestamps, role relationships, parent-child links, proof verification results.

Disallowed: actual amounts, raw credit limits, private funding balances, internal policy thresholds.

## Emergency freeze vs termination

Termination blocks new downstream business while allowing valid existing contracts to finish their settlement path.

Emergency freeze can pause existing activity and route settlement to manual/dispute review without deleting claims.
