import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OttoEyes } from "./OttoEyes";

afterEach(cleanup);

describe("OttoEyes", () => {
  it("renders the Conduct wordmark with image semantics", () => {
    const { container } = render(<OttoEyes className="h-10" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Conduct");
    expect(svg).toHaveAttribute("aria-hidden", "false");
    expect(svg).toHaveClass("h-10");
    expect(container.querySelector("text")?.textContent).toBe("Conduct");
  });
});
