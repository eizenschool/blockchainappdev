// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ProofRouteEscrow
/// @notice Logistics agreements with test-Ether escrow and hash-verified milestones.
/// @dev Member A foundation: registration, creation, acceptance, funding, cancellation and expiry refunds.
contract ProofRouteEscrow is ReentrancyGuard {
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_NAME_LENGTH = 32;
    uint256 public constant MAX_CARGO_LENGTH = 120;
    uint256 public constant MAX_LOCATION_LENGTH = 80;

    enum Role {
        None,
        Shipper,
        Carrier
    }

    enum AgreementStatus {
        Created,
        Accepted,
        Funded,
        PartiallyCompleted,
        Completed,
        Refunded,
        Cancelled
    }

    enum MilestoneType {
        Pickup,
        Delivery
    }

    struct User {
        string displayName;
        Role role;
        uint64 registeredAt;
    }

    struct Agreement {
        uint256 id;
        address shipper;
        address carrier;
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
    }

    error AlreadyRegistered(address account);
    error NotRegistered(address account);
    error InvalidRole();
    error InvalidDisplayName();
    error InvalidTextLength(bytes32 field, uint256 suppliedLength, uint256 maximumLength);
    error InvalidCarrier(address carrier);
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
    error EtherTransferFailed();
    error DirectPaymentNotAllowed();

    event UserRegistered(address indexed account, string displayName, Role indexed role, uint64 registeredAt);
    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed shipper,
        address indexed carrier,
        uint256 requiredEscrow,
        uint64 deadline,
        uint16 pickupBps
    );
    event AgreementAccepted(uint256 indexed agreementId, address indexed carrier, uint64 acceptedAt);
    event AgreementFunded(uint256 indexed agreementId, address indexed shipper, uint256 amount, uint64 fundedAt);
    event AgreementCancelled(uint256 indexed agreementId, address indexed shipper);
    event AgreementRefunded(uint256 indexed agreementId, address indexed shipper, uint256 amount);

    // Reserved shared events for Member B's milestone implementation.
    event MilestoneVerified(
        uint256 indexed agreementId,
        MilestoneType indexed milestone,
        address indexed carrier,
        uint64 verifiedAt
    );
    event EscrowReleased(
        uint256 indexed agreementId,
        MilestoneType indexed milestone,
        address indexed carrier,
        uint256 amount
    );
    event AgreementCompleted(uint256 indexed agreementId, uint64 completedAt);

    uint256 public agreementCount;

    mapping(address account => User user) private _users;
    mapping(uint256 agreementId => Agreement agreement) private _agreements;
    mapping(uint256 agreementId => mapping(MilestoneType milestoneType => Milestone milestone)) private _milestones;
    mapping(address account => uint256[] agreementIds) private _userAgreementIds;

    modifier agreementExists(uint256 agreementId) {
        if (agreementId == 0 || agreementId > agreementCount) {
            revert AgreementNotFound(agreementId);
        }
        _;
    }

    function registerUser(string calldata displayName, Role role) external {
        if (_users[msg.sender].role != Role.None) {
            revert AlreadyRegistered(msg.sender);
        }
        if (role != Role.Shipper && role != Role.Carrier) {
            revert InvalidRole();
        }

        uint256 nameLength = bytes(displayName).length;
        if (nameLength < 3 || nameLength > MAX_NAME_LENGTH) {
            revert InvalidDisplayName();
        }

        uint64 registeredAt = uint64(block.timestamp);
        _users[msg.sender] = User({displayName: displayName, role: role, registeredAt: registeredAt});

        emit UserRegistered(msg.sender, displayName, role, registeredAt);
    }

    function createAgreement(
        address carrier,
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

        _agreements[agreementId] = Agreement({
            id: agreementId,
            shipper: msg.sender,
            carrier: carrier,
            cargo: cargo,
            origin: origin,
            destination: destination,
            requiredEscrow: requiredEscrow,
            releasedAmount: 0,
            deadline: deadline,
            createdAt: createdAt,
            acceptedAt: 0,
            fundedAt: 0,
            pickupBps: pickupBps,
            status: AgreementStatus.Created
        });

        _milestones[agreementId][MilestoneType.Pickup] = Milestone({
            proofHash: pickupProofHash,
            payoutBps: pickupBps,
            completed: false,
            completedAt: 0
        });
        _milestones[agreementId][MilestoneType.Delivery] = Milestone({
            proofHash: deliveryProofHash,
            payoutBps: BPS_DENOMINATOR - pickupBps,
            completed: false,
            completedAt: 0
        });

        _userAgreementIds[msg.sender].push(agreementId);
        _userAgreementIds[carrier].push(agreementId);

        emit AgreementCreated(agreementId, msg.sender, carrier, requiredEscrow, deadline, pickupBps);
    }

    /// @notice Shared lifecycle dependency; Member B owns the final carrier-facing UI for this action.
    function acceptAgreement(uint256 agreementId) external agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (msg.sender != agreement.carrier) revert Unauthorized(msg.sender);
        _requireRole(msg.sender, Role.Carrier);
        if (agreement.status != AgreementStatus.Created) revert InvalidAgreementStatus(agreement.status);
        if (block.timestamp > agreement.deadline) revert DeadlinePassed(agreement.deadline, block.timestamp);

        uint64 acceptedAt = uint64(block.timestamp);
        agreement.acceptedAt = acceptedAt;
        agreement.status = AgreementStatus.Accepted;

        emit AgreementAccepted(agreementId, msg.sender, acceptedAt);
    }

    function fundAgreement(uint256 agreementId) external payable agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (msg.sender != agreement.shipper) revert Unauthorized(msg.sender);
        if (agreement.status != AgreementStatus.Accepted) revert InvalidAgreementStatus(agreement.status);
        if (block.timestamp > agreement.deadline) revert DeadlinePassed(agreement.deadline, block.timestamp);
        if (msg.value != agreement.requiredEscrow) {
            revert IncorrectEscrowAmount(agreement.requiredEscrow, msg.value);
        }

        uint64 fundedAt = uint64(block.timestamp);
        agreement.fundedAt = fundedAt;
        agreement.status = AgreementStatus.Funded;

        emit AgreementFunded(agreementId, msg.sender, msg.value, fundedAt);
    }

    function cancelAgreement(uint256 agreementId) external agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (msg.sender != agreement.shipper) revert Unauthorized(msg.sender);
        if (agreement.status != AgreementStatus.Created && agreement.status != AgreementStatus.Accepted) {
            revert InvalidAgreementStatus(agreement.status);
        }

        agreement.status = AgreementStatus.Cancelled;
        emit AgreementCancelled(agreementId, msg.sender);
    }

    /// @notice Refunds all unreleased escrow after expiry. Any wallet may trigger this upkeep action.
    function processExpiredAgreement(uint256 agreementId) external nonReentrant agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (
            agreement.status != AgreementStatus.Funded &&
            agreement.status != AgreementStatus.PartiallyCompleted
        ) {
            revert InvalidAgreementStatus(agreement.status);
        }
        if (block.timestamp <= agreement.deadline) {
            revert DeadlineNotPassed(agreement.deadline, block.timestamp);
        }

        uint256 refundAmount = agreement.requiredEscrow - agreement.releasedAmount;

        // Checks-effects-interactions: lock the terminal state before transferring Ether.
        agreement.status = AgreementStatus.Refunded;

        (bool success, ) = payable(agreement.shipper).call{value: refundAmount}("");
        if (!success) revert EtherTransferFailed();

        emit AgreementRefunded(agreementId, agreement.shipper, refundAmount);
    }

    function getUser(address account) external view returns (User memory) {
        return _users[account];
    }

    function getAgreement(uint256 agreementId)
        external
        view
        agreementExists(agreementId)
        returns (Agreement memory)
    {
        return _agreements[agreementId];
    }

    function getMilestone(uint256 agreementId, MilestoneType milestoneType)
        external
        view
        agreementExists(agreementId)
        returns (Milestone memory)
    {
        return _milestones[agreementId][milestoneType];
    }

    function getAgreementIds(address account) external view returns (uint256[] memory) {
        return _userAgreementIds[account];
    }

    receive() external payable {
        revert DirectPaymentNotAllowed();
    }

    fallback() external payable {
        revert DirectPaymentNotAllowed();
    }

    function _requireRole(address account, Role requiredRole) private view {
        Role currentRole = _users[account].role;
        if (currentRole == Role.None) revert NotRegistered(account);
        if (currentRole != requiredRole) revert InvalidRole();
    }

    function _validateText(bytes32 field, string calldata value, uint256 maximumLength) private pure {
        uint256 suppliedLength = bytes(value).length;
        if (suppliedLength == 0 || suppliedLength > maximumLength) {
            revert InvalidTextLength(field, suppliedLength, maximumLength);
        }
    }
}
