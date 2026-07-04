import pptxgen from "pptxgenjs";
import type { ReportOutput, ReportSection, ReportSeverity } from "./reportOutput";

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SLIDE_WIDTH = 13.333;
const BODY_FONT = "Aptos";
const TITLE_FONT = "Aptos Display";
const MAX_BODY_LINES = 10;
const MAX_DETAIL_LINES = 7;

const SEVERITY_COLOR: Record<ReportSeverity, string> = {
  critical: "DC2626",
  high: "EA580C",
  medium: "CA8A04",
  low: "2563EB",
  info: "64748B",
};

type PptxSlide = {
  title: string;
  eyebrow?: string;
  body: string[];
  details?: string[];
  accentColor: string;
};

type PptxInstance = InstanceType<typeof pptxgen>;

export function reportPptxFilename(report: ReportOutput): string {
  const title = cleanReportText(report.title, "report");
  const generated = cleanReportText(report.generated_at).slice(0, 10);
  const suffix = generated && /^\d{4}-\d{2}-\d{2}$/.test(generated) ? `-${generated}` : "";
  return `${slugify(title)}${suffix}.pptx`;
}

export async function generateReportPptxBlob(
  report: ReportOutput,
  sections: ReportSection[],
): Promise<Blob> {
  if (sections.length === 0) {
    throw new Error("Select at least one section before exporting.");
  }

  const slides = buildReportSlides(report, sections);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "";
  pptx.company = "";
  pptx.subject = cleanReportText(report.target?.name ?? report.target?.path ?? "Report export");
  pptx.title = cleanReportText(report.title, "Report");
  pptx.theme = {
    headFontFace: TITLE_FONT,
    bodyFontFace: BODY_FONT,
  };

  slides.forEach((slide, index) => addReportSlide(pptx, slide, index + 1));
  return pptxToBlob(pptx);
}

export async function triggerReportPptxDownload(
  report: ReportOutput,
  sections: ReportSection[],
): Promise<void> {
  const blob = await generateReportPptxBlob(report, sections);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportPptxFilename(report);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildReportSlides(report: ReportOutput, sections: ReportSection[]): PptxSlide[] {
  const title = cleanReportText(report.title, "Report");
  const target = cleanReportText(report.target?.name ?? report.target?.path ?? "Report target");
  const generatedAt = cleanReportText(formatGeneratedAt(report.generated_at));
  const providers = report.providers.map((provider) => cleanReportText(provider)).filter(Boolean);
  const counts = severityCounts(sections);

  return [
    {
      title,
      eyebrow: "Report export",
      body: [
        target,
        generatedAt,
        `${sections.length} selected sections`,
        providers.length > 0 ? `Providers: ${providers.join(", ")}` : "Providers: none listed",
        `Run: ${cleanReportText(report.run_id)}`,
      ],
      accentColor: "7C3AED",
    },
    {
      title: "Report overview",
      eyebrow: "Severity distribution",
      body: [
        ...(["critical", "high", "medium", "low", "info"] as ReportSeverity[]).map(
          (severity) => `${severityLabel(severity)}: ${counts[severity]}`,
        ),
        "",
        "Selected section order:",
        ...sections.map((section, index) => `${index + 1}. ${cleanReportText(section.title)}`),
      ],
      accentColor: "2563EB",
    },
    ...sections.map((section) => sectionSlide(section)),
  ];
}

function sectionSlide(section: ReportSection): PptxSlide {
  const body = splitContentLines(section.content).slice(0, MAX_BODY_LINES);
  const details = [
    `Severity: ${severityLabel(section.severity)}`,
    `Type: ${sectionTypeLabel(section.type)}`,
    ...sectionDataLines(section).slice(0, MAX_DETAIL_LINES),
    ...citationLines(section),
  ];
  if (section.provenance) details.push(`Provenance: ${cleanReportText(section.provenance)}`);

  return {
    title: cleanReportText(section.title, "Untitled section"),
    eyebrow: sectionTypeLabel(section.type),
    body,
    details,
    accentColor: SEVERITY_COLOR[section.severity],
  };
}

function addReportSlide(pptx: PptxInstance, slideContent: PptxSlide, index: number): void {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: 0.22,
    fill: { color: slideContent.accentColor },
    line: { color: slideContent.accentColor, transparency: 100 },
  });
  slide.addText(cleanReportText(slideContent.eyebrow ?? "Report"), {
    x: 0.72,
    y: 0.48,
    w: 11.9,
    h: 0.35,
    margin: 0,
    color: slideContent.accentColor,
    fontFace: BODY_FONT,
    fontSize: 12,
    bold: true,
    fit: "shrink",
  });
  slide.addText(cleanReportText(slideContent.title, "Report slide"), {
    x: 0.72,
    y: 0.86,
    w: 11.9,
    h: 0.9,
    margin: 0,
    color: "0F172A",
    fontFace: TITLE_FONT,
    fontSize: 27,
    bold: true,
    fit: "shrink",
  });
  slide.addText(slideContent.body.map((line) => cleanReportText(line)).join("\n"), {
    x: 0.78,
    y: 1.9,
    w: 7.55,
    h: 4.75,
    margin: 0,
    color: "1E293B",
    fontFace: BODY_FONT,
    fontSize: 13,
    breakLine: false,
    fit: "shrink",
    valign: "top",
  });
  slide.addText((slideContent.details ?? []).map((line) => cleanReportText(line)).join("\n"), {
    x: 8.72,
    y: 1.94,
    w: 3.75,
    h: 4.55,
    margin: 8,
    color: "334155",
    fontFace: BODY_FONT,
    fontSize: 10.5,
    fit: "shrink",
    valign: "top",
    fill: { color: "F8FAFC" },
    line: { color: "E2E8F0", width: 1 },
  });
  slide.addText(`Slide ${index}`, {
    x: 0.72,
    y: 6.82,
    w: 11.9,
    h: 0.25,
    margin: 0,
    color: "94A3B8",
    fontFace: BODY_FONT,
    fontSize: 8,
  });
  slide.addNotes([...slideContent.body, "", ...(slideContent.details ?? [])].join("\n"));
}

async function pptxToBlob(pptx: PptxInstance): Promise<Blob> {
  const output = await pptx.write({ outputType: "blob", compression: true });
  if (output instanceof Blob) {
    return output.type === PPTX_MIME_TYPE ? output : new Blob([output], { type: PPTX_MIME_TYPE });
  }
  if (output instanceof ArrayBuffer) {
    return new Blob([output], { type: PPTX_MIME_TYPE });
  }
  if (output instanceof Uint8Array) {
    return new Blob([arrayBufferFromBytes(output)], { type: PPTX_MIME_TYPE });
  }
  if (typeof output === "string") {
    return new Blob([output], { type: PPTX_MIME_TYPE });
  }
  throw new Error("The PPTX export returned an unsupported file type.");
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function sectionDataLines(section: ReportSection): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(section.data)) {
    if (key === "metrics" && Array.isArray(value)) {
      for (const metric of value) {
        if (
          isRecord(metric) &&
          typeof metric.label === "string" &&
          typeof metric.value === "string"
        ) {
          lines.push(`${metric.label}: ${metric.value}`);
        }
      }
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      lines.push(`${sectionTypeLabel(key)}: ${String(value)}`);
    }
  }
  return lines;
}

function citationLines(section: ReportSection): string[] {
  const sources = section.citations?.sources ?? [];
  const evidence = section.citations?.evidence ?? [];
  return [
    ...(sources.length > 0
      ? [`Sources: ${sources.map((item) => cleanReportText(item)).join(", ")}`]
      : []),
    ...(evidence.length > 0
      ? [`Evidence: ${evidence.map((item) => cleanReportText(item)).join(", ")}`]
      : []),
  ];
}

function splitContentLines(content: string): string[] {
  const lines = cleanReportText(content)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 0) return lines;
  return ["No section content was provided."];
}

function severityCounts(sections: ReportSection[]): Record<ReportSeverity, number> {
  return sections.reduce(
    (counts, section) => {
      counts[section.severity] += 1;
      return counts;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  );
}

function cleanReportText(value: string | null | undefined, fallback = ""): string {
  const cleaned = (value ?? "")
    .replace(/\bConduct\s+Omnigent\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function sectionTypeLabel(type: string): string {
  return cleanReportText(type.replaceAll("_", " ")).replace(/\b\w/g, (char) => char.toUpperCase());
}

function severityLabel(severity: ReportSeverity): string {
  return severity[0]!.toUpperCase() + severity.slice(1);
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "report";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
