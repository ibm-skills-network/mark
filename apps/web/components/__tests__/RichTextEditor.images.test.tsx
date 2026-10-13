/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import RichTextEditor from "../rich-text/RichTextEditor";

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const imageFile = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
    type: "image/png",
  });

type TransferInit = { html?: string; text?: string; files?: File[] };

function transfer({ html = "", text = "", files = [] }: TransferInit) {
  const data: Record<string, string> = {
    "text/html": html,
    "text/plain": text,
  };
  return {
    getData: (type: string) => data[type] ?? "",
    files,
    types: [
      ...(html ? ["text/html"] : []),
      ...(text ? ["text/plain"] : []),
      ...(files.length > 0 ? ["Files"] : []),
    ],
  };
}

function fire(
  target: Element,
  type: "paste" | "drop",
  init: TransferInit,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(
    event,
    type === "paste" ? "clipboardData" : "dataTransfer",
    { value: transfer(init) },
  );
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function renderEditor(
  props: Partial<React.ComponentProps<typeof RichTextEditor>> = {},
) {
  const setValue = jest.fn();
  const utils = render(
    <RichTextEditor
      value=""
      setValue={setValue}
      toolbarMode="learner"
      {...props}
    />,
  );
  await waitFor(() => {
    expect(
      utils.container.querySelector('[data-testid="rich-text-editor"]'),
    ).toBeInTheDocument();
  });
  const editor = utils.container.querySelector<TiptapEditorHTMLElement>(
    '[data-testid="rich-text-editor"]',
  )!.editor;
  act(() => {
    editor.commands.setTextSelection(1);
  });
  return { ...utils, editor, setValue };
}

const lastValue = (setValue: jest.Mock): string =>
  (setValue.mock.calls.at(-1)?.[0] as string | undefined) ?? "";

describe("RichTextEditor with images blocked (learner text answers)", () => {
  it("drops pasted <img> from HTML but keeps the pasted text", async () => {
    const onImageBlocked = jest.fn();
    const { editor, setValue } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    fire(editor.view.dom, "paste", {
      html: `<p>total 42</p><img src="${PNG_DATA_URI}"><p>done</p>`,
      text: "total 42\ndone",
    });

    await waitFor(() => expect(editor.getText()).toContain("done"));
    expect(editor.getHTML()).not.toMatch(/<img/i);
    expect(editor.getText()).toContain("total 42");
    expect(onImageBlocked).toHaveBeenCalled();
    expect(lastValue(setValue)).not.toMatch(/<img|data:image/i);
    expect(lastValue(setValue)).toContain("total 42");
  });

  it("blocks a pasted screenshot (clipboard image file only)", async () => {
    const onImageBlocked = jest.fn();
    const { editor } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    fire(editor.view.dom, "paste", { files: [imageFile()] });

    expect(onImageBlocked).toHaveBeenCalled();
    expect(editor.getHTML()).not.toMatch(/<img/i);
  });

  it("keeps the text when a paste carries both an image file and plain text", async () => {
    const onImageBlocked = jest.fn();
    const { editor } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    fire(editor.view.dom, "paste", {
      text: "$ ls\nREADME.md",
      files: [imageFile()],
    });

    expect(onImageBlocked).toHaveBeenCalled();
    expect(editor.getHTML()).not.toMatch(/<img/i);
    expect(editor.getText()).toContain("README.md");
  });

  it("blocks a dropped image file", async () => {
    const onImageBlocked = jest.fn();
    const { editor } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    const event = fire(editor.view.dom, "drop", { files: [imageFile()] });

    expect(event.defaultPrevented).toBe(true);
    expect(onImageBlocked).toHaveBeenCalled();
    expect(editor.getHTML()).not.toMatch(/<img/i);
  });

  it("removes an image that reaches the editor any other way", async () => {
    const onImageBlocked = jest.fn();
    const { editor, setValue } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    act(() => {
      editor.commands.insertContent("answer ");
      editor.commands.setImage({ src: PNG_DATA_URI });
    });

    await waitFor(() => expect(onImageBlocked).toHaveBeenCalled());
    expect(editor.getHTML()).not.toMatch(/<img/i);
    expect(editor.getText()).toContain("answer");
    expect(lastValue(setValue)).not.toMatch(/<img/i);
  });

  it("does not show an image from a previously saved answer", async () => {
    const { editor } = await renderEditor({
      blockImages: true,
      value: `<p>old text</p><p><img src="${PNG_DATA_URI}"></p>`,
    });

    await waitFor(() => expect(editor.getHTML()).not.toMatch(/<img/i));
    expect(editor.getText()).toContain("old text");
  });

  it("leaves text-only pastes alone and does not warn", async () => {
    const onImageBlocked = jest.fn();
    const { editor } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    fire(editor.view.dom, "paste", {
      html: "<p>just text</p>",
      text: "just text",
    });

    await waitFor(() => expect(editor.getText()).toContain("just text"));
    expect(onImageBlocked).not.toHaveBeenCalled();
  });
});

describe("RichTextEditor without image blocking (author editors)", () => {
  it("still accepts a pasted <img>", async () => {
    const { editor } = await renderEditor({ toolbarMode: "full" });

    fire(editor.view.dom, "paste", {
      html: `<p>diagram</p><img src="${PNG_DATA_URI}">`,
      text: "diagram",
    });

    await waitFor(() => expect(editor.getHTML()).toMatch(/<img/i));
  });
});
