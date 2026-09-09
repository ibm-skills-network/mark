export interface ClientContext {
  pageUrl?: string;
  browser?: string;
}

/** Collect browser facts without making report submission depend on them. */
export function getClientContext(): ClientContext {
  if (typeof window === "undefined") return {};

  try {
    return {
      pageUrl: window.location.href || undefined,
      // The raw UA retains browser/OS details and avoids guessing from the
      // intentionally randomized userAgentData brand list.
      browser: navigator.userAgent?.trim().slice(0, 500) || undefined,
    };
  } catch {
    return {};
  }
}
