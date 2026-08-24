// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IProofRoutePayoutHarness {
    function registerUser(string calldata displayName, uint8 role) external;

    function acceptAgreement(uint256 agreementId) external;

    function submitMilestoneProof(uint256 agreementId, uint8 milestoneType, string calldata proofCode) external;
}

/// @dev Test-only carrier used to verify failed payout and reentrancy behavior.
contract PayoutReceiverHarness {
    IProofRoutePayoutHarness public immutable escrow;
    uint256 public agreementId;
    bool public rejectPayout;
    bool public attemptReentry;
    bool public reentryBlocked;

    constructor(address escrowAddress) {
        escrow = IProofRoutePayoutHarness(escrowAddress);
    }

    function registerAsCarrier() external {
        escrow.registerUser("Harness Carrier", 2);
    }

    function accept(uint256 nextAgreementId) external {
        agreementId = nextAgreementId;
        escrow.acceptAgreement(nextAgreementId);
    }

    function submit(uint8 milestoneType, string calldata proofCode) external {
        escrow.submitMilestoneProof(agreementId, milestoneType, proofCode);
    }

    function configureReceiver(bool shouldReject, bool shouldReenter) external {
        rejectPayout = shouldReject;
        attemptReentry = shouldReenter;
        reentryBlocked = false;
    }

    receive() external payable {
        if (rejectPayout) revert("payout rejected");

        if (attemptReentry) {
            try escrow.submitMilestoneProof(agreementId, 0, "pickup-secret") {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
    }
}
