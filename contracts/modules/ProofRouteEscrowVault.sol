// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProofRouteRegistry} from "./ProofRouteRegistry.sol";

/// @notice Exact escrow funding and accountable test-Ether custody.
abstract contract ProofRouteEscrowVault is ProofRouteRegistry {
    function fundAgreement(uint256 agreementId) external payable agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        require(msg.sender == agreement.shipper, "Only the Shipper can fund this agreement");
        require(agreement.status == AgreementStatus.Accepted, "Agreement must be accepted before funding");
        require(block.timestamp <= agreement.deadline, "Agreement deadline has passed");
        require(msg.value == agreement.requiredEscrow, "Exact escrow amount is required");

        // The test ETH is now held by this contract until payout or refund.
        agreement.fundedAt = uint64(block.timestamp);
        agreement.status = AgreementStatus.Funded;
        emit AgreementFunded(agreementId, msg.sender, msg.value, agreement.fundedAt);
    }

    receive() external payable {
        revert("Direct ETH transfers are not allowed");
    }

    fallback() external payable {
        revert("Direct ETH transfers are not allowed");
    }
}
