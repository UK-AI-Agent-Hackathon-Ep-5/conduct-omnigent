import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLoadingScreen } from "./AppLoadingScreen";

describe("AppLoadingScreen", () => {
  it("renders the boot loading state", () => {
    render(<AppLoadingScreen />);

    expect(screen.getByRole("heading", { name: "Preparing workspace" })).toBeInTheDocument();
    expect(
      screen.getByText("Connecting to the server and restoring your session."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
