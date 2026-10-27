import { describe, expect, it } from "vitest";
import { deriveLmsHost } from "../../src/modules/session-meta/lms-host.js";

describe("deriveLmsHost", () => {
  it.each([
    [5],
    [null],
    [undefined],
    [""],
    ["  "],
    ["not a url"],
    ["javascript:alert(1)"],
    ["ftp://h.org"],
  ])("gives no host for %j", (value) => {
    expect(deriveLmsHost(value)).toBeUndefined();
  });

  it("lowercases and strips one www prefix", () => {
    expect(deriveLmsHost("HTTPS://Www.Example.COM")).toBe("example.com");
    expect(deriveLmsHost(" http://www.www.h.org:8080/p ")).toBe("www.h.org");
    expect(deriveLmsHost("https://awww.h.org")).toBe("awww.h.org");
  });
});
