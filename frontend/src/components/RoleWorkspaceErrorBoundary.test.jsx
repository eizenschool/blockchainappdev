import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RoleWorkspaceErrorBoundary from "./RoleWorkspaceErrorBoundary.jsx";

function BrokenWorkspace() {
  throw new Error("render failed");
}

describe("RoleWorkspaceErrorBoundary", () => {
  it("keeps a recovery screen available and resets when the workspace changes", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <RoleWorkspaceErrorBoundary resetKey="carrier:deliveries">
        <BrokenWorkspace />
      </RoleWorkspaceErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "This workspace could not be displayed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload application" })).toBeTruthy();

    rerender(
      <RoleWorkspaceErrorBoundary resetKey="carrier:agreements">
        <p>Recovered workspace</p>
      </RoleWorkspaceErrorBoundary>,
    );
    expect(screen.getByText("Recovered workspace")).toBeTruthy();
    consoleError.mockRestore();
  });
});
