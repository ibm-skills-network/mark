/**
 * @jest-environment jsdom
 */

import { generateHTML, generateJSON } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { normalizeQuillHtml } from "rich-text";

import { createRichTextExtensions } from "../extensions";

/**
 * The editor discards markup it has no rule for, without erroring. These tests
 * parse stored shapes into the document model and assert what survived, which
 * is the only way to see a silent drop before an author does.
 *
 * They need no layout, so they are unaffected by jsdom having none — unlike
 * mounting a real editor.
 */
const extensions = createRichTextExtensions({
  mode: "full",
  placeholder: "",
});

/** Stored content always passes through the shared rules before the editor. */
const parse = (html: string): JSONContent =>
  generateJSON(normalizeQuillHtml(html).html, extensions);

const serialize = (html: string): string =>
  generateHTML(parse(html), extensions);

/** Every node type present anywhere in the document. */
const nodeTypes = (node: JSONContent | undefined): string[] =>
  !node
    ? []
    : [
        ...(node.type ? [node.type] : []),
        ...(node.content ?? []).flatMap((child) => nodeTypes(child)),
      ];

const findNode = (node: JSONContent, type: string): JSONContent | undefined => {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
};

const textOf = (html: string) => html.replace(/<[^>]*>/g, "").trim();

describe("stored lists survive the schema", () => {
  it("keeps bullets as a bullet list rather than renumbering them", () => {
    const doc = parse(
      '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Alpha</li></ol>',
    );

    expect(nodeTypes(doc)).toContain("bulletList");
    expect(nodeTypes(doc)).not.toContain("orderedList");
  });

  it("keeps an indented item as a nested list", () => {
    const doc = parse(
      '<ol><li data-list="bullet">Parent</li>' +
        '<li data-list="bullet" class="ql-indent-1">Child</li></ol>',
    );

    const outer = findNode(doc, "bulletList");
    const item = outer?.content?.[0];
    expect(nodeTypes(item)).toContain("bulletList");
  });
});

describe("stored code blocks survive the schema", () => {
  const stored =
    '<div class="ql-code-block-container">' +
    '<div class="ql-code-block" data-language="python">value = 1</div>' +
    '<div class="ql-code-block" data-language="python">print(value)</div>' +
    "</div>";

  it("becomes a single code block holding both lines", () => {
    const block = findNode(parse(stored), "codeBlock");

    expect(block).toBeDefined();
    expect(block?.content?.[0]?.text).toBe("value = 1\nprint(value)");
  });

  it("carries the language through", () => {
    expect(findNode(parse(stored), "codeBlock")?.attrs?.language).toBe(
      "python",
    );
  });

  it("does not invent a language for an unmarked block", () => {
    const block = findNode(
      parse(
        '<div class="ql-code-block-container">' +
          '<div class="ql-code-block" data-language="plain">x</div></div>',
      ),
      "codeBlock",
    );

    expect(block?.attrs?.language ?? null).toBeNull();
  });
});

describe("colours and images survive the schema", () => {
  it("keeps a colour that was stored on <strong>", () => {
    const html = serialize(
      '<p><strong style="color: rgb(255, 0, 0)">red</strong></p>',
    );

    expect(html).toContain("color: rgb(255, 0, 0)");
    expect(html).toContain("<strong>");
  });

  it("keeps a background colour", () => {
    const html = serialize(
      '<p><span style="background-color: rgb(238, 238, 238)">hi</span></p>',
    );

    expect(html).toContain("background-color: rgb(238, 238, 238)");
  });

  it("keeps an inline data-URI image", () => {
    const source =
      '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="></p>';

    expect(findNode(parse(source), "image")?.attrs?.src).toContain(
      "data:image/png;base64",
    );
  });
});

describe("embeds, tables and scripts survive the schema", () => {
  it("keeps a video embed as a node rather than dropping the frame", () => {
    const video = findNode(
      parse(
        '<iframe class="ql-video" src="https://www.youtube.com/embed/abc123"></iframe>',
      ),
      "video",
    );

    expect(video?.attrs?.src).toBe("https://www.youtube.com/embed/abc123");
  });

  it("keeps a table and its cell text", () => {
    const source =
      '<table><tbody><tr><td data-row="1">Aspect</td>' +
      '<td data-row="1">Detail</td></tr></tbody></table>';

    expect(nodeTypes(parse(source))).toContain("table");
    expect(textOf(serialize(source))).toContain("Aspect");
  });

  it("keeps subscript and superscript", () => {
    const html = serialize("<p>H<sub>2</sub>O and x<sup>2</sup></p>");

    expect(html).toContain("<sub>");
    expect(html).toContain("<sup>");
  });
});

describe("nothing is lost across a full round trip", () => {
  const cases: [string, string][] = [
    ["a heading", "<h2>Title</h2>"],
    ["a blockquote", "<blockquote><p>Quoted</p></blockquote>"],
    ["a link", '<p><a href="https://example.com">link</a></p>'],
    ["emphasis", "<p><strong>bold</strong> and <em>italic</em></p>"],
    ["underline and strike", "<p><u>under</u> and <s>struck</s></p>"],
    ["inline code", "<p>use <code>value</code> here</p>"],
    [
      "a stored bulleted list",
      '<ol><li data-list="bullet">Alpha</li><li data-list="bullet">Beta</li></ol>',
    ],
  ];

  it.each(cases)("keeps the text of %s", (_label, source) => {
    expect(textOf(serialize(source))).toBe(textOf(source));
  });

  it("keeps an empty paragraph as a paragraph", () => {
    expect(nodeTypes(parse("<p><br></p>"))).toContain("paragraph");
  });
});
