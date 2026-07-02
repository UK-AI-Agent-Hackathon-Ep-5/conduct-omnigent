import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Maximize2Icon,
  MessageSquareTextIcon,
  Minimize2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildReportSectionQuote, useReportChat } from "./ReportChatContext";
import type { ReportOutput, ReportPricing, ReportSection, ReportSeverity } from "./reportOutput";

const SEVERITY_ORDER: ReportSeverity[] = ["critical", "high", "medium", "low", "info"];

const SEVERITY_STYLE: Record<
  ReportSeverity,
  { label: string; pill: string; border: string; bar: string; hex: number }
> = {
  critical: {
    label: "Critical",
    pill: "border-destructive/30 bg-destructive/10 text-destructive",
    border: "border-destructive/50",
    bar: "bg-destructive",
    hex: 0xef4444,
  },
  high: {
    label: "High",
    pill: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    border: "border-orange-500/50",
    bar: "bg-orange-500",
    hex: 0xf97316,
  },
  medium: {
    label: "Medium",
    pill: "border-warning/30 bg-warning/10 text-warning",
    border: "border-warning/50",
    bar: "bg-warning",
    hex: 0xf6c445,
  },
  low: {
    label: "Low",
    pill: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    border: "border-cyan-500/50",
    bar: "bg-cyan-500",
    hex: 0x06b6d4,
  },
  info: {
    label: "Info",
    pill: "border-foreground/15 bg-foreground/5 text-muted-foreground",
    border: "border-border",
    bar: "bg-muted-foreground",
    hex: 0x8a8f98,
  },
};

interface ReportOutputViewProps {
  report: ReportOutput;
  enablePixi?: boolean;
}

export function ReportOutputView({ report, enablePixi = true }: ReportOutputViewProps) {
  const [activeId, setActiveId] = useState(report.sections[0]?.id ?? "");
  const [expanded, setExpanded] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reportChat = useReportChat();

  const activeSection =
    report.sections.find((section) => section.id === activeId) ?? report.sections[0] ?? null;
  const counts = useMemo(() => severityCounts(report.sections), [report.sections]);
  const totalFindings = report.sections.filter((section) => section.type !== "source").length;
  const targetLabel = report.target?.name ?? report.target?.path ?? "Report target";
  const generatedLabel = formatGeneratedAt(report.generated_at);

  function scrollSections(direction: -1 | 1) {
    scrollerRef.current?.scrollBy({ left: direction * 360, behavior: "smooth" });
  }

  function askAboutActiveSection() {
    if (!reportChat || !activeSection) return;
    reportChat(buildReportSectionQuote(report, activeSection));
  }

  return (
    <section
      data-testid="report-output"
      className="overflow-hidden rounded-lg border border-border bg-background/80 text-foreground shadow-sm"
    >
      <header className="grid gap-4 border-border border-b p-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-brand-accent/25 bg-brand-accent/10 px-2 py-0.5 font-medium text-brand-accent text-xs">
              Report
            </span>
            <span className="text-muted-foreground text-xs">{report.run_id}</span>
          </div>
          <div>
            <h3 className="text-xl font-semibold leading-tight tracking-normal">{report.title}</h3>
            <p className="mt-1 text-muted-foreground text-sm">{targetLabel}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {report.providers.map((provider) => (
              <span
                key={provider}
                className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs"
              >
                {provider}
              </span>
            ))}
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">
              {totalFindings} sections
            </span>
          </div>
        </div>

        <ReportRadarCanvas counts={counts} enablePixi={enablePixi} />
      </header>

      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
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
          className="flex snap-x gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-gutter:stable]"
          data-testid="report-section-strip"
        >
          {report.sections.map((section) => (
            <ReportSectionPreview
              key={section.id}
              section={section}
              selected={section.id === activeSection?.id}
              onSelect={() => {
                setActiveId(section.id);
                setExpanded(true);
              }}
            />
          ))}
        </div>

        {activeSection && (
          <article
            className={cn(
              "rounded-lg border bg-card transition-[border-color,box-shadow] duration-200",
              SEVERITY_STYLE[activeSection.severity].border,
            )}
            data-testid="report-section-detail"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={activeSection.severity} />
                  <span className="text-muted-foreground text-xs">
                    {sectionTypeLabel(activeSection.type)}
                  </span>
                </div>
                <h4 className="mt-2 text-lg font-semibold leading-tight tracking-normal">
                  {activeSection.title}
                </h4>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!reportChat}
                  onClick={askAboutActiveSection}
                >
                  <MessageSquareTextIcon className="size-3.5" />
                  Ask about section
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={expanded ? "Collapse report section" : "Expand report section"}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? (
                    <Minimize2Icon className="size-3.5" />
                  ) : (
                    <Maximize2Icon className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-out",
                expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <div className="grid gap-4 px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="min-w-0 space-y-3">
                    <p className="whitespace-pre-wrap text-sm leading-6">{activeSection.content}</p>
                    <CitationChips section={activeSection} />
                  </div>
                  <SectionDataPanel section={activeSection} />
                </div>
              </div>
            </div>
          </article>
        )}
      </div>
    </section>
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
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group min-h-44 w-72 shrink-0 snap-start rounded-lg border bg-background/80 p-4 text-left transition-[transform,box-shadow,border-color,background-color] duration-200 hover:-translate-y-1 hover:border-brand-accent/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-brand-accent bg-brand-accent/5 shadow-md",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <SeverityBadge severity={section.severity} />
        <span className="text-muted-foreground text-xs">{sectionTypeLabel(section.type)}</span>
      </div>
      <h5 className="mt-3 line-clamp-2 font-semibold text-sm leading-5 tracking-normal">
        {section.title}
      </h5>
      <p className="mt-2 line-clamp-3 text-muted-foreground text-xs leading-5">{section.content}</p>
      <PreviewFooter section={section} />
    </button>
  );
}

function PreviewFooter({ section }: { section: ReportSection }) {
  const value = previewValue(section);
  if (!value) return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
      <span className="block text-muted-foreground">{value.label}</span>
      <span className="mt-0.5 block truncate font-medium">{value.value}</span>
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

function ReportRadarCanvas({
  counts,
  enablePixi,
}: {
  counts: Record<ReportSeverity, number>;
  enablePixi: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const total = SEVERITY_ORDER.reduce((sum, severity) => sum + counts[severity], 0);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    if (!enablePixi || !mountRef.current || total === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let app: import("pixi.js").Application | null = null;
    let tick: ((ticker: { deltaTime: number }) => void) | null = null;
    let disposed = false;
    const mount = mountRef.current;

    void (async () => {
      try {
        const { Application, Graphics } = await import("pixi.js");
        if (disposed) return;

        app = new Application();
        await app.init({
          width: 288,
          height: 112,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          preference: "webgl",
        });
        if (disposed || !app) {
          app?.destroy({ removeView: true }, { children: true });
          return;
        }

        app.canvas.style.height = "100%";
        app.canvas.style.width = "100%";
        app.canvas.style.display = "block";
        mount.replaceChildren(app.canvas);

        const cx = 58;
        const cy = 56;
        const radius = 36;
        const halo = new Graphics()
          .circle(cx, cy, radius + 10)
          .stroke({ width: 2, color: 0xf85018, alpha: 0.22 });
        halo.pivot.set(cx, cy);
        halo.position.set(cx, cy);
        const chart = new Graphics();
        const bars = new Graphics();

        let start = -Math.PI / 2;
        for (const severity of SEVERITY_ORDER) {
          const count = counts[severity];
          if (count === 0) continue;
          const end = start + (count / total) * Math.PI * 2;
          chart
            .moveTo(cx, cy)
            .arc(cx, cy, radius, start, end)
            .lineTo(cx, cy)
            .closePath()
            .fill({ color: SEVERITY_STYLE[severity].hex, alpha: 0.78 });
          start = end;
        }
        chart.circle(cx, cy, 14).fill({ color: 0xffffff, alpha: 0.78 });
        chart.circle(cx, cy, radius).stroke({ width: 1, color: 0x1e0d15, alpha: 0.18 });

        SEVERITY_ORDER.forEach((severity, index) => {
          const barWidth = total ? Math.max(3, (counts[severity] / total) * 124) : 0;
          bars
            .roundRect(132, 18 + index * 15, barWidth, 7, 4)
            .fill({ color: SEVERITY_STYLE[severity].hex, alpha: 0.82 });
        });

        app.stage.addChild(halo, chart, bars);
        tick = () => {
          const pulse = 1 + Math.sin(performance.now() / 460) * 0.035;
          halo.scale.set(pulse);
          halo.alpha = 0.5 + Math.sin(performance.now() / 520) * 0.18;
          bars.x = Math.sin(performance.now() / 620) * 1.5;
        };
        app.ticker.add(tick);
      } catch {
        mount.replaceChildren();
      }
    })();

    return () => {
      disposed = true;
      if (app && tick) app.ticker.remove(tick);
      app?.destroy({ removeView: true }, { children: true });
    };
  }, [counts, enablePixi, total]);

  return (
    <div className="relative min-h-28 overflow-hidden rounded-lg border border-border bg-muted/20">
      <div ref={mountRef} aria-hidden className="pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative z-10 grid h-full grid-cols-5 gap-1 p-3">
        {SEVERITY_ORDER.map((severity) => {
          const count = counts[severity];
          const height = total ? Math.max(12, (count / total) * 72) : 12;
          return (
            <div key={severity} className="flex min-w-0 flex-col justify-end gap-1">
              <div className="flex h-20 items-end rounded bg-background/65 p-1">
                <div
                  className={cn("w-full rounded", SEVERITY_STYLE[severity].bar)}
                  style={{ height }}
                />
              </div>
              <span className="truncate text-center text-[10px] text-muted-foreground">
                {SEVERITY_STYLE[severity].label}
              </span>
              <span className="text-center font-medium text-xs">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionDataPanel({ section }: { section: ReportSection }) {
  const metrics = metricItems(section);
  if (metrics.length > 0) {
    return (
      <div className="rounded-lg border border-border bg-background/80 p-3">
        <h5 className="font-medium text-sm">Metrics</h5>
        <div className="mt-3 grid gap-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-md bg-muted/35 p-2">
              <span className="block text-muted-foreground text-xs">{metric.label}</span>
              <span className="text-lg font-semibold">{metric.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section.type === "cost_impact") return <CostImpactPanel section={section} />;
  if (section.type === "change") return <PricingPanel section={section} />;
  if (section.type === "code_impact") return <CodeImpactPanel section={section} />;
  if (section.type === "action") return <ActionPanel section={section} />;
  if (section.type === "source" || section.type === "evidence") {
    return <SourcePanel section={section} />;
  }

  return <GenericDataPanel section={section} />;
}

function CostImpactPanel({ section }: { section: ReportSection }) {
  const oldCost = costPair(section.data.old);
  const newCost = costPair(section.data.new);
  const currency = stringValue(section.data.currency) ?? "USD";
  const max = Math.max(oldCost.total, newCost.total, 1);
  const delta = numberValue(section.data.delta_usd);
  const pct = numberValue(section.data.pct_change);

  return (
    <div className="rounded-lg border border-border bg-background/80 p-3">
      <h5 className="font-medium text-sm">Cost movement</h5>
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
      <div className="h-3 rounded-full bg-muted">
        <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${widthPct}%` }}>
          <span className="bg-brand-accent" style={{ width: `${inputPct}%` }} />
          <span className="flex-1 bg-cyan-500" />
        </div>
      </div>
      <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
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
    <div className="rounded-lg border border-border bg-background/80 p-3">
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
    <div className="rounded-md bg-muted/35 p-2">
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
    <div className="rounded-lg border border-border bg-background/80 p-3">
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
    <div className="rounded-lg border border-border bg-background/80 p-3">
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

  return (
    <div className="rounded-lg border border-border bg-background/80 p-3">
      <h5 className="font-medium text-sm">Reference</h5>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-2 py-2 text-sm transition-colors hover:bg-muted"
      >
        <span className="min-w-0 flex-1 truncate">{url}</span>
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
    <div className="rounded-lg border border-border bg-background/80 p-3">
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
  return (
    <div className="min-w-0 rounded-md bg-muted/35 p-2">
      <span className="block text-muted-foreground text-xs">{label}</span>
      <span className="block truncate font-medium text-sm" title={value}>
        {value}
      </span>
    </div>
  );
}

function CitationChips({ section }: { section: ReportSection }) {
  const sources = section.citations?.sources ?? [];
  const evidence = section.citations?.evidence ?? [];
  if (sources.length === 0 && evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((source) => (
        <span
          key={source}
          className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs"
        >
          {source}
        </span>
      ))}
      {evidence.map((item) => (
        <span
          key={item}
          className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs"
        >
          {item}
        </span>
      ))}
    </div>
  );
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
