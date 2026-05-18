pragma circom 2.0.0;

include "./lib/poseidon.circom";
include "./lib/comparators.circom";

/*
  AllocationUpstream — runs in the UPSTREAM party's system (e.g. Mastercard)

  Proves WITHOUT revealing any values:
    1. I know the opening of my current remainingCommitment (before)
    2. I know the opening of my new remainingCommitment (after)
    3. I know delta and its commitment
    4. remaining_before - remaining_after == delta  (conservation)
    5. remaining_after >= 0                         (no overdraft)
    6. delta > 0                                    (positive allocation)

  Public inputs  (go on-chain — just hashes, no amounts):
    commitmentBefore  — current remainingCommitment on-chain
    commitmentAfter   — new remainingCommitment to publish
    commitmentDelta   — commitment to the transferred amount
                        PSP will prove their amount opens this same commitment

  Private inputs (never leave Mastercard's system):
    remainingBefore, remainingBeforeBlinding
    remainingAfter,  remainingAfterBlinding
    delta,           deltaBlinding
*/

template AllocationUpstream() {

    // ── Private inputs ─────────────────────────────────────────
    signal input remainingBefore;
    signal input remainingBeforeBlinding;
    signal input remainingAfter;
    signal input remainingAfterBlinding;
    signal input delta;
    signal input deltaBlinding;

    // ── Public inputs ──────────────────────────────────────────
    signal input commitmentBefore;
    signal input commitmentAfter;
    signal input commitmentDelta;

    // ── Constraint 1: commitmentBefore is valid ────────────────
    component hashBefore = Poseidon(2);
    hashBefore.inputs[0] <== remainingBefore;
    hashBefore.inputs[1] <== remainingBeforeBlinding;
    hashBefore.out === commitmentBefore;

    // ── Constraint 2: commitmentAfter is valid ─────────────────
    component hashAfter = Poseidon(2);
    hashAfter.inputs[0] <== remainingAfter;
    hashAfter.inputs[1] <== remainingAfterBlinding;
    hashAfter.out === commitmentAfter;

    // ── Constraint 3: commitmentDelta is valid ─────────────────
    component hashDelta = Poseidon(2);
    hashDelta.inputs[0] <== delta;
    hashDelta.inputs[1] <== deltaBlinding;
    hashDelta.out === commitmentDelta;

    // ── Constraint 4: conservation ─────────────────────────────
    remainingBefore - remainingAfter === delta;

    // ── Constraint 5: no overdraft (remainingAfter >= 0) ───────
    // LessThan(n) checks in[0] < in[1] over n-bit numbers
    // We check: remainingAfter < remainingBefore + 1
    // i.e. remainingAfter <= remainingBefore
    component noOverdraft = LessThan(64);
    noOverdraft.in[0] <== remainingAfter;
    noOverdraft.in[1] <== remainingBefore + 1;
    noOverdraft.out === 1;

    // ── Constraint 6: delta > 0 ────────────────────────────────
    component positiveDelta = GreaterThan(64);
    positiveDelta.in[0] <== delta;
    positiveDelta.in[1] <== 0;
    positiveDelta.out === 1;
}

component main {
    public [commitmentBefore, commitmentAfter, commitmentDelta]
} = AllocationUpstream();
