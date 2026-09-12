import { loadAgreementHistory } from "./history.js";

export const EMPTY_CARRIER_STATS = Object.freeze({
  verifiedMilestones: 0n,
  completedAgreements: 0n,
  expiredFundedAgreements: 0n,
});

export async function readContractSnapshot(contract, account) {
  const [latestBlock, user] = await Promise.all([
    contract.runner.provider.getBlock("latest"),
    contract.getUser(account),
  ]);
  const role = Number(user.role);

  if (role === 0) {
    return {
      user,
      agreements: [],
      history: [],
      carrierStats: EMPTY_CARRIER_STATS,
      chainTimestamp: Number(latestBlock.timestamp),
      warnings: [],
    };
  }

  const agreementIds = await contract.getAgreementIds(account);
  const agreements = await Promise.all(
    [...agreementIds].reverse().map(async (agreementId) => {
      const [agreement, pickup, delivery] = await Promise.all([
        contract.getAgreement(agreementId),
        contract.getMilestone(agreementId, 0),
        contract.getMilestone(agreementId, 1),
      ]);
      return { agreement, pickup, delivery };
    }),
  );

  const [historyResult, carrierStatsResult] = await Promise.allSettled([
    loadAgreementHistory(contract, agreementIds),
    role === 2 ? contract.getCarrierStats(account) : Promise.resolve(EMPTY_CARRIER_STATS),
  ]);
  const warnings = [];

  if (historyResult.status === "rejected") {
    warnings.push("Event history is temporarily unavailable.");
  }
  if (carrierStatsResult.status === "rejected") {
    warnings.push("Carrier statistics are temporarily unavailable.");
  }

  return {
    user,
    agreements,
    history: historyResult.status === "fulfilled" ? historyResult.value : [],
    carrierStats: carrierStatsResult.status === "fulfilled" ? carrierStatsResult.value : EMPTY_CARRIER_STATS,
    chainTimestamp: Number(latestBlock.timestamp),
    warnings,
  };
}
