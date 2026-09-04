// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Shared registration, agreement creation, acceptance, storage and read API.
abstract contract ProofRouteRegistry is ReentrancyGuard {
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_NAME_LENGTH = 32;
    uint256 public constant MAX_CARGO_LENGTH = 120;
    uint256 public constant MAX_LOCATION_LENGTH = 80;
    uint256 public constant MAX_EVIDENCE_CID_LENGTH = 128;

    enum Role { None, Shipper, Carrier, Verifier }
    enum AgreementStatus { Created, Accepted, Funded, PartiallyCompleted, Completed, Refunded, Cancelled }
    enum MilestoneType { Pickup, Delivery }

    struct User {
        string displayName;
        Role role;
        uint64 registeredAt;
    }

    struct Agreement {
        uint256 id;
        address shipper;
        address carrier;
        address verifier;
        string cargo;
        string origin;
        string destination;
        uint256 requiredEscrow;
        uint256 releasedAmount;
        uint64 deadline;
        uint64 createdAt;
        uint64 acceptedAt;
        uint64 fundedAt;
        uint16 pickupBps;
        AgreementStatus status;
    }

    struct Milestone {
        bytes32 proofHash;
        uint16 payoutBps;
        bool completed;
        uint64 completedAt;
        string evidenceCid;
        uint64 submittedAt;
    }

    struct CarrierStats {
        uint256 verifiedMilestones;
        uint256 completedAgreements;
        uint256 expiredFundedAgreements;
    }

    error AlreadyRegistered(address account);
    error NotRegistered(address account);
    error InvalidRole();
    error InvalidDisplayName();
    error InvalidTextLength(bytes32 field, uint256 suppliedLength, uint256 maximumLength);
    error InvalidCarrier(address carrier);
    error InvalidVerifier(address verifier);
    error SelfAssignment();
    error InvalidEscrowAmount();
    error InvalidDeadline(uint256 suppliedDeadline, uint256 currentTimestamp);
    error InvalidPickupBps(uint256 suppliedBps);
    error InvalidProofHash();
    error DuplicateProofHash();
    error AgreementNotFound(uint256 agreementId);
    error Unauthorized(address account);
    error InvalidAgreementStatus(AgreementStatus currentStatus);
    error DeadlinePassed(uint256 deadline, uint256 currentTimestamp);
    error DeadlineNotPassed(uint256 deadline, uint256 currentTimestamp);
    error IncorrectEscrowAmount(uint256 expected, uint256 received);
    error InvalidMilestoneOrder(MilestoneType milestone, AgreementStatus currentStatus);
    error InvalidMilestoneProof(uint256 agreementId, MilestoneType milestone);
    error MilestoneAlreadyCompleted(uint256 agreementId, MilestoneType milestone);
    error InvalidEvidenceCid(uint256 suppliedLength, uint256 maximumLength);
    error EvidenceNotSubmitted(uint256 agreementId, MilestoneType milestone);
    error EtherTransferFailed();
    error DirectPaymentNotAllowed();

    event UserRegistered(address indexed account, string displayName, Role indexed role, uint64 registeredAt);
    event AgreementCreated(uint256 indexed agreementId, address indexed shipper, address indexed carrier, uint256 requiredEscrow, uint64 deadline, uint16 pickupBps);
    event AgreementVerifierAssigned(uint256 indexed agreementId, address indexed verifier);
    event AgreementAccepted(uint256 indexed agreementId, address indexed carrier, uint64 acceptedAt);
    event AgreementFunded(uint256 indexed agreementId, address indexed shipper, uint256 amount, uint64 fundedAt);
    event AgreementCancelled(uint256 indexed agreementId, address indexed shipper);
    event AgreementRefunded(uint256 indexed agreementId, address indexed shipper, uint256 amount);
    event MilestoneEvidenceSubmitted(uint256 indexed agreementId, MilestoneType indexed milestone, address indexed carrier, string evidenceCid, uint64 submittedAt);
    event MilestoneVerified(uint256 indexed agreementId, MilestoneType indexed milestone, address indexed verifier, address carrier, uint64 verifiedAt);
    event EscrowReleased(uint256 indexed agreementId, MilestoneType indexed milestone, address indexed carrier, uint256 amount);
    event AgreementCompleted(uint256 indexed agreementId, uint64 completedAt);

    uint256 public agreementCount;
    mapping(address account => User user) internal _users;
    mapping(uint256 agreementId => Agreement agreement) internal _agreements;
    mapping(uint256 agreementId => mapping(MilestoneType milestoneType => Milestone milestone)) internal _milestones;
    mapping(address account => uint256[] agreementIds) internal _userAgreementIds;
    mapping(address carrier => CarrierStats stats) internal _carrierStats;

    modifier agreementExists(uint256 agreementId) {
        if (agreementId == 0 || agreementId > agreementCount) revert AgreementNotFound(agreementId);
        _;
    }

    function registerUser(string calldata displayName, Role role) external {
        if (_users[msg.sender].role != Role.None) revert AlreadyRegistered(msg.sender);
        if (role != Role.Shipper && role != Role.Carrier && role != Role.Verifier) revert InvalidRole();
        uint256 nameLength = bytes(displayName).length;
        if (nameLength < 3 || nameLength > MAX_NAME_LENGTH) revert InvalidDisplayName();

        uint64 registeredAt = uint64(block.timestamp);
        _users[msg.sender] = User(displayName, role, registeredAt);
        emit UserRegistered(msg.sender, displayName, role, registeredAt);
    }

    function createAgreement(
        address carrier,
        address verifier,
        string calldata cargo,
        string calldata origin,
        string calldata destination,
        uint256 requiredEscrow,
        uint64 deadline,
        uint16 pickupBps,
        bytes32 pickupProofHash,
        bytes32 deliveryProofHash
    ) external returns (uint256 agreementId) {
        _requireRole(msg.sender, Role.Shipper);
        if (carrier == msg.sender) revert SelfAssignment();
        if (_users[carrier].role != Role.Carrier) revert InvalidCarrier(carrier);
        if (verifier == msg.sender || verifier == carrier || _users[verifier].role != Role.Verifier) revert InvalidVerifier(verifier);
        if (requiredEscrow == 0) revert InvalidEscrowAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline(deadline, block.timestamp);
        if (pickupBps == 0 || pickupBps >= BPS_DENOMINATOR) revert InvalidPickupBps(pickupBps);
        if (pickupProofHash == bytes32(0) || deliveryProofHash == bytes32(0)) revert InvalidProofHash();
        if (pickupProofHash == deliveryProofHash) revert DuplicateProofHash();
        _validateText("cargo", cargo, MAX_CARGO_LENGTH);
        _validateText("origin", origin, MAX_LOCATION_LENGTH);
        _validateText("destination", destination, MAX_LOCATION_LENGTH);

        agreementId = ++agreementCount;
        uint64 createdAt = uint64(block.timestamp);
        _agreements[agreementId] = Agreement(agreementId, msg.sender, carrier, verifier, cargo, origin, destination, requiredEscrow, 0, deadline, createdAt, 0, 0, pickupBps, AgreementStatus.Created);
        _milestones[agreementId][MilestoneType.Pickup] = Milestone(pickupProofHash, pickupBps, false, 0, "", 0);
        _milestones[agreementId][MilestoneType.Delivery] = Milestone(deliveryProofHash, BPS_DENOMINATOR - pickupBps, false, 0, "", 0);
        _userAgreementIds[msg.sender].push(agreementId);
        _userAgreementIds[carrier].push(agreementId);
        _userAgreementIds[verifier].push(agreementId);
        emit AgreementCreated(agreementId, msg.sender, carrier, requiredEscrow, deadline, pickupBps);
        emit AgreementVerifierAssigned(agreementId, verifier);
    }

    function acceptAgreement(uint256 agreementId) external agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (msg.sender != agreement.carrier) revert Unauthorized(msg.sender);
        _requireRole(msg.sender, Role.Carrier);
        if (agreement.status != AgreementStatus.Created) revert InvalidAgreementStatus(agreement.status);
        if (block.timestamp > agreement.deadline) revert DeadlinePassed(agreement.deadline, block.timestamp);
        agreement.acceptedAt = uint64(block.timestamp);
        agreement.status = AgreementStatus.Accepted;
        emit AgreementAccepted(agreementId, msg.sender, agreement.acceptedAt);
    }

    function getUser(address account) external view returns (User memory) { return _users[account]; }
    function getAgreement(uint256 agreementId) external view agreementExists(agreementId) returns (Agreement memory) { return _agreements[agreementId]; }
    function getMilestone(uint256 agreementId, MilestoneType milestoneType) external view agreementExists(agreementId) returns (Milestone memory) { return _milestones[agreementId][milestoneType]; }
    function getAgreementIds(address account) external view returns (uint256[] memory) { return _userAgreementIds[account]; }
    function getCarrierStats(address carrier) external view returns (CarrierStats memory) { return _carrierStats[carrier]; }

    function _requireActionableMilestone(Agreement storage agreement, Milestone storage milestone, uint256 agreementId, MilestoneType milestoneType) internal view {
        if (milestone.completed) revert MilestoneAlreadyCompleted(agreementId, milestoneType);
        if (block.timestamp > agreement.deadline) revert DeadlinePassed(agreement.deadline, block.timestamp);
        if (milestoneType == MilestoneType.Pickup) {
            if (agreement.status != AgreementStatus.Funded) revert InvalidMilestoneOrder(milestoneType, agreement.status);
        } else if (agreement.status != AgreementStatus.PartiallyCompleted || !_milestones[agreementId][MilestoneType.Pickup].completed) {
            revert InvalidMilestoneOrder(milestoneType, agreement.status);
        }
    }

    function _requireRole(address account, Role requiredRole) internal view {
        Role currentRole = _users[account].role;
        if (currentRole == Role.None) revert NotRegistered(account);
        if (currentRole != requiredRole) revert InvalidRole();
    }

    function _validateText(bytes32 field, string calldata value, uint256 maximumLength) internal pure {
        uint256 suppliedLength = bytes(value).length;
        if (suppliedLength == 0 || suppliedLength > maximumLength) revert InvalidTextLength(field, suppliedLength, maximumLength);
    }
}
