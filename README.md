# ZK Chain WebApp — Funded Contract + Settlement POC

This rewrite models a privacy-preserving Mastercard → PSP → Business → Agent → Merchant ecosystem.

It is **not** a simple payment transfer chain. It separates reusable Mastercard program authorization from fixed-term funded contracts, dynamic funded agent authorities, merchant receivables, settlement windows, and nullifier-based replay protection.

## Run

```bash
npm run simulate
npm run build

docker compose up --build
```

Open <http://localhost:8787>.

## Core rules

- Mastercard → PSP is a reusable program authorization.
- PSP → Business is a funded fixed-term contract.
- Business → Agent is a funded sub-authority under the Business contract.
- Agent → Merchant creates receivables, not reusable facilities.
- Child contracts cannot outlive parents.
- Every contract has a two calendar-day settlement buffer.
- During settlement buffer: existing claims can settle; new commitments are rejected.
- Settlement consumes nullifiers, not contract history.
- No Solidity contract stores actual monetary amounts.
- Quantum-safe ready means commitment-first and PQ-adapter ready, not fully quantum-safe on public EVM.

## Repository structure

```text
contracts/      Commitment/nullifier-only Solidity contracts
frontend/       React admin portal and flow visualizer
simulation/     Node.js scenarios and generated demo state
docs/           Architecture, decisions, diagrams, settlement/security docs
```

## Interactive demo behavior

The browser demo now behaves like a user-driven workflow:

- Demo users enter private authorized/funded/payment amounts.
- Private validation checks that Business funding stays within the PSP envelope, Agent authorities stay within the selected Business funding, and Merchant receivables stay within the selected Agent authority.
- The Admin portal intentionally never shows actual amounts; it shows commitments, statuses, names, purposes, parent links, and event records.
- The PSP can fund up to two named Business contracts in the demo.
- Businesses can create many named Agents with explicit purposes.
- Agents create named Merchant receivables.
- Nullifiers are generated and consumed only at the Merchant receivable claim level. Settlement batches do not get their own nullifier in this demo model.
