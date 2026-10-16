/** @jest-environment jsdom */

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
  it("counts a hard break as a newline and word boundary", () => {
    const editor = editorWith({ content: "<p>one<br>two</p>" });
    expect(countRichText(editor.state.doc)).toEqual({
      characters: 7,
      words: 2,
    });
    editor.destroy();
  });

  it("does not count list and quote wrappers as extra newlines", () => {
    const editor = editorWith({
      content:
        "<ul><li><p>one</p></li><li><p>two</p></li></ul><blockquote><p>three</p></blockquote>",
    });
    expect(countRichText(editor.state.doc)).toEqual({
      characters: 13,
      words: 3,
    });
    editor.destroy();
  });
  it("counts blocks as separated, the way the previous editor did", () => {
    const editor = editorWith({ content: "<p>one two</p><p>three</p>" });

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
  it("loads an existing answer above the limit without saving or truncating it", () => {
    const editor = editorWith({ maxCharacters: 3, content: "<p>a</p>" });
    const onUpdate = jest.fn();
    editor.on("update", onUpdate);
    editor.commands.setContent("<p>old saved answer</p>", {
      emitUpdate: false,
    });
    expect(editor.getText()).toBe("old saved answer");
    expect(onUpdate).not.toHaveBeenCalled();
    editor.destroy();
  });
  it("refuses a keystroke that would exceed the character limit", () => {
    const editor = editorWith({ maxCharacters: 5, content: "<p>abcde</p>" });

    editor.commands.insertContentAt(6, "f");

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
