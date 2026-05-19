// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Pluggable adapter for future post-quantum signatures.
/// @dev This POC is quantum-safe ready, not fully quantum-safe on public EVM because account signatures are still ECDSA.
interface IPostQuantumVerifier {
    function verifyInstruction(bytes32 instructionHash, bytes calldata signature, bytes calldata publicKey) external view returns (bool);
}
