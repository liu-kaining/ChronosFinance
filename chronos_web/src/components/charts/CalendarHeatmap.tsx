/**
 * CalendarHeatmap - Event density calendar visualization
 * Shows event frequency/intensity over a calendar year
 */

import ReactECharts from "echarts-for-react";
import { COLORS, echartsBase, toRgba } from "@/lib/theme";

interface CalendarDataPoint {
  date: string; // YYYY-MM-DD
  value: number;
  events?: string[];
}

interface Props {
  data: CalendarDataPoint[];
  year?: number;
  height?: number;
  colorRange?: [string, string];
  onDateClick?: (date: string) => void;
}

export function CalendarHeatmap({
  data,
  year = new Date().getFullYear(),
  height = 180,
  colorRange = [toRgba(COLORS.accent, 0.12), toRgba(COLORS.up, 0.85)],
  onDateClick,
}: Props) {
  const values = data.map((d) => d.value);
  const maxValue = Math.max(...values, 1);

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      position: "top",
      formatter: (params: { data: [string, number] }) => {
        const date = params.data[0];
        const value = params.data[1];
        return `<b>${date}</b><br/>事件数: ${value}`;
      },
    },
    visualMap: {
      min: 0,
      max: maxValue,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 12,
      itemHeight: 80,
      textStyle: { color: COLORS.text1, fontSize: 10 },
      inRange: {
        color: colorRange,
      },
    },
    calendar: {
      top: 30,
      left: 30,
      right: 10,
      cellSize: ["auto", 13],
      range: String(year),
      itemStyle: {
        // Zero-value cells: keep visible neutral background instead of black.
        color: toRgba(COLORS.borderSoft, 0.25),
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
      },
      yearLabel: { show: false },
      dayLabel: {
        color: COLORS.text1,
        fontSize: 10,
        firstDay: 1,
        nameMap: ["日", "一", "二", "三", "四", "五", "六"],
      },
      monthLabel: {
        color: COLORS.text1,
        fontSize: 10,
      },
      splitLine: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: data.map((d) => [d.date, d.value]),
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height }}
      onEvents={{
        click: (params: { data?: [string, number] }) => {
          const date = params.data?.[0];
          if (date) onDateClick?.(date);
        },
      }}
    />
  );
}

/**
 * MiniCalendar - Compact month view for dashboards
 */
interface MiniCalendarProps {
  month: number; // 0-11
  year?: number;
  data: Array<{ date: string; count: number; highlight?: boolean }>;
  onDateClick?: (date: string) => void;
}

export function MiniCalendar({ month, year = new Date().getFullYear(), data, onDateClick }: MiniCalendarProps) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const dataMap = new Map(data.map((d) => [d.date, d]));

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
  const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

  return (
    <div className="w-full max-w-[280px]">
      <div className="mb-2 text-center text-sm font-medium text-text-primary">
        {year}年{monthNames[month]}
      </div>
      <div className="grid grid-cols-7 gap-px rounded-md border border-border-soft bg-border-soft">
        {weekDays.map((day) => (
          <div key={day} className="bg-bg-2 py-1 text-center text-2xs text-text-tertiary">
            {day}
          </div>
        ))}
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`empty-${i}`} className="bg-bg-2 py-2" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayData = dataMap.get(dateStr);
          const hasEvents = dayData && dayData.count > 0;

          return (
            <button
              key={day}
              type="button"
              onClick={() => onDateClick?.(dateStr)}
              className={`
                relative bg-bg-2 py-2 text-center text-xs transition-colors hover:bg-bg-3
                ${hasEvents ? "font-medium text-up" : "text-text-secondary"}
                ${dayData?.highlight ? "bg-accent/10 text-accent" : ""}
              `}
            >
              {day}
              {hasEvents && (
                <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-up" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
