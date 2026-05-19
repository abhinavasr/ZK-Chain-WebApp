// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Mastercard → PSP reusable program authorization. Commitment-only state.
contract MastercardProgramRegistry {
    enum ProgramStatus { Pending, Active, Terminated, Frozen, Expired, Settled }

    struct ProgramAuthorization {
        bytes32 id;
        address mastercardAdmin;
        address psp;
        bytes32 authorizedEnvelopeCommitment;
        bytes32 policyHash;
        uint64 startAt;
        uint64 endAt;
        uint64 settlementDeadline;
        ProgramStatus status;
        bool exists;
    }

    mapping(bytes32 => ProgramAuthorization) public programs;
    bytes32[] public programIds;

    event ProgramCreated(bytes32 indexed id, address indexed psp, bytes32 envelopeCommitment, uint64 startAt, uint64 endAt, uint64 settlementDeadline);
    event ProgramTerminated(bytes32 indexed id, bytes32 reasonHash);
    event ProgramFrozen(bytes32 indexed id, bytes32 reasonHash);
    event ProgramUnfrozen(bytes32 indexed id);
    event ProgramExpired(bytes32 indexed id);

    modifier onlyAdmin(bytes32 id) {
        require(programs[id].mastercardAdmin == msg.sender, "ONLY_MASTERCARD_ADMIN");
        _;
    }

    function createProgram(address psp, bytes32 envelopeCommitment, bytes32 policyHash, uint64 startAt, uint64 endAt)
        external returns (bytes32 id)
    {
        require(psp != address(0), "PSP_REQUIRED");
        require(envelopeCommitment != bytes32(0), "COMMITMENT_REQUIRED");
        require(startAt < endAt, "BAD_PERIOD");
        uint64 settlementDeadline = endAt + 2 days;
        id = keccak256(abi.encode("MC_PROGRAM", msg.sender, psp, envelopeCommitment, policyHash, startAt, endAt));
        require(!programs[id].exists, "PROGRAM_EXISTS");
        programs[id] = ProgramAuthorization(id, msg.sender, psp, envelopeCommitment, policyHash, startAt, endAt, settlementDeadline, ProgramStatus.Active, true);
        programIds.push(id);
        emit ProgramCreated(id, psp, envelopeCommitment, startAt, endAt, settlementDeadline);
    }

    function terminate(bytes32 id, bytes32 reasonHash) external onlyAdmin(id) {
        require(programs[id].status == ProgramStatus.Active || programs[id].status == ProgramStatus.Frozen, "NOT_TERMINABLE");
        programs[id].status = ProgramStatus.Terminated;
        emit ProgramTerminated(id, reasonHash);
    }

    function freeze(bytes32 id, bytes32 reasonHash) external onlyAdmin(id) {
        require(programs[id].status == ProgramStatus.Active, "NOT_ACTIVE");
        programs[id].status = ProgramStatus.Frozen;
        emit ProgramFrozen(id, reasonHash);
    }

    function unfreeze(bytes32 id) external onlyAdmin(id) {
        require(programs[id].status == ProgramStatus.Frozen, "NOT_FROZEN");
        programs[id].status = ProgramStatus.Active;
        emit ProgramUnfrozen(id);
    }

    function markExpired(bytes32 id) external {
        ProgramAuthorization storage p = programs[id];
        require(p.exists, "UNKNOWN_PROGRAM");
        require(block.timestamp > p.settlementDeadline, "SETTLEMENT_WINDOW_OPEN");
        require(p.status == ProgramStatus.Active || p.status == ProgramStatus.Terminated, "BAD_STATUS");
        p.status = ProgramStatus.Expired;
        emit ProgramExpired(id);
    }

    function canCreateChild(bytes32 id, uint64 childStart, uint64 childEnd, uint64 childSettlementDeadline) external view returns (bool) {
        ProgramAuthorization storage p = programs[id];
        return p.exists && p.status == ProgramStatus.Active && childStart >= p.startAt && childEnd <= p.endAt && childSettlementDeadline <= p.settlementDeadline;
    }

    function isFrozen(bytes32 id) external view returns (bool) { return programs[id].status == ProgramStatus.Frozen; }
    function programCount() external view returns (uint256) { return programIds.length; }
}
