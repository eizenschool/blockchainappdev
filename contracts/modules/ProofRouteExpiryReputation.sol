// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProofRouteEvidenceSettlement} from "./ProofRouteEvidenceSettlement.sol";

/// @notice Pre-funding cancellation, expiry refunds and transition-backed Carrier counters.
abstract contract ProofRouteExpiryReputation is ProofRouteEvidenceSettlement {
    function cancelAgreement(uint256 agreementId) external agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        require(msg.sender == agreement.shipper, "Only the Shipper can cancel this agreement");
        require(
            agreement.status == AgreementStatus.Created || agreement.status == AgreementStatus.Accepted,
            "Agreement cannot be cancelled now"
        );
        agreement.status = AgreementStatus.Cancelled;
        emit AgreementCancelled(agreementId, msg.sender);
    }

    /// @notice Any wallet may call this after expiry; Solidity cannot invoke it on a timer.
    function processExpiredAgreement(uint256 agreementId) external nonReentrant agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        require(
            agreement.status == AgreementStatus.Funded || agreement.status == AgreementStatus.PartiallyCompleted,
            "Agreement is not refundable"
        );
        require(block.timestamp > agreement.deadline, "Agreement deadline has not passed");

        uint256 refundAmount = agreement.requiredEscrow - agreement.releasedAmount;
        // Record the refund before sending ETH so the same agreement cannot refund twice.
        agreement.status = AgreementStatus.Refunded;
        _carrierStats[agreement.carrier].expiredFundedAgreements += 1;
        (bool success, ) = payable(agreement.shipper).call{value: refundAmount}("");
        require(success, "Ether transfer failed");
        emit AgreementRefunded(agreementId, agreement.shipper, refundAmount);
    }
}
