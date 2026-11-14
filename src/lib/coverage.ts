import { FULLY_SURVEYED_SHARE } from "@/config";

/** Pure helpers for how a figure may be described, given how much of its area was surveyed. */
export function coverageShare(surveyed: number, total: number): number {
  return total > 0 ? surveyed / total : 0;
}

export function isFullySurveyed(surveyed: number, total: number): boolean {
  return total > 0 && coverageShare(surveyed, total) >= FULLY_SURVEYED_SHARE;
}

export function pct(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

export function fmtPct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/**
 * "12.5%" when the area is fully surveyed (a real rate); otherwise "at least 12.5% (reported so far)":
 * unsurveyed parcels may also be blighted, so the share is only a floor.
 */
export function blightRateLabel(blighted: number, total: number, surveyed: number): string {
  const p = fmtPct(pct(blighted, total));
  return isFullySurveyed(surveyed, total) ? p : `at least ${p} (reported so far)`;
}

export function coverageLabel(surveyed: number, total: number): string {
  return `${fmtPct(coverageShare(surveyed, total), 0)} of parcels surveyed`;
}
