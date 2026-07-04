import { describe, expect, it } from "vitest";
import {
  LEGACY_REPORT_OUTPUT_MARKER,
  REPORT_OUTPUT_END_MARKER,
  REPORT_OUTPUT_MARKER,
  containsReportOutput,
  parseReportOutput,
  parseReportOutputState,
} from "./reportOutput";

const validReport = {
  report_version: 1,
  run_id: "example-2026-07-02T0900Z",
  generated_at: "2026-07-02T09:00:00Z",
  title: "LLM Impact Radar Report - Example Project",
  target: { name: "Example Project", path: "/projects/example-project" },
  providers: ["openai", "gemini"],
  sections: [
    {
      id: "summary-main",
      type: "executive_summary",
      title: "Executive Summary",
      content: "The project has three model references.",
      severity: "high",
      data: { metrics: [{ label: "Providers checked", value: "2" }] },
      editable: ["title", "content", "data"],
      provenance: "generated",
    },
    {
      id: "cost-gemini-summary-job",
      type: "cost_impact",
      title: "Summarisation Job Cost Impact",
      content: "Moving the summarisation job increases monthly cost.",
      severity: "medium",
      data: { old: { input: 18, output: 24 }, new: { input: 31.5, output: 66 } },
    },
  ],
};

describe("report output parsing", () => {
  it("parses a marked report JSON payload", () => {
    const report = parseReportOutput(`${REPORT_OUTPUT_MARKER}\n${JSON.stringify(validReport)}`);

    expect(report?.title).toBe("LLM Impact Radar Report - Example Project");
    expect(report?.target?.path).toBe("/projects/example-project");
    expect(report?.providers).toEqual(["openai", "gemini"]);
    expect(report?.sections).toHaveLength(2);
    expect(report?.sections[0]).toMatchObject({
      id: "summary-main",
      severity: "high",
    });
  });

  it("accepts an optional json fence after the marker", () => {
    const report = parseReportOutput(
      `${REPORT_OUTPUT_MARKER}\n\`\`\`json\n${JSON.stringify(validReport)}\n\`\`\``,
    );

    expect(report?.sections[1]?.type).toBe("cost_impact");
  });

  it("parses when the whole report block is fenced", () => {
    const report = parseReportOutput(
      `\`\`\`json\n${REPORT_OUTPUT_MARKER}\n${JSON.stringify(validReport)}\n\`\`\``,
    );

    expect(report?.title).toBe("LLM Impact Radar Report - Example Project");
  });

  it("parses a report with surrounding prose after the marker", () => {
    const report = parseReportOutput(
      `Report generated below.\n\n${REPORT_OUTPUT_MARKER}\n${JSON.stringify(validReport)}\n\nDone.`,
    );

    expect(report?.run_id).toBe("example-2026-07-02T0900Z");
  });

  it("stops parsing at the visible end marker", () => {
    const report = parseReportOutput(
      `${REPORT_OUTPUT_MARKER}\n${JSON.stringify(validReport)}\n${REPORT_OUTPUT_END_MARKER}\nIgnored text.`,
    );

    expect(report?.title).toBe("LLM Impact Radar Report - Example Project");
  });

  it("accepts an inline marker before the json payload", () => {
    const report = parseReportOutput(
      `${REPORT_OUTPUT_MARKER} ${JSON.stringify(validReport)} ${REPORT_OUTPUT_END_MARKER}`,
    );

    expect(report?.run_id).toBe("example-2026-07-02T0900Z");
  });

  it("accepts an inline report block after leading prose", () => {
    const report = parseReportOutput(
      `Here is the report: ${REPORT_OUTPUT_MARKER} ${JSON.stringify(validReport)} ${REPORT_OUTPUT_END_MARKER}`,
    );

    expect(report?.title).toBe("LLM Impact Radar Report - Example Project");
  });

  it("accepts an inline report block after punctuation without spacing", () => {
    const report = parseReportOutput(
      `chatter.${REPORT_OUTPUT_MARKER} ${JSON.stringify(validReport)} ${REPORT_OUTPUT_END_MARKER}`,
    );

    expect(report?.title).toBe("LLM Impact Radar Report - Example Project");
  });

  it("accepts an inline report block after any text without spacing", () => {
    const report = parseReportOutput(
      `chatter${REPORT_OUTPUT_MARKER} ${JSON.stringify(validReport)} ${REPORT_OUTPUT_END_MARKER}`,
    );

    expect(report?.title).toBe("LLM Impact Radar Report - Example Project");
  });

  it("does not treat the end marker as a report start", () => {
    expect(parseReportOutput(`${REPORT_OUTPUT_END_MARKER} ${JSON.stringify(validReport)}`)).toBeNull();
  });

  it("keeps accepting the legacy html comment marker", () => {
    const report = parseReportOutput(
      `${LEGACY_REPORT_OUTPUT_MARKER}\n${JSON.stringify(validReport)}`,
    );

    expect(report?.sections).toHaveLength(2);
  });

  it("falls back to normal markdown when the marker or schema is missing", () => {
    expect(parseReportOutput(JSON.stringify(validReport))).toBeNull();
    expect(parseReportOutput(`${REPORT_OUTPUT_MARKER}\n{"title":"Missing sections"}`)).toBeNull();
  });

  it("returns a partial report state with complete sections from a streaming payload", () => {
    const completeSection = validReport.sections[0]!;
    const incomingSection = validReport.sections[1]!;
    const text = `${REPORT_OUTPUT_MARKER}
{
  "report_version": 1,
  "run_id": "streaming-run",
  "generated_at": "2026-07-02T09:00:00Z",
  "title": "Streaming Report",
  "target": { "name": "Example Project" },
  "providers": ["openai", "gemini"],
  "sections": [
    ${JSON.stringify(completeSection)},
    ${JSON.stringify(incomingSection).slice(0, 80)}`;

    const state = parseReportOutputState(text);

    expect(state?.complete).toBe(false);
    expect(state?.report.title).toBe("Streaming Report");
    expect(state?.report.target?.name).toBe("Example Project");
    expect(state?.report.providers).toEqual(["openai", "gemini"]);
    expect(state?.report.sections).toHaveLength(1);
    expect(state?.report.sections[0]?.title).toBe("Executive Summary");
  });

  it("returns an empty streaming shell once the report marker is present", () => {
    const state = parseReportOutputState(`${REPORT_OUTPUT_MARKER}\n{`);

    expect(state?.complete).toBe(false);
    expect(state?.report.title).toBe("Generating report");
    expect(state?.report.sections).toEqual([]);
  });

  it("detects report text inside render items", () => {
    expect(
      containsReportOutput([
        { kind: "text", text: "ordinary text" },
        { kind: "text", text: `${REPORT_OUTPUT_MARKER}\n${JSON.stringify(validReport)}` },
      ]),
    ).toBe(true);
  });
});
