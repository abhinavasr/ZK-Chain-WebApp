# Decisions

1. Mastercard → PSP is reusable because it represents program eligibility and an authorized envelope.
2. PSP → Business is fixed-term and funded because downstream participants need non-revocation guarantees.
3. Merchant records are receivables because merchants hold settlement claims, not reusable credit facilities.
4. Every active period receives two settlement days to separate commitment creation from settlement finality.
5. Settlement consumes Merchant-level claim nullifiers rather than erasing contracts, preserving auditability and replay protection while keeping nullifiers at the leaf receivable layer.
