import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportChatProvider, type ReportChatRequest } from "./ReportChatContext";
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

function mockAnimationFrames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });

  return {
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(window.performance.now() + 220);
    },
    restore() {
      request.mockRestore();
      cancel.mockRestore();
    },
  };
}

type MockSelectionState = {
  text: string;
  anchorNode: Node | null;
  focusNode?: Node | null;
};

function mockWindowSelection(state: MockSelectionState) {
  return vi.spyOn(window, "getSelection").mockImplementation(
    () =>
      ({
        toString: () => state.text,
        rangeCount: state.text ? 1 : 0,
        isCollapsed: state.text.length === 0,
        anchorNode: state.anchorNode,
        focusNode: state.focusNode ?? state.anchorNode,
        getRangeAt: () =>
          ({
            commonAncestorContainer: state.anchorNode ?? document.body,
          }) as Range,
      }) as unknown as Selection,
  );
}

function firstTextNode(element: Element): Node {
  return element.firstChild ?? element;
}

describe("ReportOutputView", () => {
  it("renders a horizontal section preview strip without inline detail", () => {
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    expect(screen.getByTestId("report-output")).toBeDefined();
    expect(screen.getByTestId("report-section-strip")).toBeDefined();
    expect(screen.getByText("LLM Impact Radar Report")).toBeDefined();
    expect(screen.getAllByText("Providers checked").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("report-section-detail")).toBeNull();
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
    const animation = mockAnimationFrames();
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    const strip = screen.getByTestId("report-section-strip");
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 960 });

    fireEvent.wheel(strip, { deltaY: 180 });
    animation.flush();

    expect(strip.scrollLeft).toBe(360);
    expect(strip.className).not.toContain("snap");
    animation.restore();
  });

  it("keeps macOS trackpad wheel momentum from resetting the section scroll target", () => {
    const animation = mockAnimationFrames();
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    const strip = screen.getByTestId("report-section-strip");
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 960 });

    fireEvent.wheel(strip, { deltaY: 180 });
    strip.scrollLeft = 12;
    fireEvent.scroll(strip);
    fireEvent.wheel(strip, { deltaY: 10 });
    animation.flush();

    expect(strip.scrollLeft).toBe(380);
    animation.restore();
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

    const detail = screen.getByTestId("report-section-dialog");
    expect(within(detail).getByText("Summarisation Job Cost Impact")).toBeDefined();
    expect(within(detail).getByText("Cost movement")).toBeDefined();
    expect(within(detail).getByText("$42.00")).toBeDefined();
    expect(within(detail).getByText("$97.50")).toBeDefined();
    expect(within(detail).getByText("$55.50")).toBeDefined();
  });

  it("opens and closes the section modal", () => {
    render(<ReportOutputView report={REPORT} enablePixi={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Executive Summary/i }));
    const dialog = screen.getByTestId("report-section-dialog");
    expect(dialog).toBeDefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("report-section-dialog")).toBeNull();
  });

  it("keeps section chat inside the modal and sends questions with Enter", async () => {
    const onReportChat = vi.fn(async (request: ReportChatRequest) => {
      request.onDelta?.("It points at the fallback model.");
      return "It points at the fallback model.";
    });
    const selectionState: MockSelectionState = { text: "", anchorNode: null };
    const selectionSpy = mockWindowSelection(selectionState);

    render(
      <ReportChatProvider value={onReportChat}>
        <ReportOutputView report={REPORT} enablePixi={false} />
      </ReportChatProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Hardcoded DeepSeek/i }));
    const reportText = within(screen.getByTestId("report-section-content")).getByText(
      "The fallback chat path still uses deepseek-chat.",
    );
    selectionState.text = "deepseek-chat";
    selectionState.anchorNode = firstTextNode(reportText);
    fireEvent.mouseUp(screen.getByTestId("report-section-content"));
    const textarea = screen.getByLabelText("Question about report section");
    fireEvent.change(textarea, {
      target: { value: "Why does this matter?" },
    });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onReportChat).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onReportChat).toHaveBeenCalledTimes(1));
    const request = onReportChat.mock.calls[0]?.[0];
    if (!request) throw new Error("Expected report chat request");
    expect(request.message).toContain("Report: LLM Impact Radar Report");
    expect(request.message).toContain("Section: Hardcoded DeepSeek Chat Model");
    expect(request.message).toContain("Selected text:\ndeepseek-chat");
    expect(request.message).toContain("Question:\nWhy does this matter?");
    expect(request.threadKey).toContain("code-impact-chat-default");
    const chatLog = screen.getByTestId("report-section-chat-log");
    expect(within(chatLog).getByText("Why does this matter?")).toBeDefined();
    expect(within(chatLog).getByText("It points at the fallback model.")).toBeDefined();

    fireEvent.click(
      within(screen.getByTestId("report-section-dialog")).getByRole("button", { name: "Close" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Executive Summary/i }));
    expect(
      within(screen.getByTestId("report-section-chat-log")).queryByText("Why does this matter?"),
    ).toBeNull();

    fireEvent.click(
      within(screen.getByTestId("report-section-dialog")).getByRole("button", { name: "Close" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Hardcoded DeepSeek/i }));
    expect(
      within(screen.getByTestId("report-section-chat-log")).getByText("Why does this matter?"),
    ).toBeDefined();
    selectionSpy.mockRestore();
  });

  it("refines selected report text in the shared modal chat", async () => {
    const replacement = "Three provider references need review before release.";
    const onReportChat = vi.fn(async (request: ReportChatRequest) => {
      expect(request.message).toContain(
        "Selected report text:\nThree model references need review before release.",
      );
      expect(request.message).toContain("Return only the replacement text");
      expect(request.message).toContain("Edit request:\nMake this clearer");
      return replacement;
    });
    const selectionState: MockSelectionState = { text: "", anchorNode: null };
    const selectionSpy = mockWindowSelection(selectionState);

    render(
      <ReportChatProvider value={onReportChat}>
        <ReportOutputView report={REPORT} enablePixi={false} />
      </ReportChatProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Executive Summary/i }));
    fireEvent.click(screen.getByLabelText("Refine mode"));
    const textarea = screen.getByLabelText("Question about report section");
    fireEvent.change(textarea, { target: { value: "Make this clearer" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onReportChat).not.toHaveBeenCalled();

    const reportText = within(screen.getByTestId("report-section-content")).getByText(
      "Three model references need review before release.",
    );
    selectionState.text = "Three model references need review before release.";
    selectionState.anchorNode = firstTextNode(reportText);
    fireEvent.mouseUp(screen.getByTestId("report-section-content"));
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onReportChat).toHaveBeenCalledTimes(1));
    const content = screen.getByTestId("report-section-content");
    expect(within(content).getByText(replacement)).toBeDefined();
    expect(within(content).queryByText("Three model references need review before release.")).toBe(
      null,
    );
    const chatLog = screen.getByTestId("report-section-chat-log");
    expect(within(chatLog).getByText("Refine request")).toBeDefined();
    expect(within(chatLog).getByText("Refined text")).toBeDefined();
    expect(within(chatLog).getByText(replacement)).toBeDefined();

    selectionSpy.mockRestore();
  });

  it("captures chat quote selection without clearing the report selection", async () => {
    const onReportChat = vi.fn(async (request: ReportChatRequest) => {
      if (request.message.includes("Rewrite only the selected report text")) {
        return "the DeepSeek chat fallback";
      }
      if (request.message.includes("Question:\nFollow up")) {
        return "Second response";
      }
      request.onDelta?.("It points at the fallback model.");
      return "It points at the fallback model.";
    });
    const selectionState: MockSelectionState = { text: "", anchorNode: null };
    const selectionSpy = mockWindowSelection(selectionState);

    render(
      <ReportChatProvider value={onReportChat}>
        <ReportOutputView report={REPORT} enablePixi={false} />
      </ReportChatProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Hardcoded DeepSeek/i }));
    const reportText = within(screen.getByTestId("report-section-content")).getByText(
      "The fallback chat path still uses deepseek-chat.",
    );
    selectionState.text = "deepseek-chat";
    selectionState.anchorNode = firstTextNode(reportText);
    fireEvent.mouseUp(screen.getByTestId("report-section-content"));

    const textarea = screen.getByLabelText("Question about report section");
    fireEvent.change(textarea, { target: { value: "Why does this matter?" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onReportChat).toHaveBeenCalledTimes(1));
    const chatLog = screen.getByTestId("report-section-chat-log");
    const responseText = within(chatLog).getByText("It points at the fallback model.");
    selectionState.text = "It points at the fallback model.";
    selectionState.anchorNode = firstTextNode(responseText);
    fireEvent.mouseUp(chatLog);

    expect(screen.getByText("Selected excerpt")).toBeDefined();
    fireEvent.change(textarea, { target: { value: "Follow up" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onReportChat).toHaveBeenCalledTimes(2));
    const chatQuoteRequest = onReportChat.mock.calls[1]?.[0];
    if (!chatQuoteRequest) throw new Error("Expected chat quote request");
    expect(chatQuoteRequest.message).toContain("Selected text:\nIt points at the fallback model.");

    fireEvent.click(screen.getByLabelText("Refine mode"));
    fireEvent.change(textarea, { target: { value: "Use full wording" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onReportChat).toHaveBeenCalledTimes(3));
    const refineRequest = onReportChat.mock.calls[2]?.[0];
    if (!refineRequest) throw new Error("Expected refine request");
    expect(refineRequest.message).toContain("Selected report text:\ndeepseek-chat");

    selectionSpy.mockRestore();
  });

  it("ignores empty and cross-pane selections and clears selection explicitly", () => {
    const onReportChat = vi.fn(async () => "unused");
    const selectionState: MockSelectionState = { text: "", anchorNode: null };
    const selectionSpy = mockWindowSelection(selectionState);

    render(
      <ReportChatProvider value={onReportChat}>
        <ReportOutputView report={REPORT} enablePixi={false} />
      </ReportChatProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Executive Summary/i }));
    fireEvent.click(screen.getByLabelText("Refine mode"));
    const textarea = screen.getByLabelText("Question about report section");
    fireEvent.change(textarea, { target: { value: "Make this clearer" } });

    const reportText = within(screen.getByTestId("report-section-content")).getByText(
      "Three model references need review before release.",
    );
    selectionState.text = "Three model references need review before release.";
    selectionState.anchorNode = firstTextNode(reportText);
    selectionState.focusNode = firstTextNode(textarea);
    fireEvent.mouseUp(screen.getByTestId("report-section-content"));
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onReportChat).not.toHaveBeenCalled();
    expect(screen.queryByTestId("report-section-selected-text")).toBeNull();

    selectionState.text = "";
    selectionState.anchorNode = firstTextNode(reportText);
    selectionState.focusNode = firstTextNode(reportText);
    fireEvent.mouseUp(screen.getByTestId("report-section-content"));
    expect(screen.queryByTestId("report-section-selected-text")).toBeNull();

    selectionState.text = "Three model references need review before release.";
    fireEvent.keyUp(screen.getByTestId("report-section-content"), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(screen.getByText("Selected report text")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByTestId("report-section-selected-text")).toBeNull();

    fireEvent.touchEnd(screen.getByTestId("report-section-content"));
    expect(screen.getByText("Selected report text")).toBeDefined();

    fireEvent.click(
      within(screen.getByTestId("report-section-dialog")).getByRole("button", { name: "Close" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Hardcoded DeepSeek/i }));
    expect(screen.queryByTestId("report-section-selected-text")).toBeNull();

    selectionSpy.mockRestore();
  });

  it("does not apply generic report chat failures as refined text", async () => {
    const onReportChat = vi.fn(async () => "An internal error occurred.");
    const selectionState: MockSelectionState = { text: "", anchorNode: null };
    const selectionSpy = mockWindowSelection(selectionState);

    render(
      <ReportChatProvider value={onReportChat}>
        <ReportOutputView
          report={{
            ...REPORT,
            sections: [
              {
                ...REPORT.sections[0]!,
                content: "The SDK integration needs review before release.",
              },
            ],
          }}
          enablePixi={false}
        />
      </ReportChatProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Executive Summary/i }));
    fireEvent.click(screen.getByLabelText("Refine mode"));
    const reportText = within(screen.getByTestId("report-section-content")).getByText(
      "The SDK integration needs review before release.",
    );
    selectionState.text = "SDK";
    selectionState.anchorNode = firstTextNode(reportText);
    fireEvent.mouseUp(screen.getByTestId("report-section-content"));
    const textarea = screen.getByLabelText("Question about report section");
    fireEvent.change(textarea, { target: { value: "use full spell" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onReportChat).toHaveBeenCalledTimes(1));
    const content = screen.getByTestId("report-section-content");
    expect(
      within(content).getByText("The SDK integration needs review before release."),
    ).toBeDefined();
    const chatLog = screen.getByTestId("report-section-chat-log");
    expect(within(chatLog).getByText("Error")).toBeDefined();
    expect(within(chatLog).getByText("An internal error occurred.")).toBeDefined();

    selectionSpy.mockRestore();
  });
});
