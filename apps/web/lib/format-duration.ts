const UNIT_SECONDS = [
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
] as const;

/**
 * Format a duration as short localized units — "2d 3h 4m 5s" in English,
 * "2j 3h 4min 5s" in French — via `Intl.NumberFormat`, so the unit labels
 * come from the locale instead of hardcoded English suffixes. Zero-valued
 * units are dropped.
 */
export function formatShortDuration(
  totalSeconds: number,
  locale: string,
): string {
  let remaining = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];

  for (const [unit, seconds] of UNIT_SECONDS) {
    const value = Math.floor(remaining / seconds);
    remaining %= seconds;
    if (value === 0 && !(unit === "second" && parts.length === 0)) continue;

    parts.push(
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "narrow",
      }).format(value),
    );
  }

  return parts.join(" ");
}
