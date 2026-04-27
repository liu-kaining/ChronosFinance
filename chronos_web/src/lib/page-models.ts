export interface KpiItem {
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "up" | "down" | "warn";
}

export interface DataAvailability {
  key: string;
  label: string;
  rows: number;
  available: boolean;
}

export interface SeriesPoint {
  date: string;
  value: number | null;
}
