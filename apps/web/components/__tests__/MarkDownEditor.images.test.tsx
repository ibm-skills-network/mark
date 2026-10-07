/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import Quill from "quill";
import MarkDownEditor from "../MarkDownEditor";

// Runs the real Quill editor (not a mock) so the clipboard, uploader and
// drop paths below are the ones a learner's browser actually goes through.
// The package entry is ESM, which Jest does not transform from node_modules,
// so load Quill's own prebuilt UMD bundle instead.
jest.mock("quill", () => {
  // The syntax module reads `window.hljs` when the bundle loads; the editor
  // sets it just before its own lazy import, which here has already happened.
  Object.assign(window, { hljs: jest.requireActual("highlight.js") });
  const bundle = jest.requireActual<{ default?: typeof Quill } & typeof Quill>(
    "quill/dist/quill.js",
  );
  const QuillClass = bundle.default ?? bundle;
  return {
    __esModule: true,
    default: QuillClass,
    Delta: QuillClass.import("delta"),
  };
});

// jsdom has no layout, and Quill scrolls the caret into view after a paste.
beforeAll(() => {
  const emptyRect = () => new DOMRect(0, 0, 0, 0);
  Object.assign(Range.prototype, {
    getBoundingClientRect: emptyRect,
    getClientRects: () => [],
  });
});

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
  props: Partial<React.ComponentProps<typeof MarkDownEditor>> = {},
) {
  const setValue = jest.fn();
  const utils = render(
    <MarkDownEditor
      value=""
      setValue={setValue}
      toolbarMode="learner"
      {...props}
    />,
  );
  let quill: Quill | null = null;
  await waitFor(() => {
    const host = utils.container.querySelector(".quill-editor");
    quill = host ? (Quill.find(host) as Quill | null) : null;
    expect(quill).toBeInstanceOf(Quill);
  });
  const editor = quill as unknown as Quill;
  act(() => {
    editor.setSelection(0, 0);
  });
  return { ...utils, quill: editor, setValue };
}

const lastValue = (setValue: jest.Mock): string =>
  (setValue.mock.calls.at(-1)?.[0] as string | undefined) ?? "";

describe("MarkDownEditor with images blocked (learner text answers)", () => {
  it("drops pasted <img> from HTML but keeps the pasted text", async () => {
    const onImageBlocked = jest.fn();
    const { quill, setValue } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    fire(quill.root, "paste", {
      html: `<p>total 42</p><img src="${PNG_DATA_URI}"><p>done</p>`,
      text: "total 42\ndone",
    });

    await waitFor(() => expect(quill.getText()).toContain("done"));
    expect(quill.root.innerHTML).not.toMatch(/<img/i);
    expect(quill.getText()).toContain("total 42");
    expect(onImageBlocked).toHaveBeenCalled();
    expect(lastValue(setValue)).not.toMatch(/<img|data:image/i);
    expect(lastValue(setValue)).toContain("total 42");
  });

  it("blocks a pasted screenshot (clipboard image file only)", async () => {
    const onImageBlocked = jest.fn();
    const { quill } = await renderEditor({ blockImages: true, onImageBlocked });

    fire(quill.root, "paste", { files: [imageFile()] });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onImageBlocked).toHaveBeenCalled();
    expect(quill.root.innerHTML).not.toMatch(/<img/i);
  });

  it("keeps the text when a paste carries both an image file and plain text", async () => {
    const onImageBlocked = jest.fn();
    const { quill } = await renderEditor({ blockImages: true, onImageBlocked });

    fire(quill.root, "paste", {
      text: "$ ls\nREADME.md",
      files: [imageFile()],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onImageBlocked).toHaveBeenCalled();
    expect(quill.root.innerHTML).not.toMatch(/<img/i);
    expect(quill.getText()).toContain("README.md");
  });

  it("blocks a dropped image file", async () => {
    const onImageBlocked = jest.fn();
    const { quill } = await renderEditor({ blockImages: true, onImageBlocked });

    const event = fire(quill.root, "drop", { files: [imageFile()] });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(event.defaultPrevented).toBe(true);
    expect(onImageBlocked).toHaveBeenCalled();
    expect(quill.root.innerHTML).not.toMatch(/<img/i);
  });

  it("removes an image that reaches the editor any other way", async () => {
    const onImageBlocked = jest.fn();
    const { quill, setValue } = await renderEditor({
      blockImages: true,
      onImageBlocked,
    });

    act(() => {
      quill.insertText(0, "answer ", "user");
      quill.insertEmbed(7, "image", PNG_DATA_URI, "user");
    });

    await waitFor(() => expect(onImageBlocked).toHaveBeenCalled());
    expect(quill.root.innerHTML).not.toMatch(/<img/i);
    expect(quill.getText()).toContain("answer");
    expect(lastValue(setValue)).not.toMatch(/<img/i);
  });

  it("does not show an image from a previously saved answer", async () => {
    const { quill } = await renderEditor({
      blockImages: true,
      value: `<p>old text</p><p><img src="${PNG_DATA_URI}"></p>`,
    });

    await waitFor(() => expect(quill.root.innerHTML).not.toMatch(/<img/i));
    expect(quill.getText()).toContain("old text");
  });

  it("leaves text-only pastes alone and does not warn", async () => {
    const onImageBlocked = jest.fn();
    const { quill } = await renderEditor({ blockImages: true, onImageBlocked });

    fire(quill.root, "paste", { html: "<p>just text</p>", text: "just text" });

    await waitFor(() => expect(quill.getText()).toContain("just text"));
    expect(onImageBlocked).not.toHaveBeenCalled();
  });
});

describe("MarkDownEditor without image blocking (author editors)", () => {
  it("still accepts a pasted <img>", async () => {
    const { quill } = await renderEditor({ toolbarMode: "full" });

    fire(quill.root, "paste", {
      html: `<p>diagram</p><img src="${PNG_DATA_URI}">`,
      text: "diagram",
    });

    await waitFor(() => expect(quill.root.innerHTML).toMatch(/<img/i));
  });
});
