// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProofRouteEscrowVault} from "./ProofRouteEscrowVault.sol";

/// @notice Carrier IPFS evidence, nominated-Verifier approval and progressive payouts.
abstract contract ProofRouteEvidenceSettlement is ProofRouteEscrowVault {
    function submitMilestoneEvidence(uint256 agreementId, MilestoneType milestoneType, string calldata evidenceCid)
        external
        nonReentrant
        agreementExists(agreementId)
    {
        Agreement storage agreement = _agreements[agreementId];
        if (msg.sender != agreement.carrier) revert Unauthorized(msg.sender);
        _requireRole(msg.sender, Role.Carrier);
        Milestone storage milestone = _milestones[agreementId][milestoneType];
        _requireActionableMilestone(agreement, milestone, agreementId, milestoneType);

        uint256 cidLength = bytes(evidenceCid).length;
        if (cidLength == 0 || cidLength > MAX_EVIDENCE_CID_LENGTH) revert InvalidEvidenceCid(cidLength, MAX_EVIDENCE_CID_LENGTH);
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
        if (msg.sender != agreement.verifier) revert Unauthorized(msg.sender);
        _requireRole(msg.sender, Role.Verifier);
        Milestone storage milestone = _milestones[agreementId][milestoneType];
        _requireActionableMilestone(agreement, milestone, agreementId, milestoneType);
        if (milestone.submittedAt == 0 || bytes(milestone.evidenceCid).length == 0) revert EvidenceNotSubmitted(agreementId, milestoneType);
        if (keccak256(bytes(proofCode)) != milestone.proofHash) revert InvalidMilestoneProof(agreementId, milestoneType);

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
        (bool success, ) = payable(agreement.carrier).call{value: payoutAmount}("");
        if (!success) revert EtherTransferFailed();

        emit MilestoneVerified(agreementId, milestoneType, msg.sender, agreement.carrier, verifiedAt);
        emit EscrowReleased(agreementId, milestoneType, agreement.carrier, payoutAmount);
        if (milestoneType == MilestoneType.Delivery) emit AgreementCompleted(agreementId, verifiedAt);
    }
}
