/**
 * @jest-environment jsdom
 */

import { Editor } from "@tiptap/core";

import { createRichTextExtensions } from "../extensions";
import { countRichText } from "../extensions/rich-text-limits";

const editorWith = (options: {
  maxWords?: number | null;
  maxCharacters?: number | null;
  content?: string;
}) =>
  new Editor({
    element: document.createElement("div"),
    extensions: createRichTextExtensions({
      mode: "learner",
      placeholder: "",
      maxWords: options.maxWords ?? null,
      maxCharacters: options.maxCharacters ?? null,
    }),
    content: options.content ?? "<p></p>",
  });

describe("countRichText", () => {
  it("counts blocks as separated, the way the previous editor did", () => {
    const editor = editorWith({ content: "<p>one two</p><p>three</p>" });

    // "one two\nthree" — the newline is what the previous editor put between
    // blocks, so a word never runs into the next block's first word.
    expect(countRichText(editor.state.doc)).toEqual({
      characters: 13,
      words: 3,
    });
    editor.destroy();
  });

  it("ignores markup, counting only what was typed", () => {
    const editor = editorWith({
      content: "<p><strong>bold</strong> <em>text</em></p>",
    });

    expect(countRichText(editor.state.doc)).toEqual({
      characters: 9,
      words: 2,
    });
    editor.destroy();
  });

  it("counts an empty document as nothing", () => {
    const editor = editorWith({ content: "<p><br></p>" });
    expect(countRichText(editor.state.doc)).toEqual({
      characters: 0,
      words: 0,
    });
    editor.destroy();
  });
});

describe("limits block input rather than deleting after the fact", () => {
  it("refuses a keystroke that would exceed the character limit", () => {
    const editor = editorWith({ maxCharacters: 5, content: "<p>abcde</p>" });

    editor.commands.insertContentAt(6, "f");

    // The previous editor accepted the character and then removed one, so the
    // learner saw their typing flicker away. Here it simply never lands.
    expect(editor.getText()).toBe("abcde");
    editor.destroy();
  });

  it("refuses a word past the word limit", () => {
    const editor = editorWith({ maxWords: 3, content: "<p>one two three</p>" });

    editor.commands.insertContentAt(14, " four");

    expect(countRichText(editor.state.doc).words).toBe(3);
    editor.destroy();
  });

  it("still allows deletion when the content is already over the limit", () => {
    // Content saved before a limit was lowered has to stay editable; freezing
    // it would leave the learner unable to bring it back under.
    const editor = editorWith({
      maxCharacters: 3,
      content: "<p>far too long</p>",
    });

    editor.commands.setTextSelection({ from: 1, to: 5 });
    editor.commands.deleteSelection();

    expect(editor.getText()).toBe("too long");
    editor.destroy();
  });

  it("does not interfere when no limit is set", () => {
    const editor = editorWith({ content: "<p>abc</p>" });

    editor.commands.insertContentAt(4, "defghijklmnop");

    expect(editor.getText()).toBe("abcdefghijklmnop");
    editor.destroy();
  });
});
