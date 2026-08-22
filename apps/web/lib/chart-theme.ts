/**
 * One palette for every chart in the product.
 *
 * The old series were five tints of the same orange, which is fine as a mood
 * and useless as data — nobody can tell #FFB74D from #FFCC80 in a pie slice.
 * These six separate on hue *and* lightness, so they still read apart when the
 * screen is dim, the projector is bad, or the reader is colour-blind.
 *
 * Order matters: the first colour is the signal orange, so a single-series
 * chart is on-brand, and the second is graphite, so a two-series comparison is
 * maximally legible.
 */
export const CHART_SERIES = [
  "#F97A08", // signal orange
  "#2E343D", // graphite
  "#0E8A5F", // emerald — covered, approved, positive
  "#A8480A", // burnt orange
  "#7C8593", // slate
  "#C42B1C", // red — reserved for losses and incidents
] as const;

/** Single-series fills and strokes. */
export const CHART_PRIMARY = CHART_SERIES[0];
export const CHART_SECONDARY = CHART_SERIES[1];

/** Semantic colours for charts that encode state rather than category. */
export const CHART_TONES = {
  live: "#F97A08",
  good: "#0E8A5F",
  bad: "#C42B1C",
  idle: "#AFB6C1",
} as const;

/** Axis, grid, and tooltip chrome — quiet enough to sit under the data. */
export const CHART_GRID = "#E8EAEE";
export const CHART_AXIS = "#7C8593";

export const CHART_TOOLTIP_STYLE = {
  borderRadius: "0.5rem",
  border: "1px solid #E8EAEE",
  boxShadow: "0 4px 8px -3px rgb(23 26 31 / 0.08), 0 18px 32px -14px rgb(23 26 31 / 0.22)",
  fontSize: "0.8125rem",
  color: "#171A1F",
} as const;
