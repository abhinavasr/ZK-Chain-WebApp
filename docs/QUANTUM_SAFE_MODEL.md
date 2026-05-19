# Quantum-safe Model

This project is **quantum-safe ready**, not fully quantum-safe on standard public EVM.

Why: Ethereum account signatures currently rely on elliptic-curve cryptography. The app can avoid revealing amounts and can use hash/nullifier commitments, but it cannot make the base account layer post-quantum by itself.

Prepared posture:

- SHA3/Keccak-style commitment primitives.
- No raw amounts on-chain.
- Pluggable `IPostQuantumVerifier` for Dilithium/Falcon/SPHINCS+ style off-chain instructions.
- Clear adapter boundary for future PQ signature verification.
