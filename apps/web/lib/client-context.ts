/**
 * Browser-side facts about where a report was filed from. Kept in one place so
 * the flag button, the error dialog and the chat report form all describe the
 * client the same way — previously each read `navigator.userAgent` on its own
 * and folded the result into free text.
 */

export interface ClientContext {
  /** Full URL of the page the reporter was on. */
  pageUrl?: string;
  /** Compact browser summary, e.g. "Chrome 141 on macOS". */
  browser?: string;
}

// SN Support caps the ticket's browser field at 500 characters.
const BROWSER_MAX_CHARS = 500;

function parseBrowser(ua: string): { name?: string; version?: string } {
  const pairs: [RegExp, string][] = [
    [/Edg\/([\d.]+)/i, "Edge"],
    [/Chrome\/([\d.]+)/i, "Chrome"],
    [/Version\/([\d.]+).*Safari/i, "Safari"],
    [/Firefox\/([\d.]+)/i, "Firefox"],
  ];

  for (const [pattern, name] of pairs) {
    const match = ua.match(pattern);
    if (match) return { name, version: match[1] };
  }
  return {};
}

function getOS(ua: string): string | undefined {
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS/iPadOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  return undefined;
}

/**
 * "Chrome 141 on macOS" where the browser is recognizable, otherwise the raw
 * user-agent string, which is still better than nothing on a support ticket.
 */
function describeBrowser(): string | undefined {
  const uaData = (navigator as any).userAgentData;
  const ua = navigator.userAgent ?? "";

  const { name, version } = uaData?.brands?.[0]
    ? { name: uaData.brands[0].brand, version: uaData.brands[0].version }
    : parseBrowser(ua);
  const os = uaData?.platform || getOS(ua);

  const described = [name, version].filter(Boolean).join(" ");
  const summary = described
    ? [described, os].filter(Boolean).join(" on ")
    : ua.trim();

  return summary ? summary.slice(0, BROWSER_MAX_CHARS) : undefined;
}

/**
 * Never throws and is safe to call during SSR, where it returns an empty
 * context — a report must not fail because the environment could not be read.
 */
export function getClientContext(): ClientContext {
  if (typeof window === "undefined") return {};

  try {
    return {
      pageUrl: window.location.href || undefined,
      browser: describeBrowser(),
    };
  } catch {
    return {};
  }
}
