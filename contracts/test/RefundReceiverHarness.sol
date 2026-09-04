// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IProofRouteEscrowHarness {
    function registerUser(string calldata displayName, uint8 role) external;

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
    ) external returns (uint256);

    function fundAgreement(uint256 agreementId) external payable;

    function processExpiredAgreement(uint256 agreementId) external;
}

/// @dev Test-only shipper used to verify failed refund and reentrancy behavior.
contract RefundReceiverHarness {
    IProofRouteEscrowHarness public immutable escrow;
    uint256 public agreementId;
    bool public rejectRefund;
    bool public attemptReentry;
    bool public reentryBlocked;

    constructor(address escrowAddress) {
        escrow = IProofRouteEscrowHarness(escrowAddress);
    }

    function registerAsShipper() external {
        escrow.registerUser("Harness Shipper", 1);
    }

    function create(
        address carrier,
        address verifier,
        uint256 requiredEscrow,
        uint64 deadline,
        bytes32 pickupProofHash,
        bytes32 deliveryProofHash
    ) external {
        agreementId = escrow.createAgreement(
            carrier,
            verifier,
            "Test cargo",
            "Test origin",
            "Test destination",
            requiredEscrow,
            deadline,
            3_000,
            pickupProofHash,
            deliveryProofHash
        );
    }

    function fund() external payable {
        escrow.fundAgreement{value: msg.value}(agreementId);
    }

    function configureReceiver(bool shouldReject, bool shouldReenter) external {
        rejectRefund = shouldReject;
        attemptReentry = shouldReenter;
        reentryBlocked = false;
    }

    receive() external payable {
        if (rejectRefund) revert("refund rejected");

        if (attemptReentry) {
            try escrow.processExpiredAgreement(agreementId) {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
    }
}
