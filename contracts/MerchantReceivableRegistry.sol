// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBusinessAgentAuthority {
    function canCreateReceivable(bytes32 id, uint64 createdAt, uint64 settlementDeadline) external view returns (bool);
}
interface ISettlementNullifierRegistry {
    function consumeMerchantClaim(bytes32 nullifier, bytes32 receivableId) external;
}

/// @notice Merchant leaf claims. Settlement consumes nullifiers, not history.
contract MerchantReceivableRegistry {
    enum ReceivableStatus { Created, Settled, Disputed, Expired }

    struct Receivable {
        bytes32 id;
        bytes32 agentAuthorityId;
        address agent;
        address merchant;
        bytes32 receivableCommitment;
        bytes32 claimNullifier;
        bytes32 metadataHash;
        uint64 createdAt;
        uint64 settlementDeadline;
        ReceivableStatus status;
        bool exists;
    }

    IBusinessAgentAuthority public immutable authorities;
    ISettlementNullifierRegistry public immutable nullifiers;
    mapping(bytes32 => Receivable) public receivables;
    mapping(bytes32 => bytes32[]) public receivablesByAgent;
    bytes32[] public receivableIds;

    event ReceivableCreated(bytes32 indexed id, bytes32 indexed agentAuthorityId, address indexed merchant, bytes32 receivableCommitment, bytes32 claimNullifier, uint64 settlementDeadline);
    event ReceivableSettled(bytes32 indexed id, bytes32 claimNullifier);
    event ReceivableDisputed(bytes32 indexed id, bytes32 reasonHash);
    event ReceivableExpired(bytes32 indexed id);

    constructor(address authorityRegistry, address nullifierRegistry) {
        authorities = IBusinessAgentAuthority(authorityRegistry);
        nullifiers = ISettlementNullifierRegistry(nullifierRegistry);
    }

    function createReceivable(bytes32 agentAuthorityId, address merchant, bytes32 receivableCommitment, bytes32 claimNullifier, bytes32 metadataHash)
        external returns (bytes32 id)
    {
        require(merchant != address(0), "MERCHANT_REQUIRED");
        require(receivableCommitment != bytes32(0) && claimNullifier != bytes32(0), "COMMITMENTS_REQUIRED");
        uint64 createdAt = uint64(block.timestamp);
        uint64 settlementDeadline = createdAt + 2 days;
        require(authorities.canCreateReceivable(agentAuthorityId, createdAt, settlementDeadline), "OUTSIDE_AGENT_AUTHORITY");
        id = keccak256(abi.encode("MERCHANT_RECEIVABLE", agentAuthorityId, msg.sender, merchant, receivableCommitment, claimNullifier, metadataHash));
        require(!receivables[id].exists, "RECEIVABLE_EXISTS");
        receivables[id] = Receivable(id, agentAuthorityId, msg.sender, merchant, receivableCommitment, claimNullifier, metadataHash, createdAt, settlementDeadline, ReceivableStatus.Created, true);
        receivablesByAgent[agentAuthorityId].push(id);
        receivableIds.push(id);
        emit ReceivableCreated(id, agentAuthorityId, merchant, receivableCommitment, claimNullifier, settlementDeadline);
    }

    function settle(bytes32 id) external {
        Receivable storage r = receivables[id];
        require(r.exists, "UNKNOWN_RECEIVABLE");
        require(r.status == ReceivableStatus.Created, "NOT_SETTLEABLE");
        require(block.timestamp <= r.settlementDeadline, "SETTLEMENT_DEADLINE_PASSED");
        nullifiers.consumeMerchantClaim(r.claimNullifier, id);
        r.status = ReceivableStatus.Settled;
        emit ReceivableSettled(id, r.claimNullifier);
    }

    function dispute(bytes32 id, bytes32 reasonHash) external {
        Receivable storage r = receivables[id];
        require(r.exists, "UNKNOWN_RECEIVABLE");
        require(msg.sender == r.agent || msg.sender == r.merchant, "ONLY_PARTY");
        r.status = ReceivableStatus.Disputed;
        emit ReceivableDisputed(id, reasonHash);
    }

    function markExpired(bytes32 id) external {
        Receivable storage r = receivables[id];
        require(r.exists, "UNKNOWN_RECEIVABLE");
        require(block.timestamp > r.settlementDeadline, "SETTLEMENT_WINDOW_OPEN");
        require(r.status == ReceivableStatus.Created, "BAD_STATUS");
        r.status = ReceivableStatus.Expired;
        emit ReceivableExpired(id);
    }

    function receivableCount() external view returns (uint256) { return receivableIds.length; }
}
