// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProofRouteRegistry} from "./ProofRouteRegistry.sol";

/// @notice Exact escrow funding and accountable test-Ether custody.
abstract contract ProofRouteEscrowVault is ProofRouteRegistry {
    function fundAgreement(uint256 agreementId) external payable agreementExists(agreementId) {
        Agreement storage agreement = _agreements[agreementId];
        if (msg.sender != agreement.shipper) revert Unauthorized(msg.sender);
        if (agreement.status != AgreementStatus.Accepted) revert InvalidAgreementStatus(agreement.status);
        if (block.timestamp > agreement.deadline) revert DeadlinePassed(agreement.deadline, block.timestamp);
        if (msg.value != agreement.requiredEscrow) revert IncorrectEscrowAmount(agreement.requiredEscrow, msg.value);

        agreement.fundedAt = uint64(block.timestamp);
        agreement.status = AgreementStatus.Funded;
        emit AgreementFunded(agreementId, msg.sender, msg.value, agreement.fundedAt);
    }

    receive() external payable { revert DirectPaymentNotAllowed(); }
    fallback() external payable { revert DirectPaymentNotAllowed(); }
}
