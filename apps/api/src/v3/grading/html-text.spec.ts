import { htmlToMarkdown } from "./html-text";

describe("htmlToMarkdown", () => {
  it("keeps numbered paragraphs as separate paragraphs", () => {
    expect(htmlToMarkdown("<p>1. Python</p><p>2. R</p>")).toBe(
      "1. Python\n\n2. R",
    );
  });

  it("numbers ordered lists and bullets unordered ones, nesting by indent", () => {
    expect(
      htmlToMarkdown(
        "<p>Languages:</p><ol><li>Python<ul><li>pandas</li><li>numpy</li></ul></li><li>R</li></ol><p>Done</p>",
      ),
    ).toBe("Languages:\n\n1. Python\n  - pandas\n  - numpy\n2. R\n\nDone");
  });

  it("honours an ordered list's start and paragraphs inside items", () => {
    expect(
      htmlToMarkdown(
        '<ol start="3"><li><p>three</p></li><li><p>four</p></li></ol>',
      ),
    ).toBe("3. three\n4. four");
  });

  it("turns headings, bold, italic and inline code into Markdown", () => {
    expect(
      htmlToMarkdown(
        "<h2>Method</h2><p>I used <strong>binary</strong> <em>search</em> via <code>bisect()</code>.</p>",
      ),
    ).toBe("## Method\n\nI used **binary** *search* via `bisect()`.");
  });

  it("keeps code blocks verbatim in fences", () => {
    expect(
      htmlToMarkdown(
        "<p>Code:</p><pre><code>for i in range(3):\n    print(i &lt; 2)</code></pre><p>end</p>",
      ),
    ).toBe("Code:\n\n```\nfor i in range(3):\n    print(i < 2)\n```\n\nend");
  });

  it("writes links as text (url), and a bare link once", () => {
    expect(
      htmlToMarkdown(
        '<p>See <a href="https://github.com/a/b">my repo</a> and <a href="https://x.io">https://x.io</a></p>',
      ),
    ).toBe("See my repo (https://github.com/a/b) and https://x.io");
  });

  it("keeps line breaks, decodes entities and drops scripts", () => {
    expect(
      htmlToMarkdown(
        "<div>a &amp; b<br>c&nbsp;d</div><script>alert(1)</script><p>e</p>",
      ),
    ).toBe("a & b\nc d\n\ne");
  });

  it("leaves things that are not HTML tags as text", () => {
    expect(htmlToMarkdown("<p>Use List<String> here</p>")).toBe(
      "Use List<String> here",
    );
  });

  it("renders table rows one per line", () => {
    expect(
      htmlToMarkdown(
        "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
      ),
    ).toBe("a | b\n1 | 2");
  });
});
