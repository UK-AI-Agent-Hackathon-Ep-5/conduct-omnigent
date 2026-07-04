import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  MessageSquareTextIcon,
  PenLineIcon,
  QuoteIcon,
  SendHorizontalIcon,
  SparklesIcon,
  TargetIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildReportSectionQuote,
  useReportChat,
  type ReportChatHandler,
} from "./ReportChatContext";
import type { ReportOutput, ReportPricing, ReportSection, ReportSeverity } from "./reportOutput";

const SEVERITY_ORDER: ReportSeverity[] = ["critical", "high", "medium", "low", "info"];
const SECTION_WHEEL_SCROLL_SPEED = 2;
const SECTION_WHEEL_LINE_HEIGHT = 40;
const SECTION_WHEEL_ANIMATION_MS = 180;
const SECTION_BUTTON_SCROLL_STEP = 520;
const REPORT_SECTION_EDITS_STORAGE_PREFIX = "omnigent.reportSectionEdits";
const REPORT_SECTION_ORDER_STORAGE_PREFIX = "omnigent.reportSectionOrder";

const SEVERITY_STYLE: Record<
  ReportSeverity,
  {
    label: string;
    pill: string;
    border: string;
    bar: string;
    text: string;
    color: string;
  }
> = {
  critical: {
    label: "Critical",
    pill: "border-destructive/35 bg-destructive/10 text-destructive",
    border: "border-destructive/50",
    bar: "bg-destructive",
    text: "text-destructive",
    color: "var(--destructive)",
  },
  high: {
    label: "High",
    pill: "border-orange-500/35 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    border: "border-orange-500/50",
    bar: "bg-orange-500",
    text: "text-orange-700 dark:text-orange-300",
    color: "#f97316",
  },
  medium: {
    label: "Medium",
    pill: "border-warning/35 bg-warning/10 text-warning",
    border: "border-warning/50",
    bar: "bg-warning",
    text: "text-warning",
    color: "var(--warning)",
  },
  low: {
    label: "Low",
    pill: "border-status-blue/35 bg-status-blue/10 text-status-blue",
    border: "border-status-blue/50",
    bar: "bg-status-blue",
    text: "text-status-blue",
    color: "var(--status-blue)",
  },
  info: {
    label: "Info",
    pill: "border-status-gray/35 bg-status-gray/10 text-muted-foreground",
    border: "border-border",
    bar: "bg-status-gray",
    text: "text-muted-foreground",
    color: "var(--status-gray)",
  },
};

const REPORT_SHELL_STYLE = {
  backgroundImage:
    "radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--brand-accent) 18%, transparent) 0, transparent 34%), radial-gradient(circle at 96% 10%, color-mix(in srgb, var(--status-blue) 13%, transparent) 0, transparent 32%)",
} satisfies CSSProperties;

const REPORT_BRAND_PATTERN = /\bConduct\s+Omnigent\b/gi;

type ReportDialogMode = "chat" | "refine";

type ReportTextSelection = {
  text: string;
  source: "report" | "chat";
};

type RefineHighlight = {
  text: string;
  state: "refining" | "updated";
};

type ReportDialogMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  quote: string | null;
  mode?: ReportDialogMode;
  status?: "sending" | "streaming" | "done" | "error";
};

type ReportDialogMessagePatch = Partial<Pick<ReportDialogMessage, "content" | "status">>;

interface ReportOutputViewProps {
  report: ReportOutput;
  enablePixi?: boolean;
  isStreaming?: boolean;
}

export function ReportOutputView({ report, isStreaming = false }: ReportOutputViewProps) {
  const [activeId, setActiveId] = useState(report.sections[0]?.id ?? "");
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [chatHistories, setChatHistories] = useState<Record<string, ReportDialogMessage[]>>({});
  const reportEditStorageKey = useMemo(() => reportSectionEditStorageKey(report), [report]);
  const reportOrderStorageKey = useMemo(() => reportSectionOrderStorageKey(report), [report]);
  const reportSectionIds = useMemo(
    () => report.sections.map((section) => section.id),
    [report.sections],
  );
  const [sectionContentEdits, setSectionContentEdits] = useState<Record<string, string>>(() =>
    readReportSectionEdits(reportEditStorageKey),
  );
  const [sectionOrder, setSectionOrder] = useState<string[]>(() =>
    mergeSectionOrder(readReportSectionOrder(reportOrderStorageKey), report.sections),
  );
  const [draftSectionOrder, setDraftSectionOrder] = useState<string[]>(() =>
    mergeSectionOrder(readReportSectionOrder(reportOrderStorageKey), report.sections),
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chatMessageIdRef = useRef(0);
  const reportChat = useReportChat();

  const editedSections = useMemo(
    () =>
      report.sections.map((section) =>
        sectionContentEdits[section.id] !== undefined
          ? { ...section, content: sectionContentEdits[section.id]! }
          : section,
      ),
    [report.sections, sectionContentEdits],
  );
  const sections = useMemo(
    () => orderReportSections(editedSections, sectionOrder),
    [editedSections, sectionOrder],
  );
  const exportDraftSections = useMemo(
    () => orderReportSections(editedSections, draftSectionOrder),
    [editedSections, draftSectionOrder],
  );
  const activeSection = sections.find((section) => section.id === activeId) ?? sections[0] ?? null;
  const counts = useMemo(() => severityCounts(sections), [sections]);
  const totalFindings = sections.filter((section) => section.type !== "source").length;
  const reportTitle = cleanReportText(report.title, "Report");
  const rawTargetLabel = report.target?.name ?? report.target?.path ?? "Report target";
  const targetLabel = cleanReportText(rawTargetLabel, "Report target");
  const generatedLabel = formatGeneratedAt(report.generated_at);

  useEffect(() => {
    setSectionContentEdits(readReportSectionEdits(reportEditStorageKey));
  }, [reportEditStorageKey]);

  useEffect(() => {
    const storedOrder = readReportSectionOrder(reportOrderStorageKey);
    setSectionOrder((prev) =>
      mergeSectionOrder(storedOrder.length > 0 ? storedOrder : prev, report.sections),
    );
    setDraftSectionOrder((prev) =>
      mergeSectionOrder(storedOrder.length > 0 ? storedOrder : prev, report.sections),
    );
  }, [report.sections, reportOrderStorageKey]);

  useEffect(() => {
    const currentScroller = scrollerRef.current;
    if (!currentScroller) return;
    const scroller: HTMLDivElement = currentScroller;
    let targetScrollLeft = scroller.scrollLeft;
    let animationFrame: number | null = null;
    let animationStart = 0;
    let animationFrom = scroller.scrollLeft;

    function animateTo(left: number) {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationStart = window.performance.now();
      animationFrom = scroller.scrollLeft;

      const step = (timestamp: number) => {
        const elapsed = timestamp - animationStart;
        const progress = Math.min(Math.max(elapsed / SECTION_WHEEL_ANIMATION_MS, 0), 1);
        const eased = 1 - (1 - progress) ** 3;
        scroller.scrollLeft = animationFrom + (left - animationFrom) * eased;
        if (progress < 1) {
          animationFrame = window.requestAnimationFrame(step);
          return;
        }
        animationFrame = null;
        targetScrollLeft = scroller.scrollLeft;
      };

      animationFrame = window.requestAnimationFrame(step);
    }

    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey) return;
      const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
      if (maxScrollLeft <= 0) return;

      const dominantDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (dominantDelta === 0) return;

      let scaledDelta = dominantDelta;
      if (event.deltaMode === 1) scaledDelta = dominantDelta * SECTION_WHEEL_LINE_HEIGHT;
      if (event.deltaMode === 2) scaledDelta = dominantDelta * scroller.clientWidth;
      scaledDelta *= SECTION_WHEEL_SCROLL_SPEED;
      targetScrollLeft = Math.min(Math.max(targetScrollLeft, 0), maxScrollLeft);
      const nextScrollLeft = Math.min(Math.max(targetScrollLeft + scaledDelta, 0), maxScrollLeft);

      if (nextScrollLeft === targetScrollLeft) return;
      event.preventDefault();
      targetScrollLeft = nextScrollLeft;
      animateTo(nextScrollLeft);
    }

    function syncTarget() {
      if (animationFrame !== null) return;
      targetScrollLeft = scroller.scrollLeft;
    }

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    scroller.addEventListener("scroll", syncTarget, { passive: true });
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("scroll", syncTarget);
    };
  }, []);

  function scrollSections(direction: -1 | 1) {
    scrollerRef.current?.scrollBy({
      left: direction * SECTION_BUTTON_SCROLL_STEP,
      behavior: "smooth",
    });
  }

  function openSection(sectionId: string) {
    setActiveId(sectionId);
    setDetailOpen(true);
  }

  function openExportDialog() {
    setDraftSectionOrder(mergeSectionOrder(sectionOrder, report.sections));
    setExportDialogOpen(true);
  }

  function reorderDraftSections(sourceId: string, targetId: string) {
    setDraftSectionOrder((prev) =>
      reorderSectionBeforeTarget(mergeSectionOrder(prev, report.sections), sourceId, targetId),
    );
  }

  function moveDraftSection(sectionId: string, direction: -1 | 1) {
    setDraftSectionOrder((prev) =>
      moveSectionInOrder(mergeSectionOrder(prev, report.sections), sectionId, direction),
    );
  }

  function resetDraftSectionOrder() {
    setDraftSectionOrder(reportSectionIds);
  }

  function applyDraftSectionOrder() {
    const nextOrder = mergeSectionOrder(draftSectionOrder, report.sections);
    setSectionOrder(nextOrder);
    writeReportSectionOrder(reportOrderStorageKey, nextOrder);
    setExportDialogOpen(false);
  }

  function nextChatMessageId(sectionId: string): string {
    chatMessageIdRef.current += 1;
    return `${sectionId}-${chatMessageIdRef.current}`;
  }

  function appendChatMessages(sectionId: string, messages: ReportDialogMessage[]) {
    setChatHistories((prev) => ({
      ...prev,
      [sectionId]: [...(prev[sectionId] ?? []), ...messages],
    }));
  }

  function updateChatMessage(
    sectionId: string,
    messageId: string,
    patch: ReportDialogMessagePatch,
  ) {
    setChatHistories((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] ?? []).map((message) =>
        message.id === messageId ? { ...message, ...patch } : message,
      ),
    }));
  }

  function replaceSectionText(sectionId: string, selectedText: string, replacementText: string) {
    setSectionContentEdits((prev) => {
      const originalSection = report.sections.find((section) => section.id === sectionId);
      const currentContent = prev[sectionId] ?? originalSection?.content ?? "";
      const nextContent = replaceSelectedReportText(currentContent, selectedText, replacementText);
      if (nextContent === cleanReportText(currentContent)) return prev;
      const next = { ...prev, [sectionId]: nextContent };
      writeReportSectionEdits(reportEditStorageKey, next);
      return next;
    });
  }

  return (
    <section
      data-testid="report-output"
      className="relative overflow-hidden rounded-xl border border-border/80 bg-card/95 text-foreground shadow-[0_18px_60px_rgba(30,13,21,0.12)] backdrop-blur dark:shadow-[0_20px_80px_rgba(0,0,0,0.36)]"
      style={REPORT_SHELL_STYLE}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/70 to-transparent"
      />
      <header className="relative grid gap-5 border-border/70 border-b p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-accent/25 bg-brand-accent/10 px-2.5 py-1 font-medium text-brand-accent text-xs">
                {isStreaming ? (
                  <ActivityIcon className="size-3.5 motion-safe:animate-pulse" />
                ) : (
                  <BarChart3Icon className="size-3.5" />
                )}
                {isStreaming ? "Generating report" : "Report"}
              </span>
              <span className="rounded-full border border-border/70 bg-background/50 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                {report.run_id}
              </span>
            </div>
            <Button type="button" size="sm" className="shrink-0" onClick={openExportDialog}>
              <DownloadIcon className="size-4" />
              Export PPTX
            </Button>
          </div>

          <div className="space-y-2">
            <h3 className="text-balance text-2xl font-semibold leading-tight tracking-normal">
              {reportTitle}
            </h3>
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
              <TargetIcon className="size-4 shrink-0 text-brand-accent" />
              <span className="truncate">{targetLabel}</span>
              <span className="hidden text-border-strong sm:inline">/</span>
              <span className="hidden shrink-0 sm:inline">{generatedLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {report.providers.map((provider) => (
              <span
                key={provider}
                className="rounded-full border border-border/70 bg-background/55 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
              >
                {cleanReportText(provider, "provider")}
              </span>
            ))}
            <span className="rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[11px] text-muted-foreground">
              {totalFindings} {isStreaming ? "complete sections" : "sections"}
            </span>
          </div>
        </div>

        <ReportRadarCanvas counts={counts} />
      </header>

      <div className="relative space-y-4 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-medium text-sm">Section previews</h4>
            <p className="text-muted-foreground text-xs">{generatedLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="Scroll report sections left"
              onClick={() => scrollSections(-1)}
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="Scroll report sections right"
              onClick={() => scrollSections(1)}
            >
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>
        </div>

        <div
          ref={scrollerRef}
          aria-label="Report section previews"
          className="flex max-w-full gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth pb-3 [scrollbar-gutter:stable]"
          data-testid="report-section-strip"
          tabIndex={0}
        >
          {sections.map((section) => (
            <ReportSectionPreview
              key={section.id}
              section={section}
              selected={section.id === activeSection?.id}
              onSelect={() => openSection(section.id)}
            />
          ))}
          {isStreaming && <IncomingSectionPreview key="incoming-section-loader" />}
        </div>

        {!activeSection && isStreaming && <IncomingSectionDetail />}
      </div>
      {activeSection && (
        <ReportSectionDialog
          report={report}
          reportTitle={reportTitle}
          section={activeSection}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          reportChat={reportChat}
          messages={chatHistories[activeSection.id] ?? []}
          nextMessageId={() => nextChatMessageId(activeSection.id)}
          appendMessages={(messages) => appendChatMessages(activeSection.id, messages)}
          updateMessage={(messageId, patch) =>
            updateChatMessage(activeSection.id, messageId, patch)
          }
          replaceSelectedText={(selectedText, replacementText) =>
            replaceSectionText(activeSection.id, selectedText, replacementText)
          }
        />
      )}
      <ReportExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        reportTitle={reportTitle}
        sections={exportDraftSections}
        onReorder={reorderDraftSections}
        onMove={moveDraftSection}
        onReset={resetDraftSectionOrder}
        onApply={applyDraftSectionOrder}
      />
    </section>
  );
}

function ReportSectionDialog({
  report,
  reportTitle,
  section,
  open,
  onOpenChange,
  reportChat,
  messages,
  nextMessageId,
  appendMessages,
  updateMessage,
  replaceSelectedText,
}: {
  report: ReportOutput;
  reportTitle: string;
  section: ReportSection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportChat: ReportChatHandler | null;
  messages: ReportDialogMessage[];
  nextMessageId: () => string;
  appendMessages: (messages: ReportDialogMessage[]) => void;
  updateMessage: (messageId: string, patch: ReportDialogMessagePatch) => void;
  replaceSelectedText: (selectedText: string, replacementText: string) => void;
}) {
  const [mode, setMode] = useState<ReportDialogMode>("chat");
  const [draft, setDraft] = useState("");
  const [reportSelection, setReportSelection] = useState<ReportTextSelection | null>(null);
  const [chatSelection, setChatSelection] = useState<ReportTextSelection | null>(null);
  const [refineHighlight, setRefineHighlight] = useState<RefineHighlight | null>(null);
  const reportTextRef = useRef<HTMLParagraphElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const refineHighlightTimerRef = useRef<number | null>(null);
  const sanitizedReport = useMemo(
    () => ({ ...report, title: reportTitle, target: sanitizeReportTarget(report.target) }),
    [report, reportTitle],
  );
  const sanitizedSection = useMemo(() => sanitizeReportSection(section), [section]);
  const isSending = messages.some(
    (message) => message.status === "sending" || message.status === "streaming",
  );
  const selectedReportText = reportSelection?.text ?? "";
  const activeSelection = mode === "refine" ? reportSelection : (chatSelection ?? reportSelection);
  const canSend =
    reportChat !== null &&
    !isSending &&
    cleanReportText(draft).length > 0 &&
    (mode === "chat" || selectedReportText.length > 0);
  const modeTitle = mode === "refine" ? "Refine" : "Chat";
  const modeHelp =
    mode === "refine"
      ? selectedReportText
        ? "Selected text is ready for an in-place edit."
        : "Select text in the finding to edit it."
      : "Ask about this section.";
  const draftPlaceholder = mode === "refine" ? "Describe the edit" : "Ask about this section";
  const submitLabel = mode === "refine" ? "Refine" : "Ask";

  function clearRefineHighlightTimer() {
    if (refineHighlightTimerRef.current === null) return;
    window.clearTimeout(refineHighlightTimerRef.current);
    refineHighlightTimerRef.current = null;
  }

  function showUpdatedHighlight(text: string) {
    clearRefineHighlightTimer();
    setRefineHighlight({ text, state: "updated" });
    refineHighlightTimerRef.current = window.setTimeout(() => {
      setRefineHighlight(null);
      refineHighlightTimerRef.current = null;
    }, 2600);
  }

  useEffect(() => {
    setDraft("");
    setReportSelection(null);
    setChatSelection(null);
    setRefineHighlight(null);
    clearRefineHighlightTimer();
  }, [section.id]);

  useEffect(
    () => () => {
      clearRefineHighlightTimer();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const log = chatLogRef.current;
    if (!log) return;
    if (typeof log.scrollTo === "function") {
      log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
    } else {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages, open]);

  function captureSelection(source: ReportTextSelection["source"]) {
    const container = source === "report" ? reportTextRef.current : chatLogRef.current;
    const selectedText = selectedModalText(container);
    if (!selectedText) return;
    if (source === "report") {
      setReportSelection({ text: selectedText, source });
      return;
    }
    setChatSelection({ text: selectedText, source });
  }

  function clearActiveSelection() {
    if (mode === "refine" || activeSelection?.source === "report") {
      setReportSelection(null);
      return;
    }
    setChatSelection(null);
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = cleanReportText(draft);
    if (!question || !reportChat || isSending) return;
    if (mode === "refine" && !selectedReportText) return;

    const quote = mode === "refine" ? selectedReportText : (activeSelection?.text ?? null);
    const userMessageId = nextMessageId();
    const responseMessageId = nextMessageId();
    if (mode === "refine" && quote) {
      clearRefineHighlightTimer();
      setRefineHighlight({ text: quote, state: "refining" });
    }
    appendMessages([
      {
        id: userMessageId,
        role: "user",
        content: question,
        quote,
        mode,
      },
      {
        id: responseMessageId,
        role: "assistant",
        content: "",
        quote: null,
        mode,
        status: "sending",
      },
    ]);
    setDraft("");
    if (mode === "refine") {
      setReportSelection(null);
    } else if (chatSelection) {
      setChatSelection(null);
    }
    void sendQuestion(question, quote, mode, responseMessageId, reportChat);
  }

  async function sendQuestion(
    question: string,
    quote: string | null,
    requestMode: ReportDialogMode,
    responseMessageId: string,
    chat: ReportChatHandler,
  ): Promise<void> {
    const message = buildReportSectionQuestion(
      sanitizedReport,
      sanitizedSection,
      question,
      quote,
      requestMode,
    );
    try {
      const response = await chat({
        threadKey: buildReportChatThreadKey(sanitizedReport, sanitizedSection),
        title: cleanReportText(sanitizedSection.title, "Report section"),
        message,
        onDelta: (text) => {
          updateMessage(responseMessageId, {
            content: cleanReportText(text),
            status: "streaming",
          });
        },
      });
      if (requestMode === "refine" && quote) {
        if (isReportChatFailureText(response)) {
          throw new Error(response);
        }
        const replacementText = cleanRefinedReportText(response, quote);
        replaceSelectedText(quote, replacementText);
        showUpdatedHighlight(replacementText);
        updateMessage(responseMessageId, {
          content: replacementText,
          status: "done",
        });
        return;
      }
      updateMessage(responseMessageId, {
        content: cleanReportText(response, "No response returned."),
        status: "done",
      });
    } catch (error) {
      if (requestMode === "refine") {
        setRefineHighlight(null);
      }
      updateMessage(responseMessageId, {
        content: error instanceof Error ? error.message : "The report chat failed.",
        status: "error",
      });
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[min(92vh,860px)] max-h-[92vh] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto,minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:w-[min(96vw,72rem)] sm:max-w-none"
        data-testid="report-section-dialog"
      >
        <DialogHeader className="border-border/70 border-b bg-popover/95 p-4 pr-12 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={section.severity} />
                <span className="rounded-full border border-border/70 bg-card/55 px-2 py-0.5 text-muted-foreground text-xs">
                  {sectionTypeLabel(section.type)}
                </span>
              </div>
              <DialogTitle className="text-balance text-xl leading-tight">
                {cleanReportText(section.title, "Untitled section")}
              </DialogTitle>
            </div>
            <div className="hidden max-w-64 rounded-md border border-border/70 bg-background/55 px-3 py-2 text-xs sm:block">
              <span className="block font-medium text-muted-foreground">Report</span>
              <span className="mt-1 line-clamp-2 text-foreground">{reportTitle}</span>
            </div>
          </div>
          <DialogDescription className="sr-only">
            Report section detail and follow-up chat
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 overflow-y-auto bg-background/35 lg:grid-cols-[minmax(0,1fr)_24rem] lg:overflow-hidden">
          <div className="min-h-0 p-4 lg:overflow-y-auto">
            <div
              className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card/65"
              data-testid="report-section-content"
              onMouseUp={() => captureSelection("report")}
              onKeyUp={() => captureSelection("report")}
              onTouchEnd={() => captureSelection("report")}
              tabIndex={0}
            >
              <div className="flex items-center justify-between gap-3 border-border/70 border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <SparklesIcon className="size-3.5 shrink-0 text-brand-accent" />
                  <span className="font-medium text-muted-foreground text-xs">Finding</span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
                  {refineHighlight && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
                        refineHighlight.state === "refining"
                          ? "border-brand-accent/35 bg-brand-accent/10 text-brand-accent"
                          : "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      )}
                      data-testid="report-section-refine-status"
                    >
                      <ActivityIcon
                        className={cn(
                          "size-3",
                          refineHighlight.state === "refining" && "motion-safe:animate-pulse",
                        )}
                      />
                      {refineHighlight.state === "refining"
                        ? "Refining selected text"
                        : "Updated selected text"}
                    </span>
                  )}
                  <span className="text-muted-foreground">{sectionTypeLabel(section.type)}</span>
                </div>
              </div>
              <div className="p-4">
                <p ref={reportTextRef} className="whitespace-pre-wrap text-sm leading-6">
                  <ReportSectionContentText
                    highlight={refineHighlight}
                    text={cleanReportText(section.content)}
                  />
                </p>
                <CitationChips section={section} />
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SectionImpactPanel section={section} />
              <SectionDataPanel section={section} />
            </div>
          </div>

          <section className="flex min-h-[30rem] flex-col border-border/70 border-t bg-card/35 lg:min-h-0 lg:border-l lg:border-t-0">
            <div className="shrink-0 border-border/70 border-b p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    {mode === "refine" ? (
                      <PenLineIcon className="size-4 text-brand-accent" />
                    ) : (
                      <MessageSquareTextIcon className="size-4 text-brand-accent" />
                    )}
                    <h5 className="font-medium text-sm">{modeTitle}</h5>
                  </div>
                  <p className="text-muted-foreground text-xs leading-5">{modeHelp}</p>
                </div>
                <div className="inline-flex rounded-md border border-border/70 bg-background/70 p-0.5">
                  <Button
                    type="button"
                    variant={mode === "chat" ? "default" : "ghost"}
                    size="sm"
                    aria-pressed={mode === "chat"}
                    aria-label="Chat mode"
                    onClick={() => setMode("chat")}
                  >
                    <MessageSquareTextIcon className="size-3.5" />
                    Chat
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "refine" ? "default" : "ghost"}
                    size="sm"
                    aria-pressed={mode === "refine"}
                    aria-label="Refine mode"
                    onClick={() => setMode("refine")}
                  >
                    <PenLineIcon className="size-3.5" />
                    Refine
                  </Button>
                </div>
              </div>
            </div>
            <div
              ref={chatLogRef}
              className="min-h-0 flex-1 overflow-y-auto p-3"
              data-testid="report-section-chat-log"
              onMouseUp={() => captureSelection("chat")}
              onKeyUp={() => captureSelection("chat")}
              onTouchEnd={() => captureSelection("chat")}
              aria-live="polite"
              aria-label="Section chat history"
              tabIndex={0}
            >
              {messages.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/45 p-4 text-center">
                  <div className="max-w-64 space-y-2">
                    <MessageSquareTextIcon className="mx-auto size-5 text-muted-foreground" />
                    <p className="font-medium text-sm">No messages yet</p>
                    <p className="text-muted-foreground text-xs leading-5">
                      Ask about the finding, or switch to refine after selecting text.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "flex",
                        message.role === "user" ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[92%] rounded-lg border p-3",
                          message.role === "assistant"
                            ? "border-border/70 bg-background/80"
                            : "border-brand-accent/20 bg-brand-accent/10",
                          message.status === "error" && "border-destructive/40 bg-destructive/10",
                        )}
                      >
                        <span className="mb-1 block font-medium text-muted-foreground text-xs">
                          {message.status === "error"
                            ? "Error"
                            : message.role === "assistant"
                              ? message.mode === "refine"
                                ? "Refined text"
                                : "Response"
                              : message.mode === "refine"
                                ? "Refine request"
                                : "You"}
                        </span>
                        {message.quote && (
                          <blockquote className="mb-2 border-brand-accent/60 border-l-2 pl-2 text-muted-foreground text-xs leading-5">
                            {message.quote}
                          </blockquote>
                        )}
                        <p className="whitespace-pre-wrap text-sm leading-6">
                          {message.content ||
                            (message.status === "sending" ? "Thinking..." : "Waiting for response")}
                        </p>
                        {(message.status === "sending" || message.status === "streaming") && (
                          <span className="mt-2 inline-flex items-center gap-1 text-muted-foreground text-xs">
                            <ActivityIcon className="size-3 motion-safe:animate-pulse" />
                            {message.mode === "refine"
                              ? "Refining"
                              : message.status === "sending"
                                ? "Sending"
                                : "Responding"}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 border-border/70 border-t bg-background/80 p-3">
              {activeSelection ? (
                <div
                  className="rounded-lg border border-brand-accent/30 bg-brand-accent/10 p-3"
                  data-testid="report-section-selected-text"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium text-brand-accent text-xs">
                        <QuoteIcon className="size-3.5" />
                        {activeSelection.source === "report"
                          ? "Selected report text"
                          : "Selected excerpt"}
                      </span>
                      <p className="mt-1 line-clamp-3 text-muted-foreground text-xs leading-5">
                        {activeSelection.text}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={clearActiveSelection}>
                      Clear
                    </Button>
                  </div>
                </div>
              ) : mode === "refine" ? (
                <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-3 text-muted-foreground text-xs leading-5">
                  Select text from the finding to enable refine.
                </div>
              ) : null}

              <form className="mt-3 space-y-2" onSubmit={submitQuestion}>
                <Textarea
                  aria-label="Question about report section"
                  className="min-h-20 resize-none bg-card/70"
                  placeholder={draftPlaceholder}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleDraftKeyDown}
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 text-muted-foreground text-xs">
                    {reportChat
                      ? mode === "refine" && !selectedReportText
                        ? "Select report text first"
                        : "Ready"
                      : "Chat unavailable"}
                  </p>
                  <Button type="submit" disabled={!canSend}>
                    <SendHorizontalIcon className="size-4" />
                    {submitLabel}
                  </Button>
                </div>
              </form>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReportExportDialog({
  open,
  onOpenChange,
  reportTitle,
  sections,
  onReorder,
  onMove,
  onReset,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportTitle: string;
  sections: ReportSection[];
  onReorder: (sourceId: string, targetId: string) => void;
  onMove: (sectionId: string, direction: -1 | 1) => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function handleDragStart(event: DragEvent<HTMLLIElement>, sectionId: string) {
    setDraggingId(sectionId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sectionId);
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
    if (sourceId && sourceId !== targetId) {
      onReorder(sourceId, targetId);
    }
    setDraggingId(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(88vh,44rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[min(92vw,44rem)] sm:max-w-none"
        data-testid="report-export-dialog"
      >
        <DialogHeader className="border-border/70 border-b bg-popover/95 p-4 pr-12 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-balance text-lg leading-tight">
                Customize PPTX export
              </DialogTitle>
              <DialogDescription className="sr-only">
                Reorder report sections before exporting a presentation
              </DialogDescription>
              <p className="line-clamp-1 text-muted-foreground text-xs">{reportTitle}</p>
            </div>
            <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-muted-foreground text-xs">
              {sections.length} sections
            </span>
          </div>
        </DialogHeader>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background/35 p-4"
          data-testid="report-export-scroll-area"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <DataTile label="Deck title" value={reportTitle} />
            <DataTile label="Theme" value="Report default" />
            <DataTile label="Notes" value="Included" />
          </div>

          <ol
            className="mt-4 space-y-2"
            data-testid="report-export-order-list"
            aria-label="PPTX section order"
          >
            {sections.map((section, index) => {
              const title = cleanReportText(section.title, "Untitled section");
              const isDragging = draggingId === section.id;
              return (
                <li
                  key={section.id}
                  draggable
                  onDragStart={(event) => handleDragStart(event, section.id)}
                  onDragOver={handleDragOver}
                  onDrop={(event) => handleDrop(event, section.id)}
                  onDragEnd={() => setDraggingId(null)}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-card/75 p-3 transition-[border-color,background-color,box-shadow] duration-200",
                    isDragging && "border-brand-accent/60 bg-brand-accent/10 shadow-md",
                  )}
                  data-testid="report-export-section-row"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground">
                    <GripVerticalIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-muted-foreground text-xs tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="truncate font-medium text-sm">{title}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-muted-foreground text-xs">
                      {sectionTypeLabel(section.type)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${title} up`}
                      disabled={index === 0}
                      onClick={() => onMove(section.id, -1)}
                    >
                      <ArrowUpIcon className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${title} down`}
                      disabled={index === sections.length - 1}
                      onClick={() => onMove(section.id, 1)}
                    >
                      <ArrowDownIcon className="size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-border/70 border-t bg-background/85 p-3">
          <Button type="button" variant="ghost" onClick={onReset}>
            Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={onApply}>
              Apply order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReportSectionContentText({
  text,
  highlight,
}: {
  text: string;
  highlight: RefineHighlight | null;
}) {
  if (!highlight) return <>{text}</>;
  const index = text.indexOf(highlight.text);
  if (index < 0) return <>{text}</>;
  const testId =
    highlight.state === "refining"
      ? "report-section-refine-target"
      : "report-section-refined-target";

  return (
    <>
      {text.slice(0, index)}
      <span
        className={cn(
          "box-decoration-clone rounded px-1 py-0.5 text-foreground ring-1 transition-colors",
          highlight.state === "refining"
            ? "bg-brand-accent/15 ring-brand-accent/50 motion-safe:animate-pulse"
            : "bg-emerald-500/15 ring-emerald-500/45",
        )}
        data-testid={testId}
      >
        {highlight.text}
      </span>
      {text.slice(index + highlight.text.length)}
    </>
  );
}

function ReportSectionPreview({
  section,
  selected,
  onSelect,
}: {
  section: ReportSection;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = SEVERITY_STYLE[section.severity];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group relative min-h-48 w-80 shrink-0 overflow-hidden rounded-xl border border-border/75 bg-background/70 p-4 text-left shadow-sm transition-[box-shadow,border-color,background-color,transform] duration-200 hover:border-brand-accent/40 hover:bg-card/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5",
        selected && "border-brand-accent/70 bg-card shadow-md ring-1 ring-brand-accent/25",
      )}
    >
      <div aria-hidden className={cn("absolute inset-y-4 left-0 w-1 rounded-r-full", style.bar)} />
      <div className="flex items-center justify-between gap-2 pl-1">
        <SeverityBadge severity={section.severity} />
        <span className="text-muted-foreground text-xs">{sectionTypeLabel(section.type)}</span>
      </div>
      <h5 className="mt-3 line-clamp-2 pl-1 font-semibold text-sm leading-5 tracking-normal">
        {cleanReportText(section.title, "Untitled section")}
      </h5>
      <p className="mt-2 line-clamp-3 pl-1 text-muted-foreground text-xs leading-5">
        {cleanReportText(section.content)}
      </p>
      <div className="mt-3 pl-1">
        <SeverityMeter severity={section.severity} />
      </div>
      <PreviewFooter section={section} />
    </button>
  );
}

function IncomingSectionPreview() {
  return (
    <div
      aria-label="Next report section loading"
      className="min-h-48 w-80 shrink-0 overflow-hidden rounded-xl border border-dashed border-brand-accent/40 bg-brand-accent/5 p-4"
      data-testid="report-section-loading"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-accent/25 bg-brand-accent/10 px-2 py-0.5 font-medium text-brand-accent text-xs">
          <ActivityIcon className="size-3.5 motion-safe:animate-pulse" />
          Streaming
        </span>
        <LoadingDots />
      </div>
      <h5 className="mt-3 font-semibold text-sm leading-5 tracking-normal">Next section</h5>
      <p className="mt-2 text-muted-foreground text-xs leading-5">
        Waiting for the next complete report section.
      </p>
      <ReportLoadingStrip />
    </div>
  );
}

function IncomingSectionDetail() {
  return (
    <article
      className="overflow-hidden rounded-xl border border-dashed border-brand-accent/40 bg-background/65 p-4"
      data-testid="report-section-loading-detail"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-accent/25 bg-brand-accent/10 px-2 py-0.5 font-medium text-brand-accent text-xs">
            <ActivityIcon className="size-3.5 motion-safe:animate-pulse" />
            Streaming
          </span>
          <h4 className="mt-2 text-lg font-semibold leading-tight tracking-normal">
            Report sections are arriving
          </h4>
        </div>
        <LoadingDots />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-2">
          <div className="h-3 w-11/12 rounded-full bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-8/12 rounded-full bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-10/12 rounded-full bg-muted motion-safe:animate-pulse" />
        </div>
        <div className="rounded-lg border border-border/70 bg-card/55 p-3">
          <h5 className="font-medium text-sm">Incoming data</h5>
          <ReportLoadingStrip />
        </div>
      </div>
    </article>
  );
}

function LoadingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      <span className="size-1.5 rounded-full bg-brand-accent motion-safe:animate-pulse" />
      <span className="size-1.5 rounded-full bg-brand-accent/70 motion-safe:animate-pulse [animation-delay:120ms]" />
      <span className="size-1.5 rounded-full bg-brand-accent/40 motion-safe:animate-pulse [animation-delay:240ms]" />
    </span>
  );
}

function ReportLoadingStrip() {
  return (
    <div className="relative mt-4 h-12 overflow-hidden rounded-lg border border-border/60 bg-muted/25">
      <div className="absolute inset-x-8 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-brand-accent/10">
        <div className="h-full w-1/2 rounded-full bg-brand-accent/70 motion-safe:animate-pulse" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center gap-5">
        <span className="size-2 rounded-full bg-brand-accent/80 motion-safe:animate-pulse" />
        <span className="size-2 rounded-full bg-brand-accent/60 motion-safe:animate-pulse [animation-delay:140ms]" />
        <span className="size-2 rounded-full bg-brand-accent/40 motion-safe:animate-pulse [animation-delay:280ms]" />
      </div>
    </div>
  );
}

function PreviewFooter({ section }: { section: ReportSection }) {
  const value = previewValue(section);
  if (!value) return null;
  const label = cleanReportText(value.label, "Detail");
  const preview = cleanReportText(value.value);
  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-card/55 px-2.5 py-2 text-xs">
      <span className="block text-muted-foreground">{label}</span>
      <span className="mt-0.5 block truncate font-medium">{preview}</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: ReportSeverity }) {
  const style = SEVERITY_STYLE[severity];
  return (
    <span className={cn("rounded-full border px-2 py-0.5 font-medium text-xs", style.pill)}>
      {style.label}
    </span>
  );
}

function SeverityMeter({ severity }: { severity: ReportSeverity }) {
  const selectedIndex = SEVERITY_ORDER.indexOf(severity);
  return (
    <div className="grid grid-cols-5 gap-1" aria-hidden>
      {SEVERITY_ORDER.map((item, index) => (
        <span
          key={item}
          className={cn(
            "h-1.5 rounded-full bg-muted",
            index >= selectedIndex && SEVERITY_STYLE[item].bar,
          )}
        />
      ))}
    </div>
  );
}

function ReportRadarCanvas({ counts }: { counts: Record<ReportSeverity, number> }) {
  const countsKey = SEVERITY_ORDER.map((severity) => counts[severity]).join(":");
  const stableCounts = useMemo(() => {
    const values = countsKey.split(":").map((value) => Number(value) || 0);
    return {
      critical: values[0] ?? 0,
      high: values[1] ?? 0,
      medium: values[2] ?? 0,
      low: values[3] ?? 0,
      info: values[4] ?? 0,
    } satisfies Record<ReportSeverity, number>;
  }, [countsKey]);
  const total = SEVERITY_ORDER.reduce((sum, severity) => sum + stableCounts[severity], 0);
  const dominant = dominantSeverity(stableCounts);
  const segments = severityDonutSegments(stableCounts);

  return (
    <div
      className="relative min-h-48 overflow-hidden rounded-xl border border-border/70 bg-background/60 p-4"
      aria-label="Severity distribution"
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-sm">Impact radar</h4>
          <p className="text-muted-foreground text-xs">{total} report signals</p>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", dominant.style.pill)}>
          {dominant.label}
        </span>
      </div>

      <div className="relative z-10 mt-4 grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-4">
        <div className="relative size-28">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r="42" fill="none" stroke="var(--border)" strokeWidth="12" />
            {segments.map((segment) => (
              <circle
                key={segment.severity}
                cx="60"
                cy="60"
                r="42"
                fill="none"
                stroke={segment.color}
                strokeDasharray={`${segment.length} ${segment.circumference - segment.length}`}
                strokeDashoffset={-segment.offset}
                strokeLinecap="round"
                strokeWidth="12"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-semibold text-xl leading-none">{total}</span>
            <span className="mt-1 text-[10px] text-muted-foreground">signals</span>
          </div>
        </div>

        <div className="space-y-2">
          {SEVERITY_ORDER.map((severity) => {
            const count = stableCounts[severity];
            const pct = total ? (count / total) * 100 : 0;
            return (
              <div
                key={severity}
                className="grid grid-cols-[4.25rem_minmax(0,1fr)_1.5rem] items-center gap-2"
              >
                <span className="truncate text-[11px] text-muted-foreground">
                  {SEVERITY_STYLE[severity].label}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-muted/70">
                  <div
                    className={cn("h-full rounded-full", SEVERITY_STYLE[severity].bar)}
                    style={{ width: count > 0 ? `${Math.max(5, pct)}%` : "0%" }}
                  />
                </div>
                <span className="text-right font-medium text-xs tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SectionImpactPanel({ section }: { section: ReportSection }) {
  const style = SEVERITY_STYLE[section.severity];
  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="font-medium text-sm">Impact profile</h5>
        <span className={cn("text-xs", style.text)}>{style.label}</span>
      </div>
      <div className="mt-3">
        <SeverityMeter severity={section.severity} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <DataTile label="Type" value={sectionTypeLabel(section.type)} />
        <DataTile label="Severity" value={style.label} />
      </div>
      {section.provenance && (
        <p
          className="mt-3 truncate text-muted-foreground text-xs"
          title={cleanReportText(section.provenance)}
        >
          {cleanReportText(section.provenance)}
        </p>
      )}
    </div>
  );
}

function SectionDataPanel({ section }: { section: ReportSection }) {
  const metrics = metricItems(section);
  if (metrics.length > 0) return <MetricsPanel metrics={metrics} />;
  if (section.type === "cost_impact") return <CostImpactPanel section={section} />;
  if (section.type === "change") return <PricingPanel section={section} />;
  if (section.type === "code_impact") return <CodeImpactPanel section={section} />;
  if (section.type === "action") return <ActionPanel section={section} />;
  if (section.type === "source" || section.type === "evidence") {
    return <SourcePanel section={section} />;
  }

  return <GenericDataPanel section={section} />;
}

function MetricsPanel({ metrics }: { metrics: { label: string; value: string }[] }) {
  const numericValues = metrics.map((metric) => numberFromText(metric.value)).filter(isNumber);
  const max = Math.max(...numericValues, 1);

  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <div className="flex items-center gap-2">
        <BarChart3Icon className="size-4 text-brand-accent" />
        <h5 className="font-medium text-sm">Metrics</h5>
      </div>
      <div className="mt-3 grid gap-2">
        {metrics.map((metric) => {
          const numeric = numberFromText(metric.value);
          const label = cleanReportText(metric.label, "Metric");
          const value = cleanReportText(metric.value);
          return (
            <div key={`${metric.label}-${metric.value}`} className="rounded-lg bg-muted/35 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-muted-foreground text-xs">{label}</span>
                <span className="shrink-0 font-semibold text-sm">{value}</span>
              </div>
              {numeric !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/80">
                  <div
                    className="h-full rounded-full bg-brand-accent"
                    style={{ width: `${Math.max(6, (numeric / max) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostImpactPanel({ section }: { section: ReportSection }) {
  const oldCost = costPair(section.data.old);
  const newCost = costPair(section.data.new);
  const currency = stringValue(section.data.currency) ?? "USD";
  const max = Math.max(oldCost.total, newCost.total, 1);
  const delta = numberValue(section.data.delta_usd);
  const pct = numberValue(section.data.pct_change);
  const increasing = delta !== null ? delta >= 0 : newCost.total >= oldCost.total;

  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CircleDollarSignIcon className="size-4 text-brand-accent" />
          <h5 className="font-medium text-sm">Cost movement</h5>
        </div>
        {(delta !== null || pct !== null) && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
              increasing
                ? "border-warning/35 bg-warning/10 text-warning"
                : "border-success/35 bg-success/10 text-success",
            )}
          >
            {increasing ? (
              <TrendingUpIcon className="size-3" />
            ) : (
              <TrendingDownIcon className="size-3" />
            )}
            {pct !== null ? `${pct.toFixed(1)}%` : "changed"}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-3">
        <CostBar label="Current" cost={oldCost} max={max} currency={currency} />
        <CostBar label="New" cost={newCost} max={max} currency={currency} />
      </div>
      {(delta !== null || pct !== null) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {delta !== null && <DataTile label="Delta" value={formatMoney(delta, currency)} />}
          {pct !== null && <DataTile label="Change" value={`${pct.toFixed(1)}%`} />}
        </div>
      )}
    </div>
  );
}

function CostBar({
  label,
  cost,
  max,
  currency,
}: {
  label: string;
  cost: { input: number; output: number; total: number };
  max: number;
  currency: string;
}) {
  const inputPct = cost.total ? (cost.input / cost.total) * 100 : 0;
  const widthPct = Math.max(4, (cost.total / max) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{formatMoney(cost.total, currency)}</span>
      </div>
      <div
        className="h-4 rounded-full border border-border/60 bg-muted/70 p-0.5"
        aria-label={`${label} total ${formatMoney(cost.total, currency)}`}
      >
        <div
          className="flex h-full overflow-hidden rounded-full transition-[width] duration-300"
          style={{ width: `${widthPct}%` }}
        >
          <span className="bg-brand-accent" style={{ width: `${inputPct}%` }} />
          <span className="flex-1 bg-status-blue" />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>Input {formatMoney(cost.input, currency)}</span>
        <span>Output {formatMoney(cost.output, currency)}</span>
      </div>
    </div>
  );
}

function PricingPanel({ section }: { section: ReportSection }) {
  const oldPricing = pricingValue(section.data.old_pricing);
  const newPricing = pricingValue(section.data.new_pricing);
  const pricing = pricingValue(section.data.pricing);
  const provider = stringValue(section.data.provider);
  const model = stringValue(section.data.model);

  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <h5 className="font-medium text-sm">Model change</h5>
      <div className="mt-3 grid gap-2">
        {provider && <DataTile label="Provider" value={provider} />}
        {model && <DataTile label="Model" value={model} />}
        {pricing && <PricingRows title="Pricing" pricing={pricing} />}
        {oldPricing && <PricingRows title="Old pricing" pricing={oldPricing} />}
        {newPricing && <PricingRows title="New pricing" pricing={newPricing} />}
      </div>
    </div>
  );
}

function PricingRows({ title, pricing }: { title: string; pricing: ReportPricing }) {
  const currency = pricing.currency ?? "USD";
  return (
    <div className="rounded-lg bg-muted/35 p-2.5">
      <span className="text-muted-foreground text-xs">{title}</span>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        {typeof pricing.input_per_1m === "number" && (
          <span>Input {formatMoney(pricing.input_per_1m, currency)}</span>
        )}
        {typeof pricing.output_per_1m === "number" && (
          <span>Output {formatMoney(pricing.output_per_1m, currency)}</span>
        )}
        {typeof pricing.cached_input_per_1m === "number" && (
          <span>Cached {formatMoney(pricing.cached_input_per_1m, currency)}</span>
        )}
      </div>
    </div>
  );
}

function CodeImpactPanel({ section }: { section: ReportSection }) {
  const file = stringValue(section.data.file);
  const line = numberValue(section.data.line);
  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <h5 className="font-medium text-sm">Code impact</h5>
      <div className="mt-3 grid gap-2">
        {file && <DataTile label="File" value={line ? `${file}:${line}` : file} />}
        {stringValue(section.data.provider) && (
          <DataTile label="Provider" value={stringValue(section.data.provider)!} />
        )}
        {stringValue(section.data.model) && (
          <DataTile label="Model" value={stringValue(section.data.model)!} />
        )}
      </div>
    </div>
  );
}

function ActionPanel({ section }: { section: ReportSection }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <h5 className="font-medium text-sm">Action</h5>
      <div className="mt-3 grid gap-2">
        {stringValue(section.data.priority) && (
          <DataTile label="Priority" value={stringValue(section.data.priority)!} />
        )}
        {stringValue(section.data.deadline) && (
          <DataTile label="Deadline" value={stringValue(section.data.deadline)!} />
        )}
        {stringValue(section.data.owner) && (
          <DataTile label="Owner" value={stringValue(section.data.owner)!} />
        )}
      </div>
    </div>
  );
}

function SourcePanel({ section }: { section: ReportSection }) {
  const url = stringValue(section.data.url);
  if (!url) return <GenericDataPanel section={section} />;
  const label = cleanReportText(url, url);

  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <h5 className="font-medium text-sm">Reference</h5>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/55 px-2 py-2 text-sm transition-colors hover:bg-muted"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ExternalLinkIcon className="size-3.5 shrink-0" />
      </a>
    </div>
  );
}

function GenericDataPanel({ section }: { section: ReportSection }) {
  const entries = Object.entries(section.data).filter(
    ([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
  );
  if (entries.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/70 bg-card/55 p-3">
      <h5 className="font-medium text-sm">Details</h5>
      <div className="mt-3 grid gap-2">
        {entries.slice(0, 5).map(([key, value]) => (
          <DataTile key={key} label={sectionTypeLabel(key)} value={String(value)} />
        ))}
      </div>
    </div>
  );
}

function DataTile({ label, value }: { label: string; value: string }) {
  const displayLabel = cleanReportText(label, "Detail");
  const displayValue = cleanReportText(value);
  return (
    <div className="min-w-0 rounded-lg bg-muted/35 p-2.5">
      <span className="block text-muted-foreground text-xs">{displayLabel}</span>
      <span className="block truncate font-medium text-sm" title={displayValue}>
        {displayValue}
      </span>
    </div>
  );
}

function CitationChips({ section }: { section: ReportSection }) {
  const sources = (section.citations?.sources ?? [])
    .map((source) => ({ key: source, label: cleanReportText(source) }))
    .filter((source) => source.label.length > 0);
  const evidence = (section.citations?.evidence ?? [])
    .map((item) => ({ key: item, label: cleanReportText(item) }))
    .filter((item) => item.label.length > 0);
  if (sources.length === 0 && evidence.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {sources.map((source) => (
        <span
          key={source.key}
          className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-xs"
        >
          {source.label}
        </span>
      ))}
      {evidence.map((item) => (
        <span
          key={item.key}
          className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-xs"
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}

function buildReportSectionQuestion(
  report: ReportOutput,
  section: ReportSection,
  question: string,
  quote: string | null,
  mode: ReportDialogMode,
): string {
  if (mode === "refine") {
    return [
      buildReportSectionQuote(report, section),
      quote ? `Selected report text:\n${quote}` : null,
      "Task:\nRewrite only the selected report text. Return only the replacement text, with no explanation or markdown fence. Keep the same factual meaning unless the edit request asks for a specific change.",
      `Edit request:\n${question}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n\n");
  }

  return [
    buildReportSectionQuote(report, section),
    quote ? `Selected text:\n${quote}` : null,
    `Question:\n${question}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

function buildReportChatThreadKey(report: ReportOutput, section: ReportSection): string {
  const reportKey = cleanReportText(report.run_id || report.generated_at || report.title, "report");
  return `${reportKey}:${section.id}`;
}

function orderReportSections(sections: ReportSection[], order: string[]): ReportSection[] {
  const byId = new Map(sections.map((section) => [section.id, section]));
  return mergeSectionOrder(order, sections).flatMap((id) => {
    const section = byId.get(id);
    return section ? [section] : [];
  });
}

function mergeSectionOrder(order: string[], sections: ReportSection[]): string[] {
  const sectionIds = new Set(sections.map((section) => section.id));
  const nextOrder: string[] = [];
  for (const id of order) {
    if (!sectionIds.has(id) || nextOrder.includes(id)) continue;
    nextOrder.push(id);
  }
  for (const section of sections) {
    if (!nextOrder.includes(section.id)) nextOrder.push(section.id);
  }
  return nextOrder;
}

function reorderSectionBeforeTarget(order: string[], sourceId: string, targetId: string): string[] {
  if (sourceId === targetId) return order;
  const withoutSource = order.filter((id) => id !== sourceId);
  const targetIndex = withoutSource.indexOf(targetId);
  if (targetIndex < 0) return order;
  return [...withoutSource.slice(0, targetIndex), sourceId, ...withoutSource.slice(targetIndex)];
}

function moveSectionInOrder(order: string[], sectionId: string, direction: -1 | 1): string[] {
  const currentIndex = order.indexOf(sectionId);
  if (currentIndex < 0) return order;
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= order.length) return order;
  const next = [...order];
  const [section] = next.splice(currentIndex, 1);
  if (!section) return order;
  next.splice(nextIndex, 0, section);
  return next;
}

function reportSectionEditStorageKey(report: ReportOutput): string {
  const target = report.target?.path ?? report.target?.name ?? "";
  const identity = [
    report.run_id,
    report.generated_at,
    report.title,
    target,
    String(report.report_version),
  ]
    .map((part) => cleanReportText(part))
    .join("|");
  return `${REPORT_SECTION_EDITS_STORAGE_PREFIX}:${identity}`;
}

function reportSectionOrderStorageKey(report: ReportOutput): string {
  return reportSectionEditStorageKey(report).replace(
    REPORT_SECTION_EDITS_STORAGE_PREFIX,
    REPORT_SECTION_ORDER_STORAGE_PREFIX,
  );
}

function readReportSectionEdits(storageKey: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        const [key, value] = entry;
        return key.length > 0 && typeof value === "string" && value.length > 0;
      }),
    );
  } catch {
    return {};
  }
}

function writeReportSectionEdits(storageKey: string, edits: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(edits).length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(edits));
  } catch {
    // Browser storage can be disabled or full. The in-memory edit still applies.
  }
}

function readReportSectionOrder(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

function writeReportSectionOrder(storageKey: string, order: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(order));
  } catch {
    // Browser storage can be disabled or full. The applied order still works in memory.
  }
}

function selectedModalText(container: HTMLElement | null): string {
  if (typeof window === "undefined") return "";
  if (!container) return "";
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
  if (
    !isSelectionNodeInside(container, selection.anchorNode) ||
    !isSelectionNodeInside(container, selection.focusNode)
  ) {
    return "";
  }
  return cleanReportText(selection.toString());
}

function isSelectionNodeInside(container: HTMLElement, node: Node | null): boolean {
  return node !== null && (node === container || container.contains(node));
}

function cleanRefinedReportText(value: string, fallback: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return cleanReportText(fenced?.[1] ?? trimmed, fallback);
}

function isReportChatFailureText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "an internal error occurred." ||
    normalized === "an internal error occurred" ||
    normalized === "report chat failed." ||
    normalized === "report chat failed" ||
    normalized === "no response returned." ||
    normalized === "no response returned"
  );
}

function replaceSelectedReportText(content: string, selectedText: string, replacementText: string) {
  const source = cleanReportText(content);
  const selected = cleanReportText(selectedText);
  const replacement = cleanRefinedReportText(replacementText, selected);
  if (!source || !selected || !replacement) return source;

  const index = source.indexOf(selected);
  if (index < 0) return source;
  return cleanReportText(
    `${source.slice(0, index)}${replacement}${source.slice(index + selected.length)}`,
  );
}

function cleanReportText(value: string, fallback = ""): string {
  const cleaned = value
    .replace(REPORT_BRAND_PATTERN, "")
    .replace(/\s+([,.:!?])/g, "$1")
    .replace(/^[\s|:/-]+|[\s|:/-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || fallback;
}

function sanitizeReportTarget(target: ReportOutput["target"]): ReportOutput["target"] {
  if (!target) return target;
  return {
    ...target,
    name: target.name ? cleanReportText(target.name, "Report target") : target.name,
    path: target.path ? cleanReportText(target.path, "Report target") : target.path,
  };
}

function sanitizeReportSection(section: ReportSection): ReportSection {
  return {
    ...section,
    title: cleanReportText(section.title, "Untitled section"),
    content: cleanReportText(section.content),
    provenance: section.provenance ? cleanReportText(section.provenance) : section.provenance,
  };
}

function severityCounts(sections: ReportSection[]): Record<ReportSeverity, number> {
  return SEVERITY_ORDER.reduce(
    (acc, severity) => {
      acc[severity] = sections.filter((section) => section.severity === severity).length;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 } satisfies Record<ReportSeverity, number>,
  );
}

function dominantSeverity(counts: Record<ReportSeverity, number>): {
  severity: ReportSeverity;
  label: string;
  count: number;
  style: (typeof SEVERITY_STYLE)[ReportSeverity];
} {
  const severity =
    SEVERITY_ORDER.find((item) => counts[item] > 0) ?? ("info" satisfies ReportSeverity);
  return {
    severity,
    label: SEVERITY_STYLE[severity].label,
    count: counts[severity],
    style: SEVERITY_STYLE[severity],
  };
}

function severityDonutSegments(counts: Record<ReportSeverity, number>) {
  const total = SEVERITY_ORDER.reduce((sum, severity) => sum + counts[severity], 0);
  const circumference = 2 * Math.PI * 42;
  let offset = 0;

  if (total === 0) return [];

  return SEVERITY_ORDER.flatMap((severity) => {
    const count = counts[severity];
    if (count === 0) return [];
    const length = (count / total) * circumference;
    const segment = {
      severity,
      length,
      offset,
      circumference,
      color: SEVERITY_STYLE[severity].color,
    };
    offset += length;
    return [segment];
  });
}

function sectionTypeLabel(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function metricItems(section: ReportSection): { label: string; value: string }[] {
  const metrics = section.data.metrics;
  if (!Array.isArray(metrics)) return [];
  return metrics.flatMap((metric) => {
    if (!isRecord(metric)) return [];
    const label = stringValue(metric.label);
    const value = stringValue(metric.value);
    return label && value ? [{ label, value }] : [];
  });
}

function previewValue(section: ReportSection): { label: string; value: string } | null {
  const firstMetric = metricItems(section)[0];
  if (firstMetric) return firstMetric;
  if (section.type === "cost_impact") {
    const delta = numberValue(section.data.delta_usd);
    if (delta !== null) {
      return {
        label: "Delta",
        value: formatMoney(delta, stringValue(section.data.currency) ?? "USD"),
      };
    }
  }
  if (section.type === "action") {
    const priority = stringValue(section.data.priority);
    if (priority) return { label: "Priority", value: priority };
  }
  const provider = stringValue(section.data.provider);
  const model = stringValue(section.data.model);
  if (provider || model)
    return { label: "Model", value: [provider, model].filter(Boolean).join(" ") };
  return null;
}

function costPair(value: unknown): { input: number; output: number; total: number } {
  if (!isRecord(value)) return { input: 0, output: 0, total: 0 };
  const input = numberValue(value.input) ?? 0;
  const output = numberValue(value.output) ?? 0;
  return { input, output, total: input + output };
}

function pricingValue(value: unknown): ReportPricing | null {
  if (!isRecord(value)) return null;
  return {
    input_per_1m: numberValue(value.input_per_1m) ?? undefined,
    cached_input_per_1m: numberValue(value.cached_input_per_1m) ?? undefined,
    output_per_1m: numberValue(value.output_per_1m) ?? undefined,
    currency: stringValue(value.currency) ?? undefined,
    promo: typeof value.promo === "boolean" ? value.promo : undefined,
    note: stringValue(value.note) ?? undefined,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberFromText(value: string): number | null {
  const match = /-?\d+(?:,\d{3})*(?:\.\d+)?/.exec(value);
  if (!match?.[0]) return null;
  const numeric = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function isNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
