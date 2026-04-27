export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtCap(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${fmtNum(value / 1e12, digits)}T`;
  if (abs >= 1e9) return `${fmtNum(value / 1e9, digits)}B`;
  if (abs >= 1e6) return `${fmtNum(value / 1e6, digits)}M`;
  if (abs >= 1e3) return `${fmtNum(value / 1e3, digits)}K`;
  return fmtNum(value, digits);
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${fmtNum(value * 100, digits)}%`;
}

export function fmtPctSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtNum(value * 100, digits)}%`;
}

export function fmtDay(value: string | null | undefined): string {
  if (!value) return "-";
  return value;
}
