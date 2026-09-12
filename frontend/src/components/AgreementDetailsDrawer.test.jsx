import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgreementDetailsDrawer from "./AgreementDetailsDrawer.jsx";

const address = "0x0000000000000000000000000000000000000001";

function renderDrawer(onClose) {
  render(
    <AgreementDetailsDrawer
      record={{
        agreement: {
          id: 1n,
          shipper: address,
          carrier: address,
          verifier: address,
          cargo: "General medicines",
          origin: "Sarawak",
          destination: "Perak",
          requiredEscrow: 1_000_000_000_000_000_000n,
          releasedAmount: 0n,
          deadline: 2_000n,
          status: 0n,
        },
        pickup: { payoutBps: 3_000n, completed: false, evidenceCid: "" },
        delivery: { payoutBps: 7_000n, completed: false, evidenceCid: "" },
      }}
      history={[]}
      role={2}
      chainTimestamp={1_000}
      busy=""
      notice={null}
      returnFocus={null}
      onClose={onClose}
      onFund={vi.fn()}
      onCancel={vi.fn()}
      onRefund={vi.fn()}
    />,
  );
}

describe("AgreementDetailsDrawer", () => {
  it("closes immediately when the X is pressed with a pointer", () => {
    const onClose = vi.fn();
    renderDrawer(onClose);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Close agreement details" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps keyboard click activation", () => {
    const onClose = vi.fn();
    renderDrawer(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close agreement details" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
