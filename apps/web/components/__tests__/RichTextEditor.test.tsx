/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import React from "react";

import {
  FULL_TOOLBAR_GROUPS,
  LEARNER_TOOLBAR_GROUPS,
} from "@/lib/rich-text/toolbar-config";

import RichTextEditor from "../rich-text/RichTextEditor";

const editableHtml = () => screen.getByTestId("rich-text-editor").innerHTML;
const mountedEditor = async (): Promise<Editor> => {
  await waitFor(() =>
    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument(),
  );
  return screen.getByTestId<TiptapEditorHTMLElement>("rich-text-editor").editor;
};

describe("RichTextEditor", () => {
  it("does not undo into a previously loaded answer", async () => {
    const setValue = jest.fn();
    const { rerender } = render(
      <RichTextEditor value="<p>first</p>" setValue={setValue} />,
    );
    const editor = await mountedEditor();
    act(() => editor.commands.insertContentAt(6, " edit"));
    rerender(<RichTextEditor value="<p>second</p>" setValue={setValue} />);
    setValue.mockClear();
    act(() => editor.commands.undo());
    expect(editor.getText()).toBe("second");
    expect(setValue).not.toHaveBeenCalled();
    act(() => editor.commands.insertContentAt(7, "!"));
    act(() => editor.commands.undo());
    expect(editor.getText()).toBe("second");
    act(() => editor.commands.redo());
    expect(editor.getText()).toBe("second!");
  });
  it("updates limits in place without losing the document or selection", async () => {
    const setValue = jest.fn();
    const { rerender } = render(
      <RichTextEditor
        value="<p>abc</p>"
        setValue={setValue}
        maxCharacters={3}
      />,
    );
    const editor = await mountedEditor();
    act(() => editor.commands.setTextSelection(4));
    rerender(
      <RichTextEditor
        value="<p>abc</p>"
        setValue={setValue}
        maxCharacters={5}
      />,
    );
    expect(await mountedEditor()).toBe(editor);
    expect(editor.state.selection.from).toBe(4);
    act(() => editor.commands.insertContent("de"));
    expect(editor.getText()).toBe("abcde");
    rerender(
      <RichTextEditor
        value={editor.getHTML()}
        setValue={setValue}
        maxCharacters={4}
      />,
    );
    act(() => editor.commands.insertContent("f"));
    expect(editor.getText()).toBe("abcde");
    act(() => editor.commands.deleteRange({ from: 4, to: 6 }));
    expect(editor.getText()).toBe("abc");
  });

  it("adds a limit after mounting an editor without one", async () => {
    const { rerender } = render(
      <RichTextEditor value="<p>abc</p>" setValue={jest.fn()} />,
    );
    const editor = await mountedEditor();
    rerender(
      <RichTextEditor
        value="<p>abc</p>"
        setValue={jest.fn()}
        maxCharacters={3}
      />,
    );
    act(() => editor.commands.insertContentAt(4, "d"));
    expect(editor.getText()).toBe("abc");
  });

  it("loads an old answer asynchronously even when focused and above the limit", async () => {
    const setValue = jest.fn();
    const { rerender } = render(
      <RichTextEditor value="" setValue={setValue} maxCharacters={3} />,
    );
    const editor = await mountedEditor();
    act(() => editor.commands.focus());
    rerender(
      <RichTextEditor
        value='<p class="ql-indent-2 ql-align-center">old saved answer</p>'
        setValue={setValue}
        maxCharacters={3}
      />,
    );
    expect(editor.getText()).toBe("old saved answer");
    expect(editor.getHTML()).toContain("padding-inline-start: 6em");
    expect(editor.getHTML()).toContain("text-align: center");
    expect(setValue).not.toHaveBeenCalled();
  });

  it("accepts a reset to the initial value after receiving its own edit", async () => {
    const setValue = jest.fn();
    const initial = "<p>initial</p>";
    const { rerender } = render(
      <RichTextEditor value={initial} setValue={setValue} />,
    );
    const editor = await mountedEditor();
    act(() => editor.commands.insertContentAt(8, " edit"));
    const emitted = setValue.mock.calls.at(-1)?.[0] as string;
    rerender(<RichTextEditor value={emitted} setValue={setValue} />);
    setValue.mockClear();
    rerender(<RichTextEditor value={initial} setValue={setValue} />);
    expect(editor.getText()).toBe("initial");
    expect(setValue).not.toHaveBeenCalled();
  });

  it("retains significant spaces when loading and explicitly editing old content", async () => {
    const setValue = jest.fn();
    render(<RichTextEditor value="<p>a   b</p>" setValue={setValue} />);
    const editor = await mountedEditor();
    expect(editor.getText()).toBe("a   b");
    act(() => editor.commands.insertContentAt(6, "!"));
    expect(setValue.mock.calls.at(-1)?.[0]).toContain("a   b!");
  });

  it("indents, aligns and clears a paragraph through the toolbar", async () => {
    render(<RichTextEditor value="<p>Text</p>" setValue={jest.fn()} />);
    const editor = await mountedEditor();
    fireEvent.click(screen.getByRole("button", { name: "Increase indent" }));
    expect(editor.getHTML()).toContain("padding-inline-start: 3em");
    fireEvent.change(screen.getByRole("combobox", { name: "Text alignment" }), {
      target: { value: "right" },
    });
    expect(editor.getHTML()).toContain("text-align: right");
    fireEvent.click(screen.getByRole("button", { name: "Right to left" }));
    expect(editor.getHTML()).toContain('dir="rtl"');
    fireEvent.click(screen.getByRole("button", { name: "Clear formatting" }));
    expect(editor.getHTML()).toBe("<p>Text</p>");
  });

  it("lets an author choose a code language and serializes it", async () => {
    render(<RichTextEditor value="<p>print(1)</p>" setValue={jest.fn()} />);
    const editor = await mountedEditor();
    fireEvent.click(screen.getByRole("button", { name: "Code block" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Code language" }), {
      target: { value: "python" },
    });
    expect(editor.getHTML()).toContain('class="language-python"');
    expect(editableHtml()).toContain("hljs-");
    fireEvent.change(screen.getByRole("combobox", { name: "Code language" }), {
      target: { value: "" },
    });
    expect(editor.getHTML()).not.toContain("language-");
  });

  it("preserves literal list markers when list autofill is disabled", async () => {
    render(
      <RichTextEditor
        value="<p>*</p>"
        setValue={jest.fn()}
        disableListAutofill
      />,
    );
    const editor = await mountedEditor();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.view.someProp("handleTextInput", (handler) =>
        handler(editor.view, 2, 2, " ", () => editor.state.tr.insertText(" ")),
      );
    });
    expect(editor.getHTML()).toBe("<p>* </p>");
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(editor.getHTML()).toContain("<ul>");
  });

  it("blocks pasted images while retaining accompanying text and notifying the caller", async () => {
    const onImageBlocked = jest.fn();
    render(
      <RichTextEditor
        value=""
        setValue={jest.fn()}
        blockImages
        onImageBlocked={onImageBlocked}
      />,
    );
    const editor = await mountedEditor();
    expect(screen.queryByRole("button", { name: "Image" })).toBeNull();
    fireEvent.paste(screen.getByTestId("rich-text-editor"), {
      clipboardData: {
        files: [new File(["png"], "image.png", { type: "image/png" })],
        getData: (format: string) =>
          format === "text/html"
            ? '<p>kept<img src="data:image/png;base64,AAAA"> text</p>'
            : format === "text/plain"
              ? "kept text"
              : "",
      },
    });
    expect(editor.getText()).toBe("kept text");
    expect(editor.getHTML()).not.toContain("<img");
    expect(onImageBlocked).toHaveBeenCalledTimes(1);
  });

  it("blocks image drops on padding even when a caret cannot be placed", async () => {
    const onImageBlocked = jest.fn();
    render(
      <RichTextEditor
        value="<p>kept</p>"
        setValue={jest.fn()}
        blockImages
        onImageBlocked={onImageBlocked}
      />,
    );
    const editor = await mountedEditor();
    fireEvent.drop(
      screen.getByTestId("rich-text-editor").closest(".rich-text-editor")!,
      {
        dataTransfer: {
          files: [new File(["png"], "image.png", { type: "image/png" })],
          getData: () => "",
        },
      },
    );
    expect(onImageBlocked).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("kept");
  });

  it("blocks images inserted by a command and removes saved images without reporting an edit", async () => {
    const setValue = jest.fn();
    const onImageBlocked = jest.fn();
    render(
      <RichTextEditor
        value='<p>kept<img src="data:image/png;base64,AAAA"></p>'
        setValue={setValue}
        blockImages
        onImageBlocked={onImageBlocked}
      />,
    );
    const editor = await mountedEditor();
    expect(editor.getHTML()).not.toContain("<img");
    expect(setValue).not.toHaveBeenCalled();
    act(() =>
      editor.commands.setImage({ src: "https://example.com/image.png" }),
    );
    expect(editor.getHTML()).not.toContain("<img");
    expect(onImageBlocked).toHaveBeenCalledTimes(1);
  });
  it("sanitizes the incoming value before it reaches the document", async () => {
    render(
      <RichTextEditor
        value={
          '<p>safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'
        }
        setValue={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    });

    expect(editableHtml()).toContain("safe");
    expect(editableHtml()).not.toMatch(/onerror/i);
    expect(editableHtml()).not.toMatch(/<script/i);
  });

  it("does not report a change for content it only loaded", async () => {
    const setValue = jest.fn();

    render(
      <RichTextEditor
        value={'<ol><li data-list="bullet">Alpha</li></ol>'}
        setValue={setValue}
      />,
    );

    await waitFor(() => {
      expect(editableHtml()).toContain("Alpha");
    });

    expect(setValue).not.toHaveBeenCalled();
  });

  it.each([
    ["full" as const, FULL_TOOLBAR_GROUPS],
    ["learner" as const, LEARNER_TOOLBAR_GROUPS],
  ])(
    "renders a control for every item configured in the %s toolbar",
    async (mode, groups) => {
      render(
        <RichTextEditor
          value="<p>x</p>"
          setValue={jest.fn()}
          toolbarMode={mode}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("toolbar")).toBeInTheDocument();
      });

      expect(
        screen.getByRole("toolbar").querySelectorAll("button, select"),
      ).toHaveLength(groups.flat().length);
    },
  );

  it("seeds the counters from the parsed text, not the raw markup", async () => {
    render(
      <RichTextEditor
        value={"<p>one two three</p>"}
        setValue={jest.fn()}
        maxWords={10}
        maxCharacters={100}
      />,
    );

    const counterText = () =>
      screen.getByTestId("rich-text-editor").closest(".rich-text-editor-shell")
        ?.textContent ?? "";

    await waitFor(() => {
      expect(counterText()).toContain("Words: 3 / 10");
    });
    expect(counterText()).toContain("Characters: 13 / 100");
  });
});
