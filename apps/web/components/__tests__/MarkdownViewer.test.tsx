/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import MarkdownViewer from "../MarkdownViewer";

const mockQuillConstructor = jest.fn();

jest.mock("quill", () => ({
  __esModule: true,
  default: mockQuillConstructor,
}));

const INSTRUCTIONS_HTML =
  "<p>Complete the lab before you begin.</p>" +
  '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Review your notes.</li>' +
  '<li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Upload the workbook.</li></ol>';

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("MarkdownViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the content as static markup, without an editor instance", async () => {
    const { container } = render(
      <MarkdownViewer>{INSTRUCTIONS_HTML}</MarkdownViewer>,
    );
    await flushEffects();

    const editor = container.querySelector(".ql-snow .ql-editor");
    expect(editor).not.toBeNull();
    expect(editor?.textContent).toContain("Complete the lab before you begin.");
    expect(editor?.querySelectorAll("li")).toHaveLength(2);
    expect(mockQuillConstructor).not.toHaveBeenCalled();
  });

  it("keeps the list text when the content changes after the first paint", async () => {
    const { container, rerender } = render(
      <MarkdownViewer>{INSTRUCTIONS_HTML}</MarkdownViewer>,
    );
    await flushEffects();

    const translated = INSTRUCTIONS_HTML.replaceAll(
      "Review your notes.",
      "Revisa tus notas.",
    ).replaceAll("Upload the workbook.", "Sube el libro de trabajo.");

    rerender(<MarkdownViewer>{translated}</MarkdownViewer>);
    await flushEffects();

    const editor = container.querySelector(".ql-editor");
    const listItems = [...(editor?.querySelectorAll("li") ?? [])];

    expect(listItems).toHaveLength(2);
    expect(listItems.map((li) => li.textContent?.trim())).toEqual([
      "Revisa tus notas.",
      "Sube el libro de trabajo.",
    ]);
  });

  it("strips active content before writing untrusted HTML to the DOM", async () => {
    const { container } = render(
      <MarkdownViewer>
        {'<p>safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'}
      </MarkdownViewer>,
    );
    await flushEffects();

    const html = container.querySelector(".ql-editor")?.innerHTML ?? "";
    expect(html).toContain("safe");
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<script/i);
  });

  it("adds the list marker element when stored markup omits it", async () => {
    const { container } = render(
      <MarkdownViewer>
        {'<ol><li data-list="bullet">bare item</li></ol>'}
      </MarkdownViewer>,
    );
    await flushEffects();

    const item = container.querySelector("li[data-list='bullet']");
    expect(item?.firstElementChild?.className).toContain("ql-ui");
    expect(item?.textContent).toContain("bare item");
  });

  it("does not duplicate a list marker that is already stored", async () => {
    const { container } = render(
      <MarkdownViewer>{INSTRUCTIONS_HTML}</MarkdownViewer>,
    );
    await flushEffects();

    expect(container.querySelectorAll(".ql-ui")).toHaveLength(2);
  });

  it("syntax-highlights code blocks", async () => {
    const { container } = render(
      <MarkdownViewer>
        {
          '<div class="ql-code-block-container"><div class="ql-code-block" data-language="python">value = 1</div></div>'
        }
      </MarkdownViewer>,
    );

    await waitFor(() => {
      expect(
        container.querySelector(".ql-code-block")?.innerHTML ?? "",
      ).toContain("hljs-");
    });
  });

  it("renders nothing for empty content instead of the string 'undefined'", async () => {
    const { container } = render(<MarkdownViewer>{undefined}</MarkdownViewer>);
    await flushEffects();

    expect(container.querySelector(".ql-editor")?.textContent).toBe("");
  });
});
