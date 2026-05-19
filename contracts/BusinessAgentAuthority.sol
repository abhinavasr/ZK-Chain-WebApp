// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPSPBusinessFundedContract {
    function canCreateAgent(bytes32 id, uint64 childStart, uint64 childEnd, uint64 childSettlementDeadline) external view returns (bool);
}

/// @notice Business → Agent fixed-term funded sub-authority. Commitment-only state.
contract BusinessAgentAuthority {
    enum AuthorityStatus { Active, Frozen, Expired, Closed, Disputed }

    struct AgentAuthority {
        bytes32 id;
        bytes32 businessContractId;
        address business;
        address agent;
        bytes32 authorityAmountCommitment;
        bytes32 remainingCommitment;
        bytes32 termsHash;
        uint64 startAt;
        uint64 endAt;
        uint64 settlementDeadline;
        AuthorityStatus status;
        bool exists;
    }

    IPSPBusinessFundedContract public immutable businessContracts;
    mapping(bytes32 => AgentAuthority) public authorities;
    mapping(bytes32 => bytes32[]) public agentsByBusinessContract;
    bytes32[] public authorityIds;

    event AgentAuthorityCreated(bytes32 indexed id, bytes32 indexed businessContractId, address indexed agent, bytes32 amountCommitment, uint64 startAt, uint64 endAt, uint64 settlementDeadline);
    event AgentAuthorityDisputed(bytes32 indexed id, bytes32 reasonHash);
    event AgentAuthorityClosed(bytes32 indexed id);

    constructor(address businessContractRegistry) { businessContracts = IPSPBusinessFundedContract(businessContractRegistry); }

    function createAgentAuthority(bytes32 businessContractId, address agent, bytes32 authorityAmountCommitment, bytes32 remainingCommitment, bytes32 termsHash, uint64 startAt, uint64 endAt)
        external returns (bytes32 id)
    {
        require(agent != address(0), "AGENT_REQUIRED");
        require(authorityAmountCommitment != bytes32(0) && remainingCommitment != bytes32(0), "COMMITMENTS_REQUIRED");
        require(startAt < endAt, "BAD_PERIOD");
        uint64 settlementDeadline = endAt + 2 days;
        require(businessContracts.canCreateAgent(businessContractId, startAt, endAt, settlementDeadline), "OUTSIDE_BUSINESS_CONTRACT");
        id = keccak256(abi.encode("BUSINESS_AGENT", businessContractId, msg.sender, agent, authorityAmountCommitment, termsHash, startAt, endAt));
        require(!authorities[id].exists, "AUTHORITY_EXISTS");
        authorities[id] = AgentAuthority(id, businessContractId, msg.sender, agent, authorityAmountCommitment, remainingCommitment, termsHash, startAt, endAt, settlementDeadline, AuthorityStatus.Active, true);
        agentsByBusinessContract[businessContractId].push(id);
        authorityIds.push(id);
        emit AgentAuthorityCreated(id, businessContractId, agent, authorityAmountCommitment, startAt, endAt, settlementDeadline);
    }

    function dispute(bytes32 id, bytes32 reasonHash) external {
        AgentAuthority storage a = authorities[id];
        require(a.exists, "UNKNOWN_AUTHORITY");
        require(msg.sender == a.business || msg.sender == a.agent, "ONLY_PARTY");
        a.status = AuthorityStatus.Disputed;
        emit AgentAuthorityDisputed(id, reasonHash);
    }

    function closeAfterSettlementWindow(bytes32 id) external {
        AgentAuthority storage a = authorities[id];
        require(a.exists, "UNKNOWN_AUTHORITY");
        require(block.timestamp > a.settlementDeadline, "SETTLEMENT_WINDOW_OPEN");
        require(a.status == AuthorityStatus.Active || a.status == AuthorityStatus.Expired, "BAD_STATUS");
        a.status = AuthorityStatus.Closed;
        emit AgentAuthorityClosed(id);
    }

    function canCreateReceivable(bytes32 id, uint64 createdAt, uint64 settlementDeadline) external view returns (bool) {
        AgentAuthority storage a = authorities[id];
        return a.exists && a.status == AuthorityStatus.Active && createdAt >= a.startAt && createdAt <= a.endAt && settlementDeadline <= a.settlementDeadline;
    }

    function authorityCount() external view returns (uint256) { return authorityIds.length; }
}
