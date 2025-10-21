import Bottleneck from "bottleneck";

// Global limiter for all Watsonx providers to avoid hitting per-instance limits
// IBM limit example: 40 req / 1s. We stay comfortably below.
export const watsonxLimiter = new Bottleneck({
  reservoir: 20,
  reservoirRefreshAmount: 20,
  reservoirRefreshInterval: 1000, // 1s
  minTime: 50, // ~20 rps spacing
  maxConcurrent: 5,
});

export function withWatsonxRateLimit<T>(
  function_: () => Promise<T>,
): Promise<T> {
  return watsonxLimiter.schedule(function_);
}
