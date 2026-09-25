/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";

import RichTextViewer from "../rich-text/RichTextViewer";

/**
 * Markup the previous editor produced, which is what the database still holds.
 * It stored every list as `<ol>` and put the real kind on each item, so a
 * bulleted list read literally comes back numbered.
 */
const INSTRUCTIONS_HTML =
  "<p>Complete the lab before you begin.</p>" +
  '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Review your notes.</li>' +
  '<li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Upload the workbook.</li></ol>';

/**
 * A `data-list` value carrying an unescaped `>`. Sanitizing keeps it — the
 * value is inert once parsed — so anything that rewrites the sanitized string
 * with a regex could terminate the tag early and make the parked markup live.
 */
const ATTRIBUTE_BREAKOUT_HTML =
  '<li data-list="a><img src=q onerror=alert(document.domain)>b">c</li>';

const ACTIVE_ELEMENT_HTML: [string, string][] = [
  ["form", '<p>hi</p><form action="//evil.example"><span>go</span></form>'],
  ["input", '<p>hi</p><input name="u" value="steal">'],
  ["button", "<p>hi</p><button>go</button>"],
  ["textarea", "<p>hi</p><textarea>go</textarea>"],
  ["object", '<p>hi</p><object data="https://evil.example/x"></object>'],
  ["embed", '<p>hi</p><embed src="https://evil.example/x">'],
  ["iframe", '<p>hi</p><iframe src="https://evil.example/phish"></iframe>'],
];

const elementsWithEventHandlers = (root: Element | null): string[] =>
  [...(root?.querySelectorAll("*") ?? [])].flatMap((element) =>
    element
      .getAttributeNames()
      .filter((name) => name.toLowerCase().startsWith("on"))
      .map((name) => `${element.tagName.toLowerCase()}[${name}]`),
  );

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const contentOf = (container: HTMLElement) =>
  container.querySelector(".rich-text-content");

describe("RichTextViewer", () => {
  it("renders the content as static markup, without an editor instance", async () => {
    const { container } = render(
      <RichTextViewer>{INSTRUCTIONS_HTML}</RichTextViewer>,
    );
    await flushEffects();

    const content = contentOf(container);
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain(
      "Complete the lab before you begin.",
    );
    expect(content?.querySelectorAll("li")).toHaveLength(2);
    // A live editor would re-derive its own model from whatever is written
    // here and drop what it cannot map; static markup cannot.
    expect(container.querySelector(".ProseMirror")).toBeNull();
  });

  it("renders a stored bulleted list as a bulleted list, not a numbered one", async () => {
    const { container } = render(
      <RichTextViewer>{INSTRUCTIONS_HTML}</RichTextViewer>,
    );
    await flushEffects();

    const content = contentOf(container);
    expect(content?.querySelector("ul")).not.toBeNull();
    expect(content?.querySelector("ol")).toBeNull();
    // The marker span was editor furniture, not content.
    expect(content?.querySelector(".ql-ui")).toBeNull();
  });

  it("keeps the list text when the content changes after the first paint", async () => {
    const { container, rerender } = render(
      <RichTextViewer>{INSTRUCTIONS_HTML}</RichTextViewer>,
    );
    await flushEffects();

    const translated = INSTRUCTIONS_HTML.replaceAll(
      "Review your notes.",
      "Revisa tus notas.",
    ).replaceAll("Upload the workbook.", "Sube el libro de trabajo.");

    rerender(<RichTextViewer>{translated}</RichTextViewer>);
    await flushEffects();

    const items = [...(contentOf(container)?.querySelectorAll("li") ?? [])];
    expect(items.map((li) => li.textContent?.trim())).toEqual([
      "Revisa tus notas.",
      "Sube el libro de trabajo.",
    ]);
  });

  it("strips active content before writing untrusted HTML to the DOM", async () => {
    const { container } = render(
      <RichTextViewer>
        {'<p>safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'}
      </RichTextViewer>,
    );
    await flushEffects();

    const html = contentOf(container)?.innerHTML ?? "";
    expect(html).toContain("safe");
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<script/i);
  });

  it("rebuilds a stored code block and highlights it", async () => {
    const { container } = render(
      <RichTextViewer>
        {'<div class="ql-code-block-container">' +
          '<div class="ql-code-block" data-language="python">value = 1</div>' +
          '<div class="ql-code-block" data-language="python">print(value)</div>' +
          "</div>"}
      </RichTextViewer>,
    );

    await waitFor(() => {
      expect(container.querySelector("pre code")?.innerHTML ?? "").toContain(
        "hljs-",
      );
    });
    expect(container.querySelector(".ql-code-block")).toBeNull();
  });

  it("renders nothing for empty content instead of the string 'undefined'", async () => {
    const { container } = render(<RichTextViewer>{undefined}</RichTextViewer>);
    await flushEffects();

    expect(contentOf(container)?.textContent).toBe("");
  });

  it("keeps an attribute value that contains '>' from becoming live markup", async () => {
    const { container } = render(
      <RichTextViewer>{ATTRIBUTE_BREAKOUT_HTML}</RichTextViewer>,
    );
    await flushEffects();

    const content = contentOf(container);
    expect(content?.querySelector("img")).toBeNull();
    expect(elementsWithEventHandlers(content)).toEqual([]);
    expect(content?.textContent).toContain("c");
  });

  it.each(ACTIVE_ELEMENT_HTML)(
    "does not render a <%s> that arrives in the content",
    async (tag, html) => {
      const { container } = render(<RichTextViewer>{html}</RichTextViewer>);
      await flushEffects();

      const content = contentOf(container);
      expect(content?.querySelector(tag)).toBeNull();
      expect(content?.textContent).toContain("hi");
    },
  );

  it("keeps a video embed from a known host and confines it", async () => {
    const { container } = render(
      <RichTextViewer>
        {
          '<iframe class="ql-video" src="https://www.youtube.com/embed/abc123"></iframe>'
        }
      </RichTextViewer>,
    );
    await flushEffects();

    const frame = contentOf(container)?.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("prevents selection when copying is disallowed", async () => {
    const { container } = render(
      <RichTextViewer allowCopy={false}>{INSTRUCTIONS_HTML}</RichTextViewer>,
    );
    await flushEffects();

    expect(contentOf(container)?.className).toContain("select-none");
  });
});
