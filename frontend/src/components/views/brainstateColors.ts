/**
 * Standard brainstate color palette.
 *
 * The overlay variants use low alpha for background bands on timeseries/navigator.
 * The solid variants are used for the hypnogram strip chart.
 */

export const BRAINSTATE_OVERLAY_COLORS: Record<string, string> = {
  wake: "rgba(255, 200, 50, 0.15)",
  theta: "rgba(50, 200, 150, 0.12)",
  alpha: "rgba(50, 150, 255, 0.12)",
  beta: "rgba(255, 80, 80, 0.12)",
  NREM: "rgba(50, 150, 255, 0.12)",
  REM: "rgba(255, 80, 80, 0.12)",
  unknown: "rgba(128, 128, 128, 0.08)",
};

export const BRAINSTATE_SOLID_COLORS: Record<string, string> = {
  wake: "#ffc832",
  theta: "#32c896",
  alpha: "#3296ff",
  beta: "#ff5050",
  NREM: "#3296ff",
  REM: "#ff5050",
  unknown: "#808080",
};

/** Standard ordering of states for the Y axis of the hypnogram (top to bottom). */
export const HYPNOGRAM_STATE_ORDER = ["wake", "beta", "alpha", "theta", "NREM", "REM", "unknown"];

export function getOverlayColor(state: string): string {
  return BRAINSTATE_OVERLAY_COLORS[state] ?? BRAINSTATE_OVERLAY_COLORS.unknown;
}

export function getSolidColor(state: string): string {
  return BRAINSTATE_SOLID_COLORS[state] ?? BRAINSTATE_SOLID_COLORS.unknown;
}
