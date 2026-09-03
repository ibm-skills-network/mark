import { getClientContext } from "@/lib/client-context";

describe("getClientContext", () => {
  const userAgent = (value: string) =>
    Object.defineProperty(window.navigator, "userAgent", {
      value,
      configurable: true,
    });

  afterEach(() => {
    // jsdom's default UA, restored so one case cannot leak into the next.
    userAgent(
      "Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/20.0.0",
    );
  });

  it("reports the current page URL", () => {
    expect(getClientContext().pageUrl).toBe(window.location.href);
  });

  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Chrome 141.0.0.0 on macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      "Edge 141.0.0.0 on Windows",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      "Firefox 130.0 on Linux",
    ],
  ])("summarizes %s", (ua, expected) => {
    userAgent(ua);
    expect(getClientContext().browser).toBe(expected);
  });

  it("falls back to the raw user agent for an unrecognized browser", () => {
    userAgent("SomeBot/1.0");
    expect(getClientContext().browser).toBe("SomeBot/1.0");
  });

  it("never throws when the environment cannot be read", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      get() {
        throw new Error("blocked");
      },
      configurable: true,
    });

    expect(() => getClientContext()).not.toThrow();
    expect(getClientContext()).toEqual({});
  });
});
