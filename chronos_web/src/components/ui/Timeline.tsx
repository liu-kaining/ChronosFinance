/**
 * Timeline - Vertical event timeline component
 * Displays events in chronological order with icons and details
 */

import { cn } from "@/lib/cn";
import { fmtDay } from "@/lib/format";

export type EventType =
  | "earnings"
  | "dividend"
  | "split"
  | "ipo"
  | "insider"
  | "sec"
  | "news"
  | "press"
  | "economic"
  | "generic";

export interface TimelineEvent {
  id: string;
  date: string;
  type: EventType;
  title: string;
  description?: string;
  symbol?: string;
  value?: string;
  change?: number;
  url?: string;
}

interface Props {
  events: TimelineEvent[];
  className?: string;
  onEventClick?: (event: TimelineEvent) => void;
}

const EVENT_ICONS: Record<EventType, string> = {
  earnings: "📊",
  dividend: "💰",
  split: "✂️",
  ipo: "🚀",
  insider: "🏢",
  sec: "📄",
  news: "📰",
  press: "📢",
  economic: "📈",
  generic: "•",
};

const EVENT_COLORS: Record<EventType, string> = {
  earnings: "border-accent bg-accent/10 text-accent",
  dividend: "border-up bg-up-soft text-up",
  split: "border-warn bg-warn/10 text-warn",
  ipo: "border-purple bg-purple/10 text-purple",
  insider: "border-pink bg-pink/10 text-pink",
  sec: "border-text-secondary bg-bg-3 text-text-secondary",
  news: "border-cyan bg-cyan/10 text-cyan",
  press: "border-cyan bg-cyan/10 text-cyan",
  economic: "border-accent-2 bg-accent-2/10 text-accent-2",
  generic: "border-border bg-bg-2 text-text-secondary",
};

export function Timeline({ events, className, onEventClick }: Props) {
  if (events.length === 0) {
    return (
      <div className={cn("py-8 text-center text-sm text-text-tertiary", className)}>
        暂无事件数据
      </div>
    );
  }

  // Sort by date descending (newest first)
  const sortedEvents = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className={cn("relative", className)}>
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border-soft" />

      <div className="space-y-4">
        {sortedEvents.map((event, index) => (
          <TimelineItem
            key={event.id}
            event={event}
            isLast={index === sortedEvents.length - 1}
            onClick={() => onEventClick?.(event)}
          />
        ))}
      </div>
    </div>
  );
}

function TimelineItem({
  event,
  isLast,
  onClick,
}: {
  event: TimelineEvent;
  isLast: boolean;
  onClick?: () => void;
}) {
  const hasChange = event.change !== undefined && event.change !== null;
  const isPositive = hasChange && event.change > 0;
  const isNegative = hasChange && event.change < 0;

  const content = (
    <>
      {/* Icon/dot */}
      <div
        className={cn(
          "absolute left-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm",
          EVENT_COLORS[event.type]
        )}
      >
        {EVENT_ICONS[event.type]}
      </div>

      {/* Content */}
      <div className="ml-12 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-text-tertiary">{fmtDay(event.date)}</span>
          {event.symbol && (
            <span className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-xs text-text-secondary">
              {event.symbol}
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-2xs uppercase tracking-wider",
              EVENT_COLORS[event.type]
            )}
          >
            {event.type}
          </span>
        </div>

        <div className="mt-1 text-sm font-medium text-text-primary">{event.title}</div>

        {event.description && (
          <div className="mt-0.5 text-xs text-text-secondary">{event.description}</div>
        )}

        {(event.value || hasChange) && (
          <div className="mt-1 flex items-center gap-2">
            {event.value && (
              <span className="font-mono text-xs text-text-secondary">{event.value}</span>
            )}
            {hasChange && (
              <span
                className={cn(
                  "font-mono text-xs",
                  isPositive ? "text-up" : isNegative ? "text-down" : "text-text-secondary"
                )}
              >
                {isPositive ? "+" : ""}
                {event.change.toFixed(2)}%
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );

  if (onClick || event.url) {
    return (
      <a
        href={event.url || "#"}
        onClick={(e) => {
          if (!event.url) {
            e.preventDefault();
            onClick?.();
          }
        }}
        className={cn(
          "relative block cursor-pointer rounded-lg transition-colors hover:bg-bg-2/50",
          !isLast && "pb-4"
        )}
      >
        {content}
      </a>
    );
  }

  return <div className={cn("relative", !isLast && "pb-4")}>{content}</div>;
}

/**
 * CompactTimeline - Horizontal compact version for dashboards
 */
interface CompactTimelineProps {
  items: Array<{
    date: string;
    label: string;
    type: EventType;
  }>;
  maxItems?: number;
}

export function CompactTimeline({ items, maxItems = 5 }: CompactTimelineProps) {
  const displayItems = items.slice(0, maxItems);

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {displayItems.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <span className="text-lg">{EVENT_ICONS[item.type]}</span>
            <span className="whitespace-nowrap text-2xs text-text-tertiary">
              {fmtDay(item.date).slice(5)}
            </span>
          </div>
          <span className="text-2xs text-text-secondary">{item.label}</span>
          {index < displayItems.length - 1 && (
            <div className="mx-1 h-px w-4 bg-border-soft" />
          )}
        </div>
      ))}
    </div>
  );
}
