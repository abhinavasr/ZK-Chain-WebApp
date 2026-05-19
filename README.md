# ZK Chain WebApp — Funded Contract + Settlement POC

A privacy-preserving Mastercard → PSP → Business → Agent → Merchant demo for funded-contract authorization, merchant receivables, and nullifier-protected settlement.

This is **not** a simple transfer chain. The current rewrite models different commercial/legal relationships at each layer:

- **Mastercard → PSP:** reusable program authorization / envelope.
- **PSP → Business:** named, funded, fixed-term Business contract.
- **Business → Agent:** named Agent authority with a declared purpose and private threshold.
- **Agent → Merchant:** named Merchant receivable / payment claim.
- **Settlement:** consumes Merchant-level claim nullifiers only; contract history remains auditable.

The UI is now an interactive demo plus admin portal. Demo users can enter private amounts and names; the admin portal sees commitments, statuses, purposes, parent links, events, and Merchant claim nullifiers — **not actual amounts**.

---

## Current live behavior

### Demo user tab

A demo user can:

1. Create a Mastercard → PSP program authorization with a private authorized envelope.
2. Create up to **two named PSP-funded Business contracts**.
3. Create one or many named Agents under a selected Business.
4. Set an explicit **purpose** for each Agent.
5. Create named Merchant receivables/payments under a selected Agent.
6. Submit settlement for pending Merchant claims.
7. Attempt double settlement and see it rejected by Merchant claim nullifier replay protection.
8. Apply ordinary termination or emergency freeze at the Mastercard program level.

### Private validation

Private values are used locally for validation but are not shown in the admin/on-chain-style views.

Validation rules implemented in the demo:

- Business funding must fit inside the PSP authorized envelope.
- Total Agent authority under a Business must fit inside that Business funded amount.
- Total Merchant receivables under an Agent must fit inside that Agent authority.
- Program freeze/termination blocks new downstream activity where appropriate.
- Merchant claim settlement cannot be replayed after its nullifier is consumed.

### Admin portal tab

The admin portal shows behind-the-scenes state:

- Commitment-only contract records.
- Mastercard/PSP/Business/Agent/Merchant parent-child links.
- Agent purposes.
- Merchant receivables.
- Merchant-level claim nullifiers.
- Settlement batches and replay rejection events.
- Event log with generated metadata.

The admin portal intentionally shows **“private amount hidden — commitment only”** instead of raw amounts.

---

## Core rules

- Mastercard → PSP is reusable program authorization, not per-transaction funding.
- PSP → Business is a funded fixed-term contract.
- Business → Agent is a funded sub-authority under a selected Business contract.
- Agent → Merchant creates a receivable/payment claim, not a reusable facility.
- PSP can fund two named Businesses in this POC.
- Agents have names and explicit purposes.
- Merchants have names and receive receivables.
- Child contracts cannot outlive parent contracts.
- Every contract has a two calendar-day settlement buffer.
- During the settlement buffer: existing claims can settle; new commitments are rejected.
- Settlement consumes Merchant claim nullifiers only.
- Settlement does not erase or invalidate original authorizations/contracts/history.
- No Solidity contract stores actual monetary amounts.
- Quantum-safe ready means commitment-first and PQ-adapter ready, not fully quantum-safe on public EVM.

---

## Repository structure

```text
contracts/
  MastercardProgramRegistry.sol       Reusable Mastercard → PSP authorization
  PSPBusinessFundedContract.sol       PSP → named Business funded fixed-term contracts
  BusinessAgentAuthority.sol          Business → named Agent authority with purpose
  MerchantReceivableRegistry.sol      Agent → named Merchant receivables
  SettlementNullifierRegistry.sol     Merchant claim nullifier replay protection
  interfaces/
    IPostQuantumVerifier.sol          Future PQ signature adapter boundary
    ICommitmentVerifier.sol           Future commitment/proof adapter boundary

frontend/
  src/App.jsx                         Interactive demo + admin portal
  src/styles.css                      UI styling
  package.json                        Vite/React build

simulation/
  simulate-flow.js                    Node simulation of happy path + replay rejection
  scenarios/                          Scenario data placeholders

docs/
  ARCHITECTURE.md                     Current architecture and Mermaid diagrams
  DECISIONS.md                        Why the model is structured this way
  SECURITY_MODEL.md                   Privacy/security posture
  SETTLEMENT_MODEL.md                 Settlement/nullifier rules
  QUANTUM_SAFE_MODEL.md               Quantum-safe-ready stance
  ER_DIAGRAM.md / FLOW_DIAGRAMS.md    Mermaid diagrams

Dockerfile                            Production build served by nginx
docker-compose.yml                    Local app + optional simulation/chain profiles
```

---

## Run locally

```bash
npm run simulate
npm run build

docker compose up --build
```

Open:

```text
http://localhost:8787
```

---

## Test/verification commands

```bash
npm run simulate
npm run build
docker build -t zk-chain-webapp-independent:latest .
```

The simulation demonstrates:

- Mastercard creates PSP authorization.
- PSP funds Business contract.
- Business creates multiple Agents.
- Agents create multiple Merchant receivables.
- Settlement consumes Merchant claim nullifiers.
- Double settlement is rejected.

---

## Security and privacy notes

### No raw amounts in public/admin state

The demo accepts private amount inputs so validation can be demonstrated, but public/admin records show only commitments and status metadata.

### Merchant-level nullifiers only

Nullifiers are generated and consumed only at the Merchant receivable claim level. Settlement batches contain rollup commitments and claim references, but no batch-level nullifier in the current model.

### Quantum-safe ready, not fully quantum-safe

The app uses a commitment/nullifier-first architecture and provides post-quantum verifier interfaces. However, standard public EVM account signatures are still elliptic-curve based, so the system cannot honestly claim full end-to-end quantum safety on today’s public EVM.
