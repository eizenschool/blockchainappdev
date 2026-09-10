// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProofRouteEscrowVault} from "./ProofRouteEscrowVault.sol";

/// @notice Carrier IPFS evidence, nominated-Verifier approval and progressive payouts.
abstract contract ProofRouteEvidenceSettlement is ProofRouteEscrowVault {
    function submitMilestoneEvidence(uint256 agreementId, MilestoneType milestoneType, string calldata evidenceCid)
        external
        agreementExists(agreementId)
    {
        Agreement storage agreement = _agreements[agreementId];
        require(msg.sender == agreement.carrier, "Only the assigned Carrier can submit evidence");
        _requireRole(msg.sender, Role.Carrier);
        Milestone storage milestone = _milestones[agreementId][milestoneType];
        _requireActionableMilestone(agreement, milestone, agreementId, milestoneType);

        uint256 cidLength = bytes(evidenceCid).length;
        require(
            cidLength > 0 && cidLength <= MAX_EVIDENCE_CID_LENGTH,
            "Evidence CID must be 1 to 128 characters"
        );
        milestone.evidenceCid = evidenceCid;
        milestone.submittedAt = uint64(block.timestamp);
        emit MilestoneEvidenceSubmitted(agreementId, milestoneType, msg.sender, evidenceCid, milestone.submittedAt);
    }

    function approveMilestone(uint256 agreementId, MilestoneType milestoneType, string calldata proofCode)
        external
        nonReentrant
        agreementExists(agreementId)
    {
        Agreement storage agreement = _agreements[agreementId];
        require(msg.sender == agreement.verifier, "Only the nominated Verifier can approve");
        _requireRole(msg.sender, Role.Verifier);
        Milestone storage milestone = _milestones[agreementId][milestoneType];
        _requireActionableMilestone(agreement, milestone, agreementId, milestoneType);
        require(
            milestone.submittedAt > 0 && bytes(milestone.evidenceCid).length > 0,
            "Evidence must be submitted before approval"
        );

        // Hash the supplied code and compare it with the hash saved at creation.
        require(keccak256(bytes(proofCode)) == milestone.proofHash, "Proof code is incorrect");

        uint64 verifiedAt = uint64(block.timestamp);
        uint256 payoutAmount;
        CarrierStats storage stats = _carrierStats[agreement.carrier];
        if (milestoneType == MilestoneType.Pickup) {
            payoutAmount = (agreement.requiredEscrow * milestone.payoutBps) / BPS_DENOMINATOR;
            agreement.status = AgreementStatus.PartiallyCompleted;
        } else {
            payoutAmount = agreement.requiredEscrow - agreement.releasedAmount;
            agreement.status = AgreementStatus.Completed;
            stats.completedAgreements += 1;
        }

        milestone.completed = true;
        milestone.completedAt = verifiedAt;
        agreement.releasedAmount += payoutAmount;
        stats.verifiedMilestones += 1;

        // State is updated before the external call, and nonReentrant prevents re-entry.
        (bool success, ) = payable(agreement.carrier).call{value: payoutAmount}("");
        require(success, "Ether transfer failed");

        emit MilestoneVerified(agreementId, milestoneType, msg.sender, agreement.carrier, verifiedAt);
        emit EscrowReleased(agreementId, milestoneType, agreement.carrier, payoutAmount);
        if (milestoneType == MilestoneType.Delivery) emit AgreementCompleted(agreementId, verifiedAt);
    }
}
