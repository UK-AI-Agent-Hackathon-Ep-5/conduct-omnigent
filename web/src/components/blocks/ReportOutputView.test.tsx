import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportChatProvider } from "./ReportChatContext";
import { ReportOutputView } from "./ReportOutputView";
import type { ReportOutput } from "./reportOutput";

const REPORT: ReportOutput = {
  report_version: 1,
  run_id: "example-2026-07-02T0900Z",
  generated_at: "2026-07-02T09:00:00Z",
  title: "LLM Impact Radar Report",
  target: { name: "Example Project" },
  providers: ["openai", "gemini", "deepseek"],
  sections: [
    {
      id: "summary-main",
      type: "executive_summary",
      title: "Executive Summary",
      content: "Three model references need review before release.",
      severity: "high",
      data: {
        metrics: [
          { label: "Providers checked", value: "3" },
          { label: "Recommended P0 actions", value: "1" },
        ],
      },
    },
    {
      id: "cost-gemini-summary-job",
      type: "cost_impact",
      title: "Summarisation Job Cost Impact",
      content: "Moving the summarisation job increases the monthly estimate.",
      severity: "medium",
      data: {
        old: { input: 18, output: 24 },
        new: { input: 31.5, output: 66 },
        delta_usd: 55.5,
        pct_change: 132.14,
        currency: "USD",
      },
    },
    {
      id: "code-impact-chat-default",
      type: "code_impact",
      title: "Hardcoded DeepSeek Chat Model",
      content: "The fallback chat path still uses deepseek-chat.",
      severity: "critical",
      data: {
        file: "src/llm/chat_client.py",
        line: 47,
        provider: "deepseek",
        model: "deepseek-chat",
      },
    },
  ],
};

describe("ReportOutputView", () => {
  it("renders a horizontal section preview strip and the first section detail", () => {
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    expect(screen.getByTestId("report-output")).toBeDefined();
    expect(screen.getByTestId("report-section-strip")).toBeDefined();
    expect(screen.getByText("LLM Impact Radar Report")).toBeDefined();
    expect(screen.getAllByText("Providers checked").length).toBeGreaterThan(0);
    expect(screen.getByText("Recommended P0 actions")).toBeDefined();
  });

  it("keeps the generated report free of the product brand label", () => {
    const brand = ["Conduct", "Omnigent"].join(" ");

    render(
      <ReportOutputView
        report={{
          ...REPORT,
          title: `${brand} LLM Impact Radar Report`,
          target: { name: `${brand} Example Project` },
          providers: ["openai", brand],
          sections: [
            {
              ...REPORT.sections[0]!,
              title: `${brand} Executive Summary`,
              content: `${brand} should stay out of this report.`,
            },
          ],
        }}
        enablePixi={false}
      />,
    );

    expect(screen.queryByText(new RegExp(brand, "i"))).toBeNull();
    expect(screen.getByText("LLM Impact Radar Report")).toBeDefined();
    expect(screen.getAllByText("Executive Summary").length).toBeGreaterThan(0);
    expect(screen.queryByText(["Top", "Signal"].join(" "))).toBeNull();
  });

  it("scrolls the section preview strip from wheel input", () => {
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    const strip = screen.getByTestId("report-section-strip");
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 960 });

    fireEvent.wheel(strip, { deltaY: 180 });

    expect(strip.scrollLeft).toBe(180);
    expect(strip.className).not.toContain("snap");
  });

  it("keeps completed sections visible and shows the incoming section loader", () => {
    render(
      <ReportOutputView
        report={{ ...REPORT, sections: [REPORT.sections[0]!] }}
        enablePixi={false}
        isStreaming
      />,
    );

    expect(screen.getByText("Generating report")).toBeDefined();
    expect(screen.getByText("1 complete sections")).toBeDefined();
    expect(screen.getAllByText("Executive Summary").length).toBeGreaterThan(0);
    expect(screen.getByTestId("report-section-loading")).toBeDefined();
    expect(screen.getByLabelText("Next report section loading")).toBeDefined();
  });

  it("switches focus to a selected section and shows cost visualisation", () => {
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Summarisation Job Cost Impact/i }));

    const detail = screen.getByTestId("report-section-detail");
    expect(within(detail).getByText("Summarisation Job Cost Impact")).toBeDefined();
    expect(within(detail).getByText("Cost movement")).toBeDefined();
    expect(within(detail).getByText("$42.00")).toBeDefined();
    expect(within(detail).getByText("$97.50")).toBeDefined();
    expect(within(detail).getByText("$55.50")).toBeDefined();
  });

  it("collapses and expands the active section", () => {
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    const collapse = screen.getByRole("button", { name: "Collapse report section" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(collapse);
    const expand = screen.getByRole("button", { name: "Expand report section" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
  });

  it("sends the focused section to the chat context", () => {
    const onReportChat = vi.fn();
    render(
      <ReportChatProvider value={onReportChat}>
        <ReportOutputView report={REPORT} enablePixi={false} />
      </ReportChatProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Hardcoded DeepSeek/i }));
    fireEvent.click(screen.getByRole("button", { name: "Ask about section" }));

    expect(onReportChat).toHaveBeenCalledTimes(1);
    expect(onReportChat.mock.calls[0]?.[0]).toContain("Report: LLM Impact Radar Report");
    expect(onReportChat.mock.calls[0]?.[0]).toContain("Section: Hardcoded DeepSeek Chat Model");
    expect(onReportChat.mock.calls[0]?.[0]).toContain("deepseek-chat");
  });
});
