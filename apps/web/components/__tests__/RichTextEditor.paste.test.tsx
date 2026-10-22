/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import React from "react";

import RichTextEditor, {
  type RichTextEditorProps,
} from "../rich-text/RichTextEditor";

const learnerAnswer = {
  toolbarMode: "learner",
  disableListAutofill: true,
  blockImages: true,
  disablePasteRules: true,
  onImageBlocked: jest.fn(),
} as const;

async function renderEditor(props: Partial<RichTextEditorProps> = {}) {
  const setValue = jest.fn();
  render(<RichTextEditor value="" setValue={setValue} {...props} />);
  await waitFor(() =>
    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument(),
  );
  const { editor } =
    screen.getByTestId<TiptapEditorHTMLElement>("rich-text-editor");
  return { editor, setValue };
}

function paste(text: string, html = "") {
  fireEvent.paste(screen.getByTestId("rich-text-editor"), {
    clipboardData: {
      files: [],
      types: html ? ["text/html", "text/plain"] : ["text/plain"],
      getData: (format: string) =>
        format === "text/html" ? html : format === "text/plain" ? text : "",
    },
  });
}

describe("RichTextEditor paste in learner answers", () => {
  it.each([
    ["plain text", ""],
    ["HTML", '<p>if __name__ == "__main__":</p>'],
  ])("keeps __name__ literal when pasted as %s", async (_, html) => {
    const { editor, setValue } = await renderEditor(learnerAnswer);
    paste('if __name__ == "__main__":', html);
    expect(editor.getHTML()).toBe('<p>if __name__ == "__main__":</p>');
    expect(setValue.mock.calls.at(-1)?.[0]).toBe(
      '<p>if __name__ == "__main__":</p>',
    );
  });

  it.each([
    "obj.__init__ and __dict__",
    "x = a * b * c",
    "say _hi_ there",
    "def f(*args, **kwargs): return a ** b ** c",
    "make **this** bold",
    "const s = `hi ${name}`;",
    "run `ls -la` now",
    "y = ~~x + ~~z",
    "a ~~b~~ c",
  ])("keeps %s literal", async (code) => {
    const { editor } = await renderEditor(learnerAnswer);
    paste(code);
    expect(editor.getHTML()).toBe(`<p>${code}</p>`);
  });

  it("keeps the indentation of pasted lines", async () => {
    const code =
      'def main():\n    for i in range(3):\n\tif __name__ == "__main__":\n        print(i)';
    const { editor, setValue } = await renderEditor(learnerAnswer);
    paste(code);
    expect(editor.getText({ blockSeparator: "\n" })).toBe(code);
    expect(setValue.mock.calls.at(-1)?.[0]).toBe(
      '<p>def main():</p><p>    for i in range(3):</p><p>\tif __name__ == "__main__":</p><p>        print(i)</p>',
    );
  });

  it("keeps the indentation of code pasted as preformatted HTML", async () => {
    const { editor } = await renderEditor(learnerAnswer);
    paste(
      'def main():\n    if __name__ == "__main__":\n\t\treturn 1',
      '<div style="white-space: pre;"><div><span>def main():</span></div><div><span>    if __name__ == "__main__":</span></div><div><span>\t\treturn 1</span></div></div>',
    );
    expect(editor.getHTML()).toBe(
      '<p>def main():</p><p>    if __name__ == "__main__":</p><p>\t\treturn 1</p>',
    );
  });
});

describe("RichTextEditor paste in author editors", () => {
  it.each([
    ["the full toolbar", {}],
    ["the learner toolbar", { toolbarMode: "learner" as const }],
  ])("still formats pasted markdown with %s", async (_, props) => {
    const { editor } = await renderEditor(props);
    paste("run `ls -la` now");
    expect(editor.getHTML()).toBe("<p>run <code>ls -la</code> now</p>");
  });
});
