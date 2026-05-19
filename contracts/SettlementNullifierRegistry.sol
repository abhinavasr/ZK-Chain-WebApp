// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Replay-protection registry for Merchant receivable claim nullifiers only. Stores no amounts.
contract SettlementNullifierRegistry {
    struct SettlementBatch {
        bytes32 id;
        bytes32 rollupCommitment;
        bytes32 metadataHash;
        uint64 settledAt;
        address submitter;
    }

    mapping(bytes32 => bool) public usedMerchantClaimNullifiers;
    mapping(bytes32 => SettlementBatch) public batches;

    event MerchantClaimNullifierConsumed(bytes32 indexed nullifier, bytes32 indexed receivableId);
    event SettlementBatchRecorded(bytes32 indexed batchId, bytes32 rollupCommitment, bytes32 metadataHash);

    function consumeMerchantClaim(bytes32 nullifier, bytes32 receivableId) external {
        require(nullifier != bytes32(0), "NULLIFIER_REQUIRED");
        require(!usedMerchantClaimNullifiers[nullifier], "MERCHANT_CLAIM_ALREADY_USED");
        usedMerchantClaimNullifiers[nullifier] = true;
        emit MerchantClaimNullifierConsumed(nullifier, receivableId);
    }

    function recordBatch(bytes32 batchId, bytes32 rollupCommitment, bytes32 metadataHash) external {
        require(batchId != bytes32(0), "BATCH_ID_REQUIRED");
        require(batches[batchId].id == bytes32(0), "BATCH_EXISTS");
        batches[batchId] = SettlementBatch(batchId, rollupCommitment, metadataHash, uint64(block.timestamp), msg.sender);
        emit SettlementBatchRecorded(batchId, rollupCommitment, metadataHash);
    }
}
