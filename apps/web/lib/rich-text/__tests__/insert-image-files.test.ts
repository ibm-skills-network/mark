/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";

import { createRichTextExtensions } from "../extensions";
import { imageFiles, insertImageFiles } from "../insert-image-files";

const createEditor = () =>
  new Editor({
    extensions: createRichTextExtensions({ mode: "full", placeholder: "" }),
    content: "<p>before after</p>",
  });

describe("image file insertion", () => {
  it("inserts a local file inline at the selection, retaining surrounding text", async () => {
    const editor = createEditor();
    editor.commands.setTextSelection(8);
    await insertImageFiles(editor, [
      new File(["png"], "image.png", { type: "image/png" }),
    ]);
    expect(editor.getHTML()).toMatch(/^<p>before <img[^>]+>after<\/p>$/);
    expect(editor.getHTML()).toContain("data:image/png;base64,");
    editor.destroy();
  });

  it("maps the insertion point when text changes during file reading", async () => {
    const editor = createEditor();
    editor.commands.setTextSelection(8);
    const inserting = insertImageFiles(editor, [
      new File(["png"], "image.png", { type: "image/png" }),
    ]);
    editor.commands.insertContentAt(1, "prefix ");
    await inserting;
    expect(editor.getHTML()).toMatch(/^<p>prefix before <img[^>]+>after<\/p>$/);
    editor.destroy();
  });

  it("does not insert into a destroyed editor", async () => {
    const editor = createEditor();
    const inserting = insertImageFiles(editor, [
      new File(["png"], "image.png", { type: "image/png" }),
    ]);
    editor.destroy();
    await expect(inserting).resolves.toBeUndefined();
  });

  it("does not insert into another answer loaded while files are being read", async () => {
    const editor = createEditor();
    const inserting = insertImageFiles(editor, [
      new File(["png"], "image.png", { type: "image/png" }),
    ]);
    editor.commands.setContent("<p>another answer</p>", { emitUpdate: false });
    await inserting;
    expect(editor.getHTML()).toBe("<p>another answer</p>");
    editor.destroy();
  });

  it("recognizes image clipboard items when files is empty", () => {
    const file = new File(["png"], "image.png", { type: "image/png" });
    expect(
      imageFiles({
        files: [],
        items: [{ kind: "file", getAsFile: () => file }],
      } as unknown as DataTransfer),
    ).toEqual([file]);
  });
});
