// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProofRouteEvidenceSettlement} from "./modules/ProofRouteEvidenceSettlement.sol";

/// @title ProofRouteEscrow
/// @notice Medical-supply logistics agreements with test-Ether escrow, IPFS evidence and independent verification.
contract ProofRouteEscrow is ProofRouteEvidenceSettlement {
    function cancelAgreement(uint256 agreementId) external agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (msg.sender != agreement.shipper) revert Unauthorized(msg.sender);
        if (agreement.status != AgreementStatus.Created && agreement.status != AgreementStatus.Accepted) revert InvalidAgreementStatus(agreement.status);
        agreement.status = AgreementStatus.Cancelled;
        emit AgreementCancelled(agreementId, msg.sender);
    }

    function processExpiredAgreement(uint256 agreementId) external nonReentrant agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (agreement.status != AgreementStatus.Funded && agreement.status != AgreementStatus.PartiallyCompleted) revert InvalidAgreementStatus(agreement.status);
        if (block.timestamp <= agreement.deadline) revert DeadlineNotPassed(agreement.deadline, block.timestamp);

        uint256 refundAmount = agreement.requiredEscrow - agreement.releasedAmount;
        agreement.status = AgreementStatus.Refunded;
        _carrierStats[agreement.carrier].expiredFundedAgreements += 1;
        (bool success, ) = payable(agreement.shipper).call{value: refundAmount}("");
        if (!success) revert EtherTransferFailed();
        emit AgreementRefunded(agreementId, agreement.shipper, refundAmount);
    }
}
