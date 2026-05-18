# ZK Chain WebApp — MPC Edition Architecture

> **Primary context document for AI systems working on this codebase.**
> Read this before touching any file.

---

## 1. What This Is

A standalone browser application demonstrating a **privacy-preserving payment delegation chain** using Zero-Knowledge proofs and a simulated **Multi-Party Computation (MPC) protocol**. No server, no build step, no framework. Open `index.html` in any browser.

### Core Problem

In traditional delegation (Mastercard → PSP → Business → Agent → Merchant), every party sees every other party's limits. ZK + MPC eliminates this:

- **Amounts never appear on-chain** — only cryptographic commitments
- **Neither party learns the other's value** — MPC engine proves conservation without revealing inputs
- **Conservation is enforced** — `parentRemaining = childAmount + parentRemainingAfter`

---

## 2. Files

```
index.html      — HTML shell, CDN fonts/icons, page structure
style.css       — Dark fintech theme, MPC panel styles, CSS custom properties
app.js          — All logic: crypto, MPC protocol, state, rendering, verifier
ARCHITECTURE.md — This document
```

---

## 3. Key Concepts

### 3.1 Two Commitments Per Entity (Critical Fix vs v1)

Every entity carries **two** commitments on-chain:

```
amountCommitment    = SHA256("poseidon:" + amount + ":" + blinding)
                      Fixed once set. Represents total allocation received.

remainingCommitment = SHA256("poseidon:" + remaining + ":" + remainingBlinding)
                      Decreases as children are allocated.
                      Updated on-chain after every child MPC session.
```

**Why two?** Without `remainingCommitment`, a PSP with cap=1000 could approve
Business A for 800 AND Business B for 800 — nothing prevents double-spending.
The conservation constraint enforces: `parentRemainingBefore = childAmount + parentRemainingAfter`.

### 3.2 Conservation Constraint

The ZK proof proves (inside the MPC engine):
```
H(parentRemainingBefore, b1) == parentRemainingCommitment   [on-chain, public]
H(childAmount, b2)           == childAmountCommitment        [new, published]
H(parentRemainingAfter, b3)  == newParentRemainingCommitment [updated, published]
parentRemainingBefore == childAmount + parentRemainingAfter  [arithmetic constraint]
parentRemainingBefore >= childAmount                         [non-negative]
```

Neither `parentRemainingBefore` nor `childAmount` appear in the proof or on-chain.

### 3.3 MPC Protocol (3 Rounds)

The MPC engine proves the conservation constraint **without either party revealing their value to the other**.

```
ROUND 1 — Blind input commitments
  Upstream  → MPC engine:  H(upstream.remaining, nonce_up)
  Downstream → MPC engine: H(downstream.amount, nonce_down)
  ✗ Neither party sees the other's hash
  ✗ Engine cannot extract values from hashes alone

ROUND 2 — Partial witnesses (encrypted shares)
  Upstream  → MPC engine:  H(upstream.remaining, sessionKey)
  Downstream → MPC engine: H(downstream.amount, sessionKey)
  ✗ Engine combines shares via MPC — values not individually reconstructed
  ✗ Neither party receives the other's partial witness

ROUND 3 — Joint proof
  Engine internally verifies: upstream.remaining >= downstream.amount
  Engine computes: parentRemainingAfter = parentRemaining - childAmount
  Engine generates: joint Groth16 proof
  If PASS → sends {amountCommitment, remainingCommitment, proof} to both + chain
  If FAIL → sends "rejected" to both — NOT the reason, NOT the values
```

### 3.4 What Each Party Learns

| Party | Learns | Never Learns |
|---|---|---|
| Upstream (MC) | Their own remaining is reduced | Downstream's amount |
| Downstream (PSP) | Their amountCommitment, remainingCommitment | Upstream's threshold |
| MPC Engine | Hashes and shares (cannot extract values) | Either party's actual value |
| Chain | Commitments + proof | Any actual amounts |

---

## 4. Entity State Model

```js
{
  id: UUID,
  name: string,

  // Private — never leaves entity's system
  amt: string,                  // amount entered by user
  blinding: hex,                // for amountCommitment
  remaining: number | null,     // starts = amt, decreases per child allocation
  remainingBlinding: hex,       // for remainingCommitment
  invoiceSecret: hex,           // for nullifier (leaf entities)

  // Public — published on-chain
  amountCommitment: hex | null,    // commit(amt, blinding) — fixed
  remainingCommitment: hex | null, // commit(remaining, remainingBlinding) — updated
  proof: ProofObject | null,
  nullifier: hex | null,           // leaf entities only

  status: 'idle' | 'mpc' | 'done' | 'err',
  err: string | null,

  // MPC session (null until protocol runs with parent)
  mpc: null | {
    round: 1 | 2 | 3 | 'done' | 'rejected',
    sessionKey: hex,
    upstream: {
      nonce: hex,
      blindCommit: hex | null,      // H(remaining, nonce_up)
      partialWitness: hex | null,   // H(remaining, sessionKey)
    },
    downstream: {
      nonce: hex,
      blindCommit: hex | null,      // H(amount, nonce_down)
      partialWitness: hex | null,   // H(amount, sessionKey)
    },
    jointProof: ProofObject | null,
    conservationOk: boolean | null,
    parentRemainingAfter: number | null,
    engineLog: string[],
  }
}
```

**Critical invariant:** `mpc.upstream` and `mpc.downstream` contain hashes only —
never raw amounts. Raw amounts exist only in the entity's own `amt` and `remaining` fields.

---

## 5. User Flow

### Root entity (Mastercard)
1. Enter amount → "Generate Commitment" → `generateRootCommitment()`
2. Computes `amountCommitment` + `remainingCommitment` (starts equal, no parent to prove against)
3. Status: done

### Child entity (PSP, Business, Agent, Merchant)
1. Parent must be committed first
2. "Run MPC" trigger appears between cards
3. User enters their amount
4. Clicks "Run MPC" → `runMPC(childId)`:
   - Round 1: both blind commits generated (700ms delay)
   - Round 2: partial witnesses generated (800ms delay)
   - Round 3: conservation checked, joint proof generated (900ms delay)
   - If OK: child gets commitments, parent's `remainingCommitment` updated
   - If fail: both get "rejected" — no values disclosed
5. Status: done or err

### Export
- "Export On-Chain Data" → JSON of `{amountCommitment, remainingCommitment, proof, nullifier}` per entity
- Zero amounts in export
- "Copy & Open Verifier" → transfers to verifier tab

---

## 6. Key Functions

| Function | Description |
|---|---|
| `sha256(str)` | Async SHA-256 via `crypto.subtle` |
| `randHex(n)` | Cryptographically random hex |
| `fakeProof()` | Groth16-shaped proof with random values |
| `makeEntity(idx)` | Creates entity state object |
| `setAmount(id, val)` | Updates amount without `renderAll()` (preserves focus) |
| `generateRootCommitment(id)` | Root entity self-auth — no MPC |
| `runMPC(childId)` | Full 3-round MPC protocol between child and parent |
| `buildMPCPanel(child, parent)` | Renders animated 3-column MPC panel |
| `buildConnector(child, parent)` | Renders connector + MPC trigger between cards |
| `buildCard(e)` | Renders full entity card |
| `renderAll()` | Rebuilds full entity list from state |
| `finalizeChain()` | Exports on-chain JSON |
| `runVerify()` | Groth16 verification checks |

---

## 7. What Is / Isn't Simulated

| Aspect | POC | Production |
|---|---|---|
| Hash | SHA-256 (simulating Poseidon) | Poseidon via circomlibjs |
| MPC engine | Client-side JS simulation | DIZK / collaborative snarkjs / MOTION |
| Partial witnesses | Hash(value, sessionKey) | Garbled circuits / secret shares |
| Joint proof | `fakeProof()` random bytes | Real Groth16 via snarkjs |
| Conservation check | JS arithmetic inside `runMPC()` | ZK circuit constraint in Circom |
| Chain state | In-memory + JSON export | EVM smart contract |
| Nullifier registry | JSON array | On-chain Solidity mapping |

**All data flows, privacy boundaries, and round structures are faithful to a real MPC-based ZK proving system.**

---

## 8. Privacy Invariants (Never Break)

1. **Upstream amount never written to downstream entity state.**
   Check: `entities[childIdx]` must never contain a field with `parent.amt` value.

2. **Amounts never appear in on-chain export.**
   `finalizeChain()` records must contain only `amountCommitment`, `remainingCommitment`, `proof`, `nullifier`, `mpcSessionKey`.

3. **`setAmount()` must never call `renderAll()`.**
   Doing so destroys and recreates the focused input element, stealing focus on every keystroke.

4. **`remainingCommitment` must update after every child MPC.**
   In `runMPC()`: after a successful round 3, `parent.remainingCommitment` must be recomputed with `parent.remaining = parentRemainingAfter`.

5. **MPC rejection must not reveal values.**
   The error message on rejection is always generic: "conservation constraint failed". It must never include either party's actual amount.
