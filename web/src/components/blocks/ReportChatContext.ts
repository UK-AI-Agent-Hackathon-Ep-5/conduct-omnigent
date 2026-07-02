import { createContext, useContext } from "react";
import type { ReportOutput, ReportSection } from "./reportOutput";

export interface ReportChatRequest {
  threadKey: string;
  title: string;
  message: string;
  onDelta?: (text: string) => void;
}

export type ReportChatHandler = (request: ReportChatRequest) => Promise<string>;

const ReportChatContext = createContext<ReportChatHandler | null>(null);

export const ReportChatProvider = ReportChatContext.Provider;

export function useReportChat(): ReportChatHandler | null {
  return useContext(ReportChatContext);
}

export function buildReportSectionQuote(report: ReportOutput, section: ReportSection): string {
  return [
    `Report: ${report.title}`,
    report.target?.name ? `Target: ${report.target.name}` : null,
    `Section: ${section.title}`,
    `Type: ${section.type}`,
    `Severity: ${section.severity}`,
    "",
    section.content,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
