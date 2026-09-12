import { beforeEach, describe, expect, it, vi } from "vitest";

const historyMocks = vi.hoisted(() => ({
  loadAgreementHistory: vi.fn(),
}));

vi.mock("./history.js", () => historyMocks);

import { EMPTY_CARRIER_STATS, readContractSnapshot } from "./contractData.js";

const account = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199";

function createContract({ role = 2, agreementIds = [1n] } = {}) {
  return {
    runner: { provider: { getBlock: vi.fn().mockResolvedValue({ timestamp: 500, number: 4 }) } },
    getUser: vi.fn().mockResolvedValue({ displayName: "Carrier", role: BigInt(role) }),
    getAgreementIds: vi.fn().mockResolvedValue(agreementIds),
    getAgreement: vi.fn().mockResolvedValue({ id: 1n, status: 0n }),
    getMilestone: vi.fn().mockImplementation((_id, milestone) =>
      Promise.resolve({ completed: false, evidenceCid: "", payoutBps: milestone === 0 ? 3000n : 7000n })),
    getCarrierStats: vi.fn().mockResolvedValue({
      verifiedMilestones: 2n,
      completedAgreements: 1n,
      expiredFundedAgreements: 0n,
    }),
  };
}

describe("readContractSnapshot", () => {
  beforeEach(() => {
    historyMocks.loadAgreementHistory.mockReset().mockResolvedValue([{ key: "history-1" }]);
  });

  it("loads Carrier agreements, milestones, history, and statistics as one snapshot", async () => {
    const contract = createContract();
    const snapshot = await readContractSnapshot(contract, account);

    expect(snapshot.user.displayName).toBe("Carrier");
    expect(snapshot.agreements).toHaveLength(1);
    expect(snapshot.history).toEqual([{ key: "history-1" }]);
    expect(snapshot.carrierStats.completedAgreements).toBe(1n);
    expect(snapshot.chainTimestamp).toBe(500);
    expect(snapshot.warnings).toEqual([]);
  });

  it("keeps core Carrier data usable when history and statistics fail", async () => {
    const contract = createContract();
    historyMocks.loadAgreementHistory.mockRejectedValue(new Error("history unavailable"));
    contract.getCarrierStats.mockRejectedValue(new Error("stats unavailable"));

    const snapshot = await readContractSnapshot(contract, account);

    expect(snapshot.agreements).toHaveLength(1);
    expect(snapshot.history).toEqual([]);
    expect(snapshot.carrierStats).toEqual(EMPTY_CARRIER_STATS);
    expect(snapshot.warnings).toEqual([
      "Event history is temporarily unavailable.",
      "Carrier statistics are temporarily unavailable.",
    ]);
  });

  it("does not perform agreement reads for an unregistered wallet", async () => {
    const contract = createContract({ role: 0, agreementIds: [] });
    const snapshot = await readContractSnapshot(contract, account);

    expect(contract.getAgreementIds).not.toHaveBeenCalled();
    expect(snapshot.agreements).toEqual([]);
    expect(snapshot.carrierStats).toEqual(EMPTY_CARRIER_STATS);
  });
});
