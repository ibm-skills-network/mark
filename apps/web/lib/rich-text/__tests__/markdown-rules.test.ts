/** @jest-environment jsdom */

import { Editor } from "@tiptap/core";

import { createRichTextExtensions } from "../extensions";

const typed = (text: string) => {
  const editor = new Editor({
    extensions: createRichTextExtensions({ mode: "learner", placeholder: "" }),
    content: "<p></p>",
  });
  // Same path as a keystroke: input rules run from handleTextInput.
  for (const char of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, char, () =>
        view.state.tr.insertText(char, from, to),
      ),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
  const html = editor.getHTML();
  editor.destroy();
  return html;
};

describe("typing markdown shortcuts leaves code intact", () => {
  it.each([
    'if __name__ == "__main__":',
    "obj.__init__ and __dict__",
    "x = a * b * c",
    "say _hi_ there",
    "def f(*args, **kwargs): return self._private + snake_case_names",
  ])("keeps %s", (text) => {
    expect(typed(text)).toBe(`<p>${text}</p>`);
  });

  it("still bolds typed **text**", () => {
    expect(typed("make **this** bold")).toBe(
      "<p>make <strong>this</strong> bold</p>",
    );
  });
});
