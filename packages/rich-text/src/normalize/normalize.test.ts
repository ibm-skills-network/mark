import { FIXTURES } from "../__fixtures__";
import { normalizeQuillHtml } from "./index";
import { jsdomParseFragment } from "./test-parser";

const run = (html: string) =>
  normalizeQuillHtml(html, { parse: jsdomParseFragment });

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("lists", () => {
  it("turns items marked as bullets into a real bulleted list", () => {
    const { html, rulesFired } = run(FIXTURES.bulletsAsOrderedList);

    expect(html).toContain("<ul>");
    expect(html).not.toContain("<ol>");
    expect(html).not.toContain("data-list");
    expect(html).not.toContain("ql-ui");
    expect(rulesFired).toContain("lists");
  });

  it("keeps an ordered list ordered", () => {
    const { html } = run(FIXTURES.orderedList);

    expect(html).toContain("<ol>");
    expect(html).not.toContain("<ul>");
  });

  it("splits a list that mixes both kinds into sibling lists", () => {
    const { html } = run(FIXTURES.mixedList);

    expect(html).toBe(
      '<ol><li>One</li></ol><ul><li>Bullet</li></ul><ol start="2"><li>Two</li></ol>',
    );
  });

  it("turns an indent class into a genuinely nested list", () => {
    const { html } = run(FIXTURES.indentedList);

    expect(html).not.toContain("ql-indent");

    expect(html).toContain(
      "<li>Question 1: Upload your notebook.<ul><li>1.1: Notebook uploaded.</li>",
    );
    expect(html).toContain("<li>1.2: Complete Question 1.</li></ul></li>");
  });

  it("keeps every list item's text", () => {
    for (const fixture of [
      FIXTURES.bulletsAsOrderedList,
      FIXTURES.indentedList,
      FIXTURES.mixedList,
    ]) {
      expect(textOf(run(fixture).html)).toBe(textOf(fixture));
    }
  });

  it("preserves a checklist's checked state", () => {
    const { warnings, html } = run(
      '<ol><li data-list="checked">Done</li></ol>',
    );

    expect(warnings).toEqual([]);
    expect(html).toContain('<ul><li data-checked="true">Done</li></ul>');
  });

  it("preserves a leading indentation and level jumps without inventing text", () => {
    const source =
      '<ol><li data-list="ordered" class="ql-indent-2">First</li><li data-list="ordered" class="ql-indent-2">Second</li><li data-list="ordered" class="ql-indent-5">Deep</li></ol>';
    const result = run(source);
    expect(result.html).toContain('type="i"');
    expect(result.html.match(/data-indent="2"/g)).toHaveLength(3);
    expect(textOf(result.html)).toBe(textOf(source));
    expect(run(result.html).changes).toBe(0);
  });
});

describe("code blocks", () => {
  it("joins per-line divs into one code block and drops the dropdown", () => {
    const { html } = run(FIXTURES.codeBlock);

    expect(html).toContain("<pre><code>");
    expect(html).not.toContain("ql-code-block");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<option");

    expect(html.match(/\n/g) ?? []).toHaveLength(1);
  });

  it("preserves escaped markup inside the source", () => {
    const { html } = run(FIXTURES.codeBlock);

    expect(html).toContain("&lt;li&gt;");
    expect(html).not.toContain("<li>");
  });

  it("preserves leading indentation", () => {
    const { html } = run(FIXTURES.codeBlock);
    expect(html).toContain("\n                        (p, n)");
  });

  it("carries a real language through as a class", () => {
    const { html } = run(FIXTURES.codeBlockWithLanguage);
    expect(html).toContain('<code class="language-python">');
  });

  it("does not write 'plain' as a language", () => {
    const { html } = run(FIXTURES.codeBlock);
    expect(html).not.toContain("language-plain");
    expect(html).toContain("<pre><code>");
  });

  it("converts the first-generation code block too", () => {
    const { html } = run(FIXTURES.legacyCodeBlock);

    expect(html).toContain("<pre><code>print(1)");
    expect(html).not.toContain("ql-syntax");
  });
});

describe("inline colours", () => {
  it("moves a colour off <strong> onto a span the editor can read", () => {
    const { html } = run(FIXTURES.colorsOnStrong);

    expect(html).toContain(
      '<strong><span style="color: rgb(255, 0, 0); background-color: rgb(238, 238, 238)">3 questions</span></strong>',
    );
  });

  it("drops colours that mean 'no colour' and unwraps what is left", () => {
    const { html } = run(FIXTURES.colorsOnStrong);

    expect(html).not.toContain("windowtext");
    expect(html).not.toContain("transparent");

    expect(html).toContain("The <strong>final project</strong> consists of ");
  });

  it("leaves a colour already on a span alone", () => {
    const source = '<p><span style="color: rgb(1, 2, 3)">hi</span></p>';
    expect(run(source).changes).toBe(0);
  });

  it("keeps non-colour styles where they are", () => {
    const { html } = run('<p style="text-align: center">hi</p>');
    expect(html).toContain('style="text-align: center"');
  });
});

describe("embeds and tables", () => {
  it("drops the marker class from a video embed but keeps the frame", () => {
    const { html } = run(FIXTURES.video);

    expect(html).toContain("<iframe");
    expect(html).toContain("youtube.com/embed/5BlARhT2t4Q");
    expect(html).not.toContain("ql-video");
  });

  it("removes table bookkeeping attributes without touching the cells", () => {
    const { html } = run(FIXTURES.table);

    expect(html).not.toContain("data-row");
    expect(textOf(html)).toBe("AspectStateHooks");
  });
});

describe("idempotency", () => {
  const all = Object.entries(FIXTURES);

  it.each(all)("running %s twice matches running it once", (_name, source) => {
    const once = run(source).html;
    const twice = run(once).html;
    expect(twice).toBe(once);
  });

  it.each(all)(
    "reports no changes on the second pass of %s",
    (_name, source) => {
      const once = run(source).html;
      expect(run(once).changes).toBe(0);
    },
  );

  it("leaves already-migrated content byte-identical", () => {
    const result = run(FIXTURES.alreadyMigrated);

    expect(result.changes).toBe(0);
    expect(result.html).toBe(FIXTURES.alreadyMigrated);
    expect(result.rulesFired).toEqual([]);
  });

  it("returns untouched content unchanged rather than re-serialised", () => {
    const source = "<p title='single quoted'>caf&eacute;</p>";
    expect(run(source).html).toBe(source);
  });
});

describe("parsing", () => {
  it("keeps content after a stray closing div", () => {
    const { html } = run(
      '<ol><li data-list="bullet">Alpha</li></ol></div><p>tail</p>',
    );

    expect(html).toBe("<ul><li>Alpha</li></ul><p>tail</p>");
  });
});

describe("empty input", () => {
  it.each([null, undefined, "", "   "])("handles %p", (value) => {
    const result = run(value as string);
    expect(result.changes).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});

describe("block indent", () => {
  it("preserves indentation from a paragraph without a warning", () => {
    const { html, warnings } = run(
      '<p class="ql-indent-1">Indented paragraph.</p>',
    );

    expect(html).toContain('data-indent="1"');
    expect(html).toContain("padding-inline-start: 3em");
    expect(warnings).toEqual([]);
    expect(run(html).changes).toBe(0);
  });

  it("keeps other classes on the same element", () => {
    const { html } = run('<p class="ql-indent-2 intro">Text</p>');
    expect(html).toContain('class="intro"');
    expect(html).toContain('data-indent="2"');
  });

  it("leaves list item indentation to the list rule", () => {
    const { html, warnings } = run(FIXTURES.indentedList);

    expect(html).not.toContain("ql-indent");
    expect(warnings).toEqual([]);
  });
});

describe("block alignment and direction", () => {
  it("preserves alignment, direction and unrelated styles and classes", () => {
    const { html } = run(
      '<p class="ql-align-center ql-direction-rtl intro" style="line-height: 2">Text</p>',
    );
    expect(html).toContain('class="intro"');
    expect(html).toContain("text-align: center");
    expect(html).toContain("line-height: 2");
    expect(html).toContain('dir="rtl"');
    expect(run(html).changes).toBe(0);
  });

  it("keeps block formatting when rebuilding a code block", () => {
    const { html } = run(
      '<div class="ql-code-block-container ql-align-right ql-indent-1"><div class="ql-code-block" data-language="python">print(1)</div></div>',
    );
    expect(html).toContain("<pre ");
    expect(html).toContain("text-align: right");
    expect(html).toContain("padding-inline-start: 3em");
    expect(html).toContain("language-python");
  });
});
