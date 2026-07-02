import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConductMark, ConductWordmark, OttoIcon } from "./OttoIcon";

afterEach(cleanup);

describe("Conduct logo components", () => {
  it("keeps the default icon as the Conduct mark", () => {
    const { container } = render(<OttoIcon className="otto-working h-4" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 28.036 24.019");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("otto-working");
    expect(container.querySelector("path")).toBeTruthy();
  });

  it("renders the standalone mark for compact brand surfaces", () => {
    const { container } = render(<ConductMark className="size-5" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 28.036 24.019");
    expect(svg).toHaveClass("size-5");
  });

  it("renders a wordmark callers can expose as a meaningful image", () => {
    const { container } = render(
      <ConductWordmark role="img" aria-label="Conduct" aria-hidden={false} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 128 28");
    expect(svg).toHaveAttribute("aria-hidden", "false");
    expect(svg).toHaveAttribute("aria-label", "Conduct");
    expect(container.querySelector("text")?.textContent).toBe("Conduct");
  });
});
