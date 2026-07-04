import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { generateReportPptxBlob, reportPptxFilename } from "./reportPptxExport";
import type { ReportOutput } from "./reportOutput";

const REPORT: ReportOutput = {
  report_version: 1,
  run_id: "run-2026-07-04",
  generated_at: "2026-07-04T09:15:00Z",
  title: "LLM Impact Radar Report",
  target: { name: "Example Project" },
  providers: ["openai", "gemini"],
  sections: [
    {
      id: "summary",
      type: "executive_summary",
      title: "Executive Summary",
      content: "The report highlights policy, streaming, and cost routing risk.",
      severity: "high",
      data: {
        metrics: [{ label: "Providers checked", value: "2" }],
      },
      citations: { sources: ["pricing.md"], evidence: ["streaming.ts"] },
    },
    {
      id: "cost",
      type: "cost_impact",
      title: "Cost Routing",
      content: "Cost advice must stay read-only.",
      severity: "medium",
      data: { provider: "openai", model: "gpt-5" },
    },
  ],
};

describe("reportPptxExport", () => {
  it("generates a valid PPTX package with selected report slides", async () => {
    const blob = await generateReportPptxBlob(REPORT, REPORT.sections);
    const entries = readZipEntries(await blob.arrayBuffer());

    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(entries.get("[Content_Types].xml")).toContain("presentationml.presentation.main+xml");
    expect(entries.get("ppt/presentation.xml")).toContain('<p:sldId id="256" r:id="rId2"/>');
    expect(entries.get("ppt/slides/slide1.xml")).toContain("LLM Impact Radar Report");
    expect(entries.get("ppt/slides/slide2.xml")).toContain("Report overview");
    expect(entries.get("ppt/slides/slide3.xml")).toContain("Executive Summary");
    expect(entries.get("ppt/slides/slide3.xml")).toContain("Providers checked: 2");
    expect(entries.get("ppt/slides/slide3.xml")).toContain("Sources: pricing.md");
    expect(entries.get("ppt/slides/slide4.xml")).toContain("Cost Routing");
    expect(entries.get("ppt/slides/_rels/slide4.xml.rels")).toContain("slideLayout");
    for (const [name, content] of entries) {
      if (name.endsWith(".xml") || name.endsWith(".rels")) {
        const parsed = new DOMParser().parseFromString(content, "application/xml");
        expect(parsed.querySelector("parsererror")?.textContent ?? "").toBe("");
      }
    }
  });

  it("uses a report title based filename", () => {
    expect(reportPptxFilename(REPORT)).toBe("llm-impact-radar-report-2026-07-04.pptx");
  });
});

function readZipEntries(buffer: ArrayBuffer): Map<string, string> {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  const endRecordOffset = findZipEndRecord(view);
  const entryCount = view.getUint16(endRecordOffset + 10, true);
  let offset = view.getUint32(endRecordOffset + 16, true);

  for (let index = 0; index < entryCount; index += 1) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = decoder.decode(data.slice(nameStart, nameStart + nameLength));

    expect(view.getUint32(localHeaderOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.slice(dataStart, dataStart + compressedSize);
    const contentBytes =
      compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : null;
    expect(contentBytes).not.toBeNull();
    const content = decoder.decode(contentBytes!);
    entries.set(name, content);
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findZipEndRecord(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("Could not find ZIP end record");
}
