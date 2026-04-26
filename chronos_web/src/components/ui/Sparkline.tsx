/**
 * Sparkline - Mini trend chart for compact UI spaces
 * Shows trend over time without axes or labels
 */

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
}

export function Sparkline({
  data,
  width = 60,
  height = 20,
  color = "#26a69a",
  fillOpacity = 0.2,
  className = "",
}: Props) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#5d606b"
          strokeWidth={1}
          strokeDasharray="2,2"
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;

  // Create fill path (close the area)
  const fillPathD = `${pathD} L ${padding + chartWidth},${padding + chartHeight} L ${padding},${padding + chartHeight} Z`;

  return (
    <svg width={width} height={height} className={className}>
      {/* Area fill */}
      <path d={fillPathD} fill={color} fillOpacity={fillOpacity} />
      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * SparklineBar - Mini bar chart variant
 */
interface BarProps {
  data: number[];
  width?: number;
  height?: number;
  positiveColor?: string;
  negativeColor?: string;
  className?: string;
}

export function SparklineBar({
  data,
  width = 60,
  height = 20,
  positiveColor = "#26a69a",
  negativeColor = "#ef5350",
  className = "",
}: BarProps) {
  if (data.length === 0) {
    return <svg width={width} height={height} className={className} />;
  }

  const barWidth = width / data.length;
  const max = Math.max(...data.map(Math.abs));
  const scale = max > 0 ? (height - 4) / max : 1;

  return (
    <svg width={width} height={height} className={className}>
      {data.map((value, index) => {
        const barHeight = Math.abs(value) * scale;
        const x = index * barWidth + 1;
        const y = value >= 0 ? height / 2 - barHeight : height / 2;
        const color = value >= 0 ? positiveColor : negativeColor;

        return (
          <rect
            key={index}
            x={x}
            y={y}
            width={Math.max(1, barWidth - 2)}
            height={Math.max(1, barHeight)}
            fill={color}
            rx={1}
          />
        );
      })}
    </svg>
  );
}
