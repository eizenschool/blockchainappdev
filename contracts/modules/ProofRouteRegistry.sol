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
    // These mappings use the same key-to-value pattern introduced in the practicals.
    mapping(address => User) internal _users;
    mapping(uint256 => Agreement) internal _agreements;
    mapping(uint256 => mapping(MilestoneType => Milestone)) internal _milestones;
    mapping(address => uint256[]) internal _userAgreementIds;
    mapping(address => CarrierStats) internal _carrierStats;

    modifier agreementExists(uint256 agreementId) {
        require(agreementId > 0 && agreementId <= agreementCount, "Agreement does not exist");
        _;
    }

    function registerUser(string calldata displayName, Role role) external {
        require(_users[msg.sender].role == Role.None, "Wallet is already registered");
        require(
            role == Role.Shipper || role == Role.Carrier || role == Role.Verifier,
            "Role must be Shipper, Carrier, or Verifier"
        );
        uint256 nameLength = bytes(displayName).length;
        require(
            nameLength >= 3 && nameLength <= MAX_NAME_LENGTH,
            "Display name must be 3 to 32 characters"
        );

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
        // The connected wallet is the user's identity, so each action checks its role.
        _requireRole(msg.sender, Role.Shipper);
        require(carrier != msg.sender, "Shipper and Carrier must be different");
        require(_users[carrier].role == Role.Carrier, "Carrier must be registered as Carrier");
        require(
            verifier != msg.sender && verifier != carrier && _users[verifier].role == Role.Verifier,
            "Verifier must be registered and different"
        );
        require(requiredEscrow > 0, "Escrow amount must be greater than zero");
        require(deadline > block.timestamp, "Deadline must be in the future");
        require(
            pickupBps > 0 && pickupBps < BPS_DENOMINATOR,
            "Pickup percentage must be between 1 and 9999"
        );
        require(
            pickupProofHash != bytes32(0) && deliveryProofHash != bytes32(0),
            "Proof hashes are required"
        );
        require(pickupProofHash != deliveryProofHash, "Proof hashes must be different");
        _validateText(cargo, MAX_CARGO_LENGTH);
        _validateText(origin, MAX_LOCATION_LENGTH);
        _validateText(destination, MAX_LOCATION_LENGTH);

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
        require(msg.sender == agreement.carrier, "Only the assigned Carrier can accept");
        _requireRole(msg.sender, Role.Carrier);
        require(agreement.status == AgreementStatus.Created, "Agreement must be in Created state");
        require(block.timestamp <= agreement.deadline, "Agreement deadline has passed");

        // Acceptance advances the agreement to its next permitted state.
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
        require(!milestone.completed, "Milestone is already completed");
        require(block.timestamp <= agreement.deadline, "Agreement deadline has passed");
        if (milestoneType == MilestoneType.Pickup) {
            require(agreement.status == AgreementStatus.Funded, "Pickup requires a funded agreement");
        } else {
            require(
                agreement.status == AgreementStatus.PartiallyCompleted
                    && _milestones[agreementId][MilestoneType.Pickup].completed,
                "Delivery requires approved pickup"
            );
        }
    }

    function _requireRole(address account, Role requiredRole) internal view {
        Role currentRole = _users[account].role;
        require(currentRole != Role.None, "Wallet is not registered");
        require(currentRole == requiredRole, "Wallet has the wrong role");
    }

    function _validateText(string calldata value, uint256 maximumLength) internal pure {
        uint256 suppliedLength = bytes(value).length;
        require(
            suppliedLength > 0 && suppliedLength <= maximumLength,
            "Text is required and must be within its limit"
        );
    }
}
