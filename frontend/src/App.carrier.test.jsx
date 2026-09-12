import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appMocks = vi.hoisted(() => ({
  readWalletState: vi.fn(),
  createContract: vi.fn(),
  readContractSnapshot: vi.fn(),
}));

vi.mock("./lib/web3.js", () => ({
  LOCAL_CHAIN_ID: 31337,
  createContract: appMocks.createContract,
  explainWalletError: (error) => error.message,
  hasDeployment: () => true,
  hasWallet: () => Boolean(window.ethereum),
  readWalletState: appMocks.readWalletState,
  switchToLocalNetwork: vi.fn(),
}));

vi.mock("./lib/contractData.js", () => ({
  EMPTY_CARRIER_STATS: {
    verifiedMilestones: 0n,
    completedAgreements: 0n,
    expiredFundedAgreements: 0n,
  },
  readContractSnapshot: appMocks.readContractSnapshot,
}));

import App from "./App.jsx";

const carrierAccount = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199";
const contract = { acceptAgreement: vi.fn(), submitMilestoneEvidence: vi.fn() };

function snapshot(name = "Carrier") {
  return {
    user: { displayName: name, role: 2n },
    agreements: [],
    history: [],
    carrierStats: {
      verifiedMilestones: 0n,
      completedAgreements: 0n,
      expiredFundedAgreements: 0n,
    },
    chainTimestamp: 1_000,
    warnings: [],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Carrier application interactions", () => {
  beforeEach(() => {
    const listeners = new Map();
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: {
        request: vi.fn(),
        on: vi.fn((event, listener) => listeners.set(event, listener)),
        removeListener: vi.fn((event) => listeners.delete(event)),
        listeners,
      },
    });
    appMocks.readWalletState.mockReset().mockResolvedValue({
      account: carrierAccount,
      chainId: 31337,
      provider: { kind: "mock-eip-1193-provider" },
    });
    appMocks.createContract.mockReset().mockResolvedValue(contract);
    appMocks.readContractSnapshot.mockReset().mockResolvedValue(snapshot());
  });

  it("navigates every Carrier tab and refreshes an empty account", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Welcome back, Carrier" });

    await user.click(screen.getByRole("tab", { name: "Deliveries" }));
    expect(screen.getByRole("heading", { name: "Deliveries" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No active deliveries" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Refresh blockchain data" }));
    expect((await screen.findAllByText("Blockchain data refreshed.")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "Agreements" }));
    expect(screen.getByRole("heading", { name: "Agreements" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Guide" }));
    expect(screen.getByRole("heading", { name: /Understand the workflow/ })).toBeTruthy();
  });

  it("ignores an older refresh that completes after a newer request", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Welcome back, Carrier" });

    const older = deferred();
    appMocks.readContractSnapshot
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce(snapshot("Newest Carrier"));

    const refresh = screen.getByRole("button", { name: "Refresh blockchain data" });
    fireEvent.click(refresh);
    fireEvent.click(refresh);

    expect(await screen.findByRole("heading", { name: "Welcome back, Newest Carrier" })).toBeTruthy();
    older.resolve(snapshot("Stale Carrier"));
    await user.click(screen.getByRole("tab", { name: "Deliveries" }));
    expect(screen.queryByText("Welcome back, Stale Carrier")).toBeNull();
  });

  it("surfaces a refresh failure without disabling navigation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Welcome back, Carrier" });
    appMocks.readContractSnapshot.mockRejectedValueOnce(new Error("Local RPC unavailable"));

    await user.click(screen.getByRole("button", { name: "Refresh blockchain data" }));
    expect(await screen.findByText("Local RPC unavailable")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Deliveries" }));
    expect(screen.getByRole("heading", { name: "Deliveries" })).toBeTruthy();
  });

  it("clears Carrier data when the wallet disconnects", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Welcome back, Carrier" });
    appMocks.readWalletState.mockResolvedValueOnce({ account: "", chainId: 31337, provider: null });

    window.ethereum.listeners.get("accountsChanged")([]);
    await waitFor(() => expect(screen.getByText("Not connected")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Deliveries" })).toBeNull();
  });
});
