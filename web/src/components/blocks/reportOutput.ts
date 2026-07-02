export const REPORT_OUTPUT_MARKER = "<!-- REPORT -->";

export type ReportSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ReportMetric {
  label: string;
  value: string;
}

export interface ReportPricing {
  input_per_1m?: number;
  cached_input_per_1m?: number;
  output_per_1m?: number;
  currency?: string;
  promo?: boolean;
  note?: string;
}

export interface ReportSection {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: ReportSeverity;
  data: Record<string, unknown>;
  citations?: {
    sources?: string[];
    evidence?: string[];
  };
  editable?: string[];
  provenance?: string;
}

export interface ReportOutput {
  report_version: number;
  run_id: string;
  generated_at: string;
  title: string;
  target?: {
    name?: string;
    path?: string;
  };
  providers: string[];
  sections: ReportSection[];
}

const SEVERITIES = new Set<ReportSeverity>(["critical", "high", "medium", "low", "info"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSeverity(value: unknown): ReportSeverity {
  if (typeof value === "string" && SEVERITIES.has(value as ReportSeverity)) {
    return value as ReportSeverity;
  }
  return "info";
}

function stripOptionalJsonFence(payload: string): string {
  const trimmed = payload.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function reportPayloadText(text: string): string | null {
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith(REPORT_OUTPUT_MARKER)) return null;
  return stripOptionalJsonFence(trimmedStart.slice(REPORT_OUTPUT_MARKER.length));
}

export function isReportOutputText(text: string): boolean {
  return reportPayloadText(text) !== null;
}

export function parseReportOutput(text: string): ReportOutput | null {
  const payload = reportPayloadText(text);
  if (payload === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const title = asString(parsed.title);
  const runId = asString(parsed.run_id);
  const generatedAt = asString(parsed.generated_at);
  const reportVersion = typeof parsed.report_version === "number" ? parsed.report_version : null;
  if (!title || !runId || !generatedAt || reportVersion === null) return null;
  if (!Array.isArray(parsed.sections)) return null;

  const sections: ReportSection[] = [];
  for (const section of parsed.sections) {
    if (!isRecord(section)) continue;
    const id = asString(section.id);
    const type = asString(section.type);
    const sectionTitle = asString(section.title);
    const content = asString(section.content);
    if (!id || !type || !sectionTitle || content === null) continue;

    sections.push({
      id,
      type,
      title: sectionTitle,
      content,
      severity: normalizeSeverity(section.severity),
      data: isRecord(section.data) ? section.data : {},
      ...(isRecord(section.citations)
        ? {
            citations: {
              sources: asStringArray(section.citations.sources),
              evidence: asStringArray(section.citations.evidence),
            },
          }
        : {}),
      editable: asStringArray(section.editable),
      provenance: asString(section.provenance) ?? undefined,
    });
  }

  if (sections.length === 0) return null;

  return {
    report_version: reportVersion,
    run_id: runId,
    generated_at: generatedAt,
    title,
    target: isRecord(parsed.target)
      ? {
          name: asString(parsed.target.name) ?? undefined,
          path: asString(parsed.target.path) ?? undefined,
        }
      : undefined,
    providers: asStringArray(parsed.providers),
    sections,
  };
}

export function containsReportOutput(items: readonly { kind: string; text?: string }[]): boolean {
  return items.some((item) => item.kind === "text" && !!item.text && isReportOutputText(item.text));
}
