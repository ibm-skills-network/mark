/** @jest-environment jsdom */

import { Editor } from "@tiptap/core";

import { createRichTextExtensions } from "../extensions";

const newEditor = () =>
  new Editor({
    extensions: createRichTextExtensions({ mode: "learner", placeholder: "" }),
    content: "<p></p>",
  });

const pasted = (text: string) => {
  const editor = newEditor();
  editor.commands.insertContent(text, { applyPasteRules: true });
  const html = editor.getHTML();
  editor.destroy();
  return html;
};

const typed = (text: string) => {
  const editor = newEditor();
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

const codeSamples = [
  'if __name__ == "__main__":',
  "obj.__init__ and __dict__",
  "x = a * b * c",
  "say _hi_ there",
  "def f(*args, **kwargs): return self._private + snake_case_names",
];

describe("markdown shortcuts leave pasted and typed code intact", () => {
  it.each(codeSamples)("paste keeps %s", (text) => {
    const html = pasted(text);
    expect(html).not.toMatch(/<(strong|em)>/);
    expect(html).toBe(`<p>${text}</p>`);
  });

  it.each(codeSamples)("typing keeps %s", (text) => {
    const html = typed(text);
    expect(html).not.toMatch(/<(strong|em)>/);
  });

  it("still bolds typed **text**", () => {
    expect(typed("make **this** bold")).toContain("<strong>this</strong>");
  });
});
