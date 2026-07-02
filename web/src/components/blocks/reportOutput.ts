export const REPORT_OUTPUT_MARKER = "REPORT_OUTPUT";
export const REPORT_OUTPUT_END_MARKER = "END_REPORT_OUTPUT";
export const LEGACY_REPORT_OUTPUT_MARKER = "<!-- REPORT -->";

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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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

function extractJsonObject(payload: string): string | null {
  const start = payload.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < payload.length; index += 1) {
    const char = payload[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return payload.slice(start, index + 1);
    }
  }

  return null;
}

export function reportPayloadText(text: string): string | null {
  const marker = findReportMarker(text);
  if (!marker) return null;

  const endIndex = text.indexOf(REPORT_OUTPUT_END_MARKER, marker.end);
  const rawPayload = endIndex < 0 ? text.slice(marker.end) : text.slice(marker.end, endIndex);
  const payload = stripOptionalJsonFence(rawPayload);
  return extractJsonObject(payload) ?? payload;
}

function findReportMarker(text: string): { end: number } | null {
  const visibleMatch = /(^|\n)\s*REPORT_OUTPUT\s*(?:\n|$)/.exec(text);
  const legacyIndex = text.indexOf(LEGACY_REPORT_OUTPUT_MARKER);

  if (visibleMatch && (legacyIndex < 0 || visibleMatch.index <= legacyIndex)) {
    return { end: visibleMatch.index + visibleMatch[0].length };
  }

  if (legacyIndex >= 0) {
    return { end: legacyIndex + LEGACY_REPORT_OUTPUT_MARKER.length };
  }

  return null;
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
