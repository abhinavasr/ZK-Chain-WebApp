// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMastercardProgramRegistry {
    function canCreateChild(bytes32 id, uint64 childStart, uint64 childEnd, uint64 childSettlementDeadline) external view returns (bool);
    function isFrozen(bytes32 id) external view returns (bool);
}

/// @notice PSP → Business funded fixed-term contracts. Non-revocable during committed period.
contract PSPBusinessFundedContract {
    enum ContractStatus { Pending, Active, Frozen, Expired, Closed, Disputed }

    struct BusinessContract {
        bytes32 id;
        bytes32 programId;
        address psp;
        address business;
        bytes32 fundedAmountCommitment;
        bytes32 availableCommitment;
        bytes32 termsHash;
        uint64 startAt;
        uint64 endAt;
        uint64 settlementDeadline;
        ContractStatus status;
        bool exists;
    }

    IMastercardProgramRegistry public immutable programs;
    mapping(bytes32 => BusinessContract) public contractsById;
    bytes32[] public contractIds;

    event BusinessContractCreated(bytes32 indexed id, bytes32 indexed programId, address indexed business, bytes32 fundedAmountCommitment, uint64 startAt, uint64 endAt, uint64 settlementDeadline);
    event BusinessContractFrozenByProgram(bytes32 indexed id);
    event BusinessContractClosed(bytes32 indexed id);
    event BusinessContractDisputed(bytes32 indexed id, bytes32 reasonHash);

    constructor(address programRegistry) { programs = IMastercardProgramRegistry(programRegistry); }

    function createBusinessContract(bytes32 programId, address business, bytes32 fundedAmountCommitment, bytes32 availableCommitment, bytes32 termsHash, uint64 startAt, uint64 endAt)
        external returns (bytes32 id)
    {
        require(business != address(0), "BUSINESS_REQUIRED");
        require(fundedAmountCommitment != bytes32(0) && availableCommitment != bytes32(0), "COMMITMENTS_REQUIRED");
        require(startAt < endAt, "BAD_PERIOD");
        uint64 settlementDeadline = endAt + 2 days;
        require(programs.canCreateChild(programId, startAt, endAt, settlementDeadline), "OUTSIDE_PROGRAM_OR_NOT_ACTIVE");
        id = keccak256(abi.encode("PSP_BUSINESS", programId, msg.sender, business, fundedAmountCommitment, termsHash, startAt, endAt));
        require(!contractsById[id].exists, "CONTRACT_EXISTS");
        contractsById[id] = BusinessContract(id, programId, msg.sender, business, fundedAmountCommitment, availableCommitment, termsHash, startAt, endAt, settlementDeadline, ContractStatus.Active, true);
        contractIds.push(id);
        emit BusinessContractCreated(id, programId, business, fundedAmountCommitment, startAt, endAt, settlementDeadline);
    }

    function inheritProgramFreeze(bytes32 id) external {
        BusinessContract storage c = contractsById[id];
        require(c.exists, "UNKNOWN_CONTRACT");
        require(programs.isFrozen(c.programId), "PROGRAM_NOT_FROZEN");
        c.status = ContractStatus.Frozen;
        emit BusinessContractFrozenByProgram(id);
    }

    function dispute(bytes32 id, bytes32 reasonHash) external {
        BusinessContract storage c = contractsById[id];
        require(c.exists, "UNKNOWN_CONTRACT");
        require(msg.sender == c.psp || msg.sender == c.business, "ONLY_PARTY");
        c.status = ContractStatus.Disputed;
        emit BusinessContractDisputed(id, reasonHash);
    }

    function closeAfterSettlementWindow(bytes32 id) external {
        BusinessContract storage c = contractsById[id];
        require(c.exists, "UNKNOWN_CONTRACT");
        require(block.timestamp > c.settlementDeadline, "SETTLEMENT_WINDOW_OPEN");
        require(c.status == ContractStatus.Active || c.status == ContractStatus.Expired, "BAD_STATUS");
        c.status = ContractStatus.Closed;
        emit BusinessContractClosed(id);
    }

    function canCreateAgent(bytes32 id, uint64 childStart, uint64 childEnd, uint64 childSettlementDeadline) external view returns (bool) {
        BusinessContract storage c = contractsById[id];
        return c.exists && c.status == ContractStatus.Active && block.timestamp <= c.endAt && childStart >= c.startAt && childEnd <= c.endAt && childSettlementDeadline <= c.settlementDeadline;
    }

    function businessContractCount() external view returns (uint256) { return contractIds.length; }
}
