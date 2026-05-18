pragma circom 2.0.0;

include "./lib/poseidon.circom";

/*
  AllocationDownstream — runs in the DOWNSTREAM party's system (e.g. PSP)

  Proves WITHOUT revealing any values:
    1. I know the opening of my amountCommitment
    2. I know the opening of commitmentDelta  (received from MC via secure channel)
    3. My amount == delta                    (I'm claiming exactly what MC allocated)

  The PSP NEVER learns MC's total or remaining.
  The PSP learns delta (the amount allocated to them) via the secure channel —
  this is a bilateral disclosure between MC and PSP, NOT visible on-chain.

  Public inputs  (go on-chain — just hashes):
    commitmentAmount — PSP's commitment to their amount
    commitmentDelta  — must match the upstream circuit's commitmentDelta
                       chain verifies both proofs reference the same C_delta

  Private inputs (stay in PSP's system):
    amount          — PSP's allocation amount (received from MC's delta)
    amountBlinding  — PSP's own random blinding
    delta           — same as amount (received from MC via secure channel)
    deltaBlinding   — received from MC via secure channel
*/

template AllocationDownstream() {

    // ── Private inputs ─────────────────────────────────────────
    signal input amount;
    signal input amountBlinding;
    signal input delta;           // received from upstream via secure channel
    signal input deltaBlinding;   // received from upstream via secure channel

    // ── Public inputs ──────────────────────────────────────────
    signal input commitmentAmount;
    signal input commitmentDelta;

    // ── Constraint 1: commitmentAmount is valid ────────────────
    component hashAmount = Poseidon(2);
    hashAmount.inputs[0] <== amount;
    hashAmount.inputs[1] <== amountBlinding;
    hashAmount.out === commitmentAmount;

    // ── Constraint 2: commitmentDelta is valid ─────────────────
    // This links to the upstream proof — same C_delta in both proofs
    // Chain verifies C_delta matches, proving they reference the same delta
    component hashDelta = Poseidon(2);
    hashDelta.inputs[0] <== delta;
    hashDelta.inputs[1] <== deltaBlinding;
    hashDelta.out === commitmentDelta;

    // ── Constraint 3: amount == delta ──────────────────────────
    // PSP is claiming exactly what MC allocated — no more, no less
    amount === delta;
}

component main {
    public [commitmentAmount, commitmentDelta]
} = AllocationDownstream();
