// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Optional ZK/PQ commitment verifier boundary.
interface ICommitmentVerifier {
    function verifyCommitment(bytes32 commitment, bytes calldata proof, bytes32 contextHash) external view returns (bool);
}
