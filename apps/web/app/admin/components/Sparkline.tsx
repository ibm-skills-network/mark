"use client";

/**
 * Dependency-free inline-SVG sparkline. Renders a small polyline of the given
 * numeric series, scaled to fit. No external charting library — this keeps the
 * admin bundle lean and the component trivially testable.
 */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  className,
  strokeClassName = "stroke-current",
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeClassName?: string;
  label?: string;
}) {
  const points = buildPoints(values, width, height);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? "sparkline"}
      className={className}
      preserveAspectRatio="none"
    >
      {points ? (
        <polyline
          points={points}
          fill="none"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className={strokeClassName}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

function buildPoints(
  values: number[],
  width: number,
  height: number,
): string | null {
  const finite = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0) return null;
  if (finite.length === 1) {
    // A single sample renders as a flat line across the middle.
    const y = (height / 2).toFixed(2);
    return `0,${y} ${width},${y}`;
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const stepX = width / (finite.length - 1);
  // Inset by 1px top/bottom so the stroke isn't clipped at the edges.
  const usableHeight = height - 2;

  return finite
    .map((value, index) => {
      const x = index * stepX;
      const normalized = (value - min) / span;
      const y = height - 1 - normalized * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
