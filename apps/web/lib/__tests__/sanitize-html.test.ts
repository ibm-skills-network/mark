/**
 * @jest-environment jsdom
 */

import { sanitizeHtml } from "@/lib/sanitize-html";

describe("sanitizeHtml", () => {
  it("removes a frame nested inside other content and keeps the text around it", () => {
    const result = sanitizeHtml(
      "<div><blockquote>quoted " +
        '<iframe src="https://evil.example/a"></iframe> tail</blockquote>' +
        "<p>after</p></div>",
    );

    expect(result).not.toContain("evil.example");
    expect(result).toContain("quoted");
    expect(result).toContain("tail");
    expect(result).toContain("after");
  });

  it("keeps a video embed and confines it", () => {
    const result = sanitizeHtml(
      '<iframe class="ql-video" src="https://player.vimeo.com/video/1"></iframe>',
    );

    expect(result).toContain("player.vimeo.com");
    expect(result).toContain("sandbox");
    expect(result).toContain('referrerpolicy="no-referrer"');
  });

  it.each([
    ["relative", '<iframe src="/internal"></iframe>'],
    ["protocol-relative", '<iframe src="//www.youtube.com/embed/x"></iframe>'],
    ["plain http", '<iframe src="http://www.youtube.com/embed/x"></iframe>'],
    ["absent", "<iframe></iframe>"],
    [
      "a suffix of an allowed host",
      '<iframe src="https://www.youtube.com.evil.example/x"></iframe>',
    ],
    [
      "an allowed host in the query only",
      '<iframe src="https://evil.example/?x=www.youtube.com"></iframe>',
    ],
    [
      "an allowed host in the userinfo",
      '<iframe src="https://www.youtube.com@evil.example/x"></iframe>',
    ],
  ])("drops a frame whose source is %s", (_name, html) => {
    expect(sanitizeHtml(html)).not.toContain("iframe");
  });
});
