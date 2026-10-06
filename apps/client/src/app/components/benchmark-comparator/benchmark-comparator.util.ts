export type AnalyticsChartMode = 'GAIN_LOSS' | 'PERFORMANCE' | 'TOTAL_VALUE';

export function toAnalyticsChartValue(
  value: number | undefined,
  chartMode: AnalyticsChartMode
) {
  if (value === undefined) return null;
  return chartMode === 'PERFORMANCE' ? value * 100 : value;
}
