# Service-Oriented Architecture Plan v2: MCP Business CLI + AP2 Mandates + x402 Merchant Payments + ZK Settlement

**Audience:** Coding agent / implementation team  
**Goal:** Replace the current monolithic ZK-Chain-WebApp proof-of-concept with a realistic service-oriented demo showing Mastercard-funded PSP envelopes, PSP-to-business allocations, MCP-driven business execution, AP2-style mandate evidence, x402 merchant capability payments, hidden-value smart contracts, merchant claims, nullifier settlement, and role-specific admin portals.

---

## 1. What Changed From v1

The target experience is now more specific:

1. Mastercard allocates a fixed funding envelope to a PSP.
2. PSP can allocate that Mastercard envelope to many businesses, up to the fixed envelope limit.
3. PSP can optionally supplement business funding from its own blockchain wallets.
4. PSP can also extend Mastercard-provided line-of-credit capacity to businesses, while tracking committed exposure separately from PSP-owned wallet liquidity.
5. A consumer/business user interacts with the **Business CLI** through MCP from a local tool such as Claude CLI.
6. The Business CLI launches browser-based authentication using OTP `1234`, then asks the user to create a passkey.
7. The user requests a service such as: “Run a campaign for Mastercard to showcase the partnership for an upcoming football game in New Jersey.”
8. The Business CLI calls merchant capability services. Merchants respond with x402 challenges:
   - CNN News: `$0.10` per news capability call.
   - Midjourney Image Generation: `$0.50` per image generation call.
   - Google Adverts: `$0.02` per ad/campaign capability call.
9. The Business CLI presents an estimated total cost and suggests a 15–20% buffer.
10. The user confirms the budget, then signs/approves the specific spending envelope using the previously created passkey.
11. Agents execute the task: News Agent → Image Agent → Ads Agent.
12. If an agent receives additional x402 challenges because usage exceeds the estimate, it may continue paying only while inside the user-approved total threshold.
13. The consumer sees final total cost.
14. Merchants see accumulated payable amounts in their portals and can initiate a claim.
15. Claiming calls nullifiers, generates a settlement statement, and updates PSP monitoring dashboards.
16. PSP continuously monitors smart contract status and funding exposure.

---

## 2. Core Design Principles

### 2.1 Service-oriented, not monolithic

This must be built as independent services, each with its own API, data store ownership, Dockerfile, and `.md` plan. A single repository is acceptable for the demo, but runtime boundaries must mirror the real world.

### 2.2 Smart contracts do not expose actual amounts

Behind the scenes, contracts are created or updated by different parties based on committed amounts. Public contract state stores commitments, hashes, nullifier roots, mandate references, payer/payee identifiers, and lifecycle status. Raw dollar values stay in private ledgers owned by the responsible party.

### 2.3 AP2-style user authority

Use mandate records to prove what the user/business authorized:

- **Intent Mandate:** user’s task and constraints, e.g. “run a campaign for Mastercard for the upcoming football game in New Jersey.”
- **Checkout/Budget Mandate:** specific budget cap, included buffer, merchant categories, and allowed agents.
- **Payment Mandate:** evidence used by the payment orchestrator and merchant agents to authorize x402 payments under the approved threshold.

### 2.4 x402 per capability call

Each merchant API is protected by an x402-style flow:

1. Agent calls merchant capability endpoint without payment.
2. Merchant returns HTTP `402 Payment Required` with amount, currency, recipient, capability, nonce, expiry, and settlement terms.
3. Business/Payment Agent validates the challenge against user mandate and remaining budget.
4. Business/Payment Agent submits a signed payment assertion.
5. Merchant validates the assertion and returns the result.
6. Merchant records receivable for future claim.

### 2.5 Budget threshold with buffer

The user approves a max activity budget. Recommended default buffer is `20%` unless changed in config. Example:

```text
Estimated base cost = 0.10 + 0.50 + 0.02 = 0.62
Suggested 20% buffer = 0.124
Approved max budget = 0.744, rounded to 0.75
```

For demo simplicity, display values in dollars in private UI flows, but commit only hashes/commitments on-chain.

---

## 3. End-to-End User Journey

### Phase A — Funding Setup

1. Mastercard Admin Portal creates a PSP program envelope.
2. Mastercard Funding Service creates a private funding record and an on-chain commitment.
3. PSP Admin Portal sees a fixed Mastercard envelope, e.g. `$1,000,000`.
4. PSP can allocate from this envelope across many businesses as long as total Mastercard-backed allocation does not exceed the envelope.
5. PSP can add liquidity from its own blockchain wallets.
6. PSP can create business funding from either:
   - Mastercard-backed line of credit.
   - PSP-owned wallet funds.
   - Mixed source.

### Phase B — Business User Authentication

1. Consumer/business user invokes a local MCP skill through Claude CLI.
2. Claude CLI calls the Business CLI MCP server.
3. Business CLI detects no active authenticated session.
4. Business CLI launches a browser page served by the Business Auth Service.
5. User enters OTP `1234`.
6. User creates a passkey.
7. Business Auth Service stores a WebAuthn credential public key and issues a session token to the Business CLI.

### Phase C — Estimate and Budget Approval

1. User asks: “Run a campaign for Mastercard to showcase the partnership for the upcoming football game in New Jersey.”
2. Business CLI creates an Intent Mandate draft.
3. Planner Agent determines required merchant capabilities:
   - CNN News for latest context.
   - Midjourney Image Gen for campaign creative.
   - Google Adverts for ad launch.
4. Business CLI performs dry-run/preflight calls or capability-price discovery.
5. Merchants return x402 pricing/challenges:
   - CNN News `$0.10`.
   - Midjourney `$0.50`.
   - Google Adverts `$0.02`.
6. Business CLI presents estimate and suggested buffer.
7. User confirms budget.
8. Business CLI launches browser confirmation page.
9. User signs with passkey.
10. Budget Mandate and Payment Mandate are created.
11. Commitment Ledger Service creates hidden-value commitments for the activity budget and agent authority.

### Phase D — Agent Execution

1. Campaign Orchestrator launches News Agent.
2. News Agent calls CNN Merchant Service.
3. CNN returns x402 challenge.
4. Payment Orchestration Service verifies the challenge is allowed by mandate and budget.
5. Payment Orchestration Service creates signed payment assertion.
6. CNN verifies assertion and returns news content.
7. Campaign Orchestrator launches Image Agent with news context.
8. Image Agent calls Midjourney Merchant Service.
9. Midjourney may return one or more x402 challenges if generation requires extra attempts/tokens.
10. Payment Orchestration Service approves only if remaining budget is sufficient.
11. Campaign Orchestrator launches Google Adverts Agent with copy/creative payload.
12. Google Adverts returns x402 challenge and, after assertion, creates a simulated ad campaign.
13. Campaign Orchestrator returns final campaign summary and total cost to the Business CLI.

### Phase E — Merchant Claims and Settlement

1. Each merchant portal shows accumulated receivables/payables.
2. Merchant selects “Initiate Claim.”
3. Merchant Claim Service aggregates unpaid accepted x402 assertions.
4. Claim Service generates settlement statement.
5. Commitment Ledger Service derives/consumes nullifiers for each receivable.
6. Nullifier prevents replay/double-claim.
7. PSP Settlement Monitor detects claim lifecycle updates.
8. PSP Admin Portal shows settlement status and remaining envelope exposure.

---

## 4. Service Inventory

| Service | Owner Boundary | Purpose | Own Database? | Public UI? |
|---|---|---:|---:|---:|
| Mastercard Admin Portal | Mastercard | Program envelope admin | No, calls API | Yes |
| Mastercard Funding Service | Mastercard | Creates PSP envelope commitments | Yes | No |
| PSP Admin Portal | PSP | Funding, allocations, monitoring | No, calls API | Yes |
| PSP Funding Service | PSP | Business funding allocations and wallet top-ups | Yes | No |
| PSP Wallet Service | PSP | PSP-owned blockchain wallet liquidity | Yes | No |
| Business/Agency Admin Portal | Business/Agency | Activities, users, agent runs, costs | No, calls API | Yes |
| Business CLI / MCP Server | Business/Agency | Local tool invoked by Claude CLI | Local config | CLI/MCP |
| Business Auth Service | Business/Agency | OTP + passkey authentication | Yes | Browser auth pages |
| Campaign Orchestrator Service | Business/Agency | Launches agents and manages workflow | Yes | No |
| Agent Runtime Service | Business/Agency | Runs News/Image/Ads agents | Yes | No |
| Payment Orchestration Service | Business/Agency/PSP bridge | x402 challenge handling and assertions | Yes | No |
| Mandate Evidence Service | Shared/Business | AP2-style mandate creation and verification | Yes | No |
| Commitment Ledger Service | Shared infra | Commitments, nullifiers, settlement proofs | Yes | No |
| CNN Merchant Portal | Merchant | Receivables, claims, capability logs | No, calls API | Yes |
| CNN News Merchant Service | Merchant | x402-protected news API | Yes | No |
| Midjourney Merchant Portal | Merchant | Receivables, claims, capability logs | No, calls API | Yes |
| Midjourney Image Merchant Service | Merchant | x402-protected image API | Yes | No |
| Google Adverts Merchant Portal | Merchant | Receivables, claims, campaign launch logs | No, calls API | Yes |
| Google Adverts Merchant Service | Merchant | x402-protected ads API | Yes | No |
| Merchant Claim Service | Merchant/shared adapter | Claim aggregation and settlement statement generation | Yes | No |
| Event Bus | Infra | Cross-service events | N/A | No |
| Observability Service | Infra | Logs/traces/activity feed | Yes | Optional |

---

## 5. Target Repository Layout

```text
zk-chain-webapp-services/
  README.md
  docker-compose.yml
  .env.example

  docs/
    00-master-service-architecture-plan.md
    services/
      01-mastercard-admin-and-funding.md
      02-psp-admin-funding-wallet-monitor.md
      03-business-agency-admin.md
      04-business-cli-mcp-auth.md
      05-campaign-orchestrator-and-agents.md
      06-payment-orchestration-x402.md
      07-mandate-evidence-ap2.md
      08-commitment-ledger-contracts-nullifiers.md
      09-merchant-cnn-news.md
      10-merchant-midjourney-image.md
      11-merchant-google-adverts.md
      12-merchant-claims-settlement.md
      13-eventing-observability.md
      14-shared-contracts-sdk.md

  apps/
    mastercard-admin-portal/
    psp-admin-portal/
    agency-admin-portal/
    cnn-merchant-portal/
    midjourney-merchant-portal/
    google-adverts-merchant-portal/

  services/
    mastercard-funding-service/
    psp-funding-service/
    psp-wallet-service/
    business-auth-service/
    business-cli-mcp-server/
    campaign-orchestrator-service/
    agent-runtime-service/
    payment-orchestration-service/
    mandate-evidence-service/
    commitment-ledger-service/
    cnn-news-merchant-service/
    midjourney-image-merchant-service/
    google-adverts-merchant-service/
    merchant-claim-service/
    observability-service/

  packages/
    api-contracts/
    event-contracts/
    x402-client/
    x402-server/
    ap2-mandates/
    zk-commitments/
    ui-theme-tokens/

  contracts/
    ProgramEnvelopeCommitment.sol
    BusinessAllocationCommitment.sol
    AgentBudgetCommitment.sol
    MerchantReceivableCommitment.sol
    NullifierRegistry.sol
    SettlementStatementRegistry.sol

  infra/
    docker/
    local-chain/
    kafka-or-redpanda/
    postgres/
```

---

## 6. Smart Contract Model

### 6.1 Contracts

1. **ProgramEnvelopeCommitment**
   - Created when Mastercard allocates a fixed envelope to PSP.
   - Stores `programId`, `pspId`, `commitmentHash`, `metadataHash`, `status`.
   - Does not store raw amount.

2. **BusinessAllocationCommitment**
   - Created by PSP when funding a business.
   - Stores `allocationId`, `programId`, `businessId`, `fundingSourceType`, `commitmentHash`, `metadataHash`, `status`.
   - `fundingSourceType`: `MASTERCARD_ENVELOPE`, `PSP_WALLET`, `MIXED`.

3. **AgentBudgetCommitment**
   - Created when the business user approves an activity budget.
   - Stores `activityId`, `businessId`, `agentGroupId`, `budgetCommitmentHash`, `mandateHash`, `expiry`, `status`.

4. **MerchantReceivableCommitment**
   - Created when merchant accepts an x402 assertion and delivers capability result.
   - Stores `receivableId`, `merchantId`, `activityId`, `capabilityId`, `paymentAssertionHash`, `receivableCommitmentHash`, `status`.

5. **NullifierRegistry**
   - Stores spent nullifiers for merchant receivables.
   - Rejects duplicate claim attempts.

6. **SettlementStatementRegistry**
   - Stores settlement statement hash, merchant, PSP, period, claim batch hash, and status.

### 6.2 Private Ledger Records

Each party keeps private values off-chain:

```json
{
  "privateAmount": "0.50",
  "currency": "USD",
  "salt": "random-32-byte-salt",
  "commitmentHash": "hash(privateAmount, currency, salt, partyIds, purpose, expiry)"
}
```

The demo should implement commitment hashing in TypeScript first. Full ZK proof generation can be optional or stubbed behind the `zk-commitments` package.

---

## 7. x402 Challenge and Assertion Contracts

### 7.1 Merchant x402 Challenge

```json
{
  "type": "x402.challenge",
  "challengeId": "ch_...",
  "merchantId": "cnn-news",
  "capabilityId": "latest-news-search",
  "amount": "0.10",
  "currency": "USD",
  "recipient": "merchant-wallet-or-settlement-alias",
  "network": "demo-chain",
  "nonce": "random-nonce",
  "expiresAt": "2026-05-24T12:10:00Z",
  "description": "CNN latest news capability call",
  "settlementMode": "claim_later_with_nullifier"
}
```

### 7.2 Payment Assertion

```json
{
  "type": "x402.payment_assertion",
  "assertionId": "pa_...",
  "challengeId": "ch_...",
  "activityId": "act_...",
  "mandateHash": "hash_of_payment_mandate",
  "budgetCommitmentId": "abc_...",
  "payerBusinessId": "agency-001",
  "merchantId": "cnn-news",
  "capabilityId": "latest-news-search",
  "amountCommitmentHash": "hash(amount,currency,salt)",
  "nonce": "same-or-bound-nonce",
  "signature": "business_or_payment_agent_signature",
  "issuedAt": "2026-05-24T12:00:00Z"
}
```

### 7.3 Validation Rules

Payment Orchestration Service must reject a challenge if:

- Challenge is expired.
- Merchant is not in the approved mandate.
- Capability is not in the approved mandate.
- Amount would exceed the remaining approved user budget.
- Nonce was already used.
- Challenge fields do not match the signed assertion.
- Merchant tries to claim the same receivable twice.

---

## 8. Event Model

Use Redpanda/Kafka or NATS locally. Every admin portal should consume events through its own backend or an event-query service. Do not directly couple portals to each other.

### Required Topics

```text
funding.mastercard.envelope.created
funding.psp.wallet.added
funding.psp.business.allocated
business.auth.otp.verified
business.auth.passkey.registered
mandate.intent.created
mandate.budget.presented
mandate.budget.signed
activity.created
activity.estimate.created
x402.challenge.received
x402.payment.asserted
x402.payment.rejected
merchant.capability.delivered
merchant.receivable.created
merchant.claim.initiated
nullifier.consumed
settlement.statement.generated
settlement.statement.accepted
contract.status.changed
```

### Sample Activity Event

```json
{
  "eventId": "evt_...",
  "type": "x402.challenge.received",
  "timestamp": "2026-05-24T12:00:00Z",
  "actor": "news-agent",
  "activityId": "act_campaign_001",
  "merchantId": "cnn-news",
  "capabilityId": "latest-news-search",
  "challengeId": "ch_cnn_001",
  "amount": "0.10",
  "currency": "USD"
}
```

---

## 9. UI/Portal Requirements

### 9.1 Mastercard Admin Portal

Theme: Mastercard-inspired. Use red/yellow gradients carefully; do not use protected logos unless explicitly allowed.

Screens:

- PSP Envelopes.
- Create Envelope.
- Envelope Utilization.
- PSP Exposure.
- Contract Commitments.
- Event Timeline.

### 9.2 PSP Admin Portal

Theme: Adyen-inspired. Clean white/green/black design.

Screens:

- Mastercard Envelope Overview.
- Business Allocations.
- Add PSP Wallet Funds.
- Extend Business Credit.
- Allocation Source Breakdown.
- Smart Contract Monitor.
- Merchant Claims Monitor.
- Settlement Statements.

### 9.3 Marketing Agency Admin Portal

Theme: Accenture-inspired. Purple/black/white enterprise style.

Screens:

- Business Users.
- Passkey Registrations.
- Campaign Requests.
- Estimate vs Actual Cost.
- Agent Runs.
- Merchant Calls.
- Mandate Evidence.
- Final Consumer Cost.

### 9.4 Merchant Portals

Each merchant portal must be independent:

- CNN News Merchant Portal.
- Midjourney Image Merchant Portal.
- Google Adverts Merchant Portal.

Screens:

- x402 Challenges Issued.
- Payment Assertions Received.
- Capability Calls Delivered.
- Receivables / Total Payable.
- Initiate Claim.
- Claim Batches.
- Nullifier Status.
- Settlement Statements.

---

## 10. Business CLI / MCP Requirements

The Business CLI must act as the user-facing entry point from a local AI tool.

### Commands

```bash
business-cli auth login
business-cli campaign run "Run a campaign for Mastercard to showcase the partnership for upcoming Football game in New Jersey"
business-cli campaign status <activityId>
business-cli campaign costs <activityId>
```

### MCP Tools

Expose tools such as:

```json
[
  {
    "name": "business.authenticate",
    "description": "Launch browser OTP/passkey authentication for the business user"
  },
  {
    "name": "campaign.estimate",
    "description": "Estimate merchant capability costs and present budget with buffer"
  },
  {
    "name": "campaign.confirmBudget",
    "description": "Launch passkey approval page and create budget mandate"
  },
  {
    "name": "campaign.execute",
    "description": "Run campaign agents within approved payment mandate"
  },
  {
    "name": "campaign.getCostSummary",
    "description": "Return final actual cost to the consumer"
  }
]
```

---

## 11. Default Demo Scenario

### Inputs

```text
Mastercard envelope to PSP: $1,000,000
Business allocation: $10,000 from Mastercard-backed envelope
Optional PSP wallet top-up: $5,000
User request: Run campaign for Mastercard partnership for upcoming football game in New Jersey
CNN price: $0.10
Midjourney price: $0.50
Google Adverts price: $0.02
Suggested buffer: 20%
Approved user max: $0.75
```

### Expected Outcome

1. User authenticates with OTP `1234` and passkey.
2. User sees estimated cost `$0.62` and suggested budget `$0.75`.
3. User confirms via passkey.
4. Agents execute paid merchant calls.
5. If Midjourney needs one extra paid step, total may become `$1.12`, which must be rejected if approved max is `$0.75`.
6. If all calls fit, final cost is shown to consumer.
7. Merchant portals show payable receivables.
8. Merchants initiate claim.
9. Nullifiers are consumed.
10. PSP monitor shows settlement status.

---

## 12. Acceptance Criteria

### Functional

- Mastercard can create PSP funding envelope.
- PSP cannot over-allocate Mastercard envelope.
- PSP can add its own wallet funding separately.
- Business user can authenticate with OTP `1234` and create passkey.
- Business CLI works as MCP server/local tool.
- User can request campaign execution through CLI.
- System generates estimate and buffer.
- User approves budget using passkey.
- Agents handle x402 challenges from all three merchants.
- Extra x402 challenges are allowed only within approved budget threshold.
- Final consumer cost is visible.
- Merchant payable amount is visible.
- Merchant can initiate claim.
- Nullifiers prevent duplicate claim.
- PSP continuously sees contract and settlement status.

### Architectural

- No monolithic backend.
- Each service has its own Dockerfile.
- Each service has its own `.md` plan.
- Each service owns its data.
- All cross-service state changes are emitted as events.
- No raw committed amounts appear in smart contract state.
- Shared libraries live only in `packages/`.

### Demo

- `docker compose up` starts all services.
- Seed script creates default Mastercard, PSP, agency, merchants, prices, wallets, and funding envelope.
- One scripted CLI command can run the full demo.

---

## 13. Open Questions for Product Owner

These are not blockers for initial implementation, but should be confirmed before polishing the demo:

1. Should the “Business” be named **Marketing Agency / Accenture Agency** everywhere, or should Business and Agency remain separate concepts?
2. Should Google Adverts simulate actual campaign launch only, or also simulate ad budget spend separate from the `$0.02` API fee?
3. Should merchant claims settle immediately in demo, or require PSP approval before settlement statement acceptance?
4. Should PSP-owned wallet funding and Mastercard-backed line of credit have different priority rules when paying merchants?
5. Should the consumer be a human business employee, a Mastercard representative, or a generic brand user in the UI copy?

---

## 14. Build Order for Coding Agent

1. Create monorepo skeleton and Docker Compose.
2. Build shared contracts: API types, event types, x402 types, mandate types, commitment helpers.
3. Build event bus and observability/event query.
4. Build Commitment Ledger Service and local smart contracts.
5. Build Mastercard Funding Service and Portal.
6. Build PSP Funding/Wallet/Monitor Services and Portal.
7. Build Business Auth Service with OTP/passkey flow.
8. Build Business CLI/MCP Server.
9. Build Mandate Evidence Service.
10. Build Payment Orchestration Service.
11. Build merchant services and portals.
12. Build Campaign Orchestrator and Agent Runtime.
13. Build claim and settlement flow.
14. Add seeded end-to-end demo script.
15. Add integration tests for budget threshold, double claim, and PSP over-allocation rejection.
