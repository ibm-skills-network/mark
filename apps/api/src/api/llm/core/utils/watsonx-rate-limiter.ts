import Bottleneck from "bottleneck";

export const watsonxLimiter = new Bottleneck({
  reservoir: 20,
  reservoirRefreshAmount: 20,
  reservoirRefreshInterval: 1000,
  minTime: 50,
  maxConcurrent: 5,
});

export function withWatsonxRateLimit<T>(
  function_: () => Promise<T>,
): Promise<T> {
  return watsonxLimiter.schedule(function_);
}
