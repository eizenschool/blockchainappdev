import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CarrierDashboard from "./CarrierDashboard.jsx";

function record(id, status, { pickupCompleted = false } = {}) {
  return {
    agreement: {
      id: BigInt(id),
      status: BigInt(status),
      cargo: `Medical cargo ${id}`,
      origin: "Selangor",
      destination: "Kuala Lumpur",
      shipper: "0xdD2FD4581271e230360230F9337D5c0430Bf44C0",
      verifier: "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E",
      requiredEscrow: 1_000_000_000_000_000_000n,
      deadline: 2_000n,
    },
    pickup: { completed: pickupCompleted, evidenceCid: "", payoutBps: 3000n },
    delivery: { completed: false, evidenceCid: "", payoutBps: 7000n },
  };
}

function renderDashboard(agreements = []) {
  const handlers = {
    onRefresh: vi.fn(),
    onAccept: vi.fn().mockResolvedValue(true),
    onSubmitEvidence: vi.fn().mockResolvedValue(true),
    onRefund: vi.fn(),
  };
  render(
    <CarrierDashboard
      agreements={agreements}
      chainTimestamp={1_000}
      busy=""
      {...handlers}
    />,
  );
  return handlers;
}

describe("CarrierDashboard", () => {
  it("keeps refresh available for a Carrier with no assignments", async () => {
    const user = userEvent.setup();
    const handlers = renderDashboard();

    expect(screen.getByRole("heading", { name: "No active deliveries" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refresh blockchain data" }));
    expect(handlers.onRefresh).toHaveBeenCalledOnce();
  });

  it("supports Created, Accepted, Funded, and Pickup-verified views", async () => {
    const user = userEvent.setup();
    const handlers = renderDashboard([
      record(1, 0),
      record(2, 1),
      record(3, 2),
      record(4, 3, { pickupCompleted: true }),
    ]);

    await user.click(screen.getByRole("button", { name: "Accept agreement" }));
    expect(handlers.onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: 1n }));
    expect(screen.getByText(/Waiting for the Shipper to fund/)).toBeTruthy();

    const fundedCard = screen.getByText("Medical cargo 3").closest("article");
    const pickupCid = within(fundedCard).getByLabelText("IPFS CID");
    await user.type(pickupCid, "bafybeigdyrzt5sfp7udm7hu76");
    await user.click(within(fundedCard).getByRole("button", { name: "Submit evidence CID" }));
    expect(handlers.onSubmitEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3n }),
      0,
      "bafybeigdyrzt5sfp7udm7hu76",
    );

    const pickupVerifiedCard = screen.getByText("Medical cargo 4").closest("article");
    expect(within(pickupVerifiedCard).getByText("Delivery evidence")).toBeTruthy();
  });
});
