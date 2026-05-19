# Settlement Model

- `settlementDeadline = endAt + 2 days`.
- Active period permits new downstream commitments.
- Settlement window permits only settlement of existing valid claims.
- After the deadline, normal settlement is rejected and unresolved claims become expired/disputed/manual exceptions.
- Settlement consumes Merchant receivable claim nullifiers only in the current demo model. Batch records contain rollup commitments and claim references, but no batch-level nullifier.
- Settlement never deletes authorization or contract history.
