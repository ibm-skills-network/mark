/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import MarkDownEditor from "../MarkDownEditor";

const mockQuillConstructor = jest.fn();

jest.mock("quill", () => ({
  __esModule: true,
  default: mockQuillConstructor,
}));

describe("MarkDownEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockQuillConstructor.mockImplementation((container: HTMLDivElement) => {
      const root = document.createElement("div");
      container.appendChild(root);

      return {
        root,
        on: jest.fn(),
        off: jest.fn(),
        getText: jest.fn(() => ""),
        deleteText: jest.fn(),
        hasFocus: jest.fn(() => false),
      };
    });
  });

  it("sanitizes the incoming value before loading it into the editor", async () => {
    render(
      <MarkDownEditor
        value={
          '<p>safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'
        }
        setValue={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockQuillConstructor).toHaveBeenCalledTimes(1);
    });

    const html = mockQuillConstructor.mock.results[0]?.value.root.innerHTML;
    expect(html).toContain("safe");
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<script/i);
  });

  const quillOptions = () =>
    mockQuillConstructor.mock.calls[0]?.[1] as {
      modules: { keyboard?: { bindings?: Record<string, unknown> } };
    };

  it("disables markdown list autofill when requested, so typed `* ` and `1. ` stay literal", async () => {
    render(
      <MarkDownEditor value="" setValue={jest.fn()} disableListAutofill />,
    );

    await waitFor(() => {
      expect(mockQuillConstructor).toHaveBeenCalledTimes(1);
    });

    const bindings = quillOptions().modules.keyboard?.bindings ?? {};
    expect(bindings).toHaveProperty("list autofill", null);
  });

  it("keeps Quill's default list autofill when not requested", async () => {
    render(<MarkDownEditor value="" setValue={jest.fn()} />);

    await waitFor(() => {
      expect(mockQuillConstructor).toHaveBeenCalledTimes(1);
    });

    expect(
      quillOptions().modules.keyboard?.bindings?.["list autofill"],
    ).toBeUndefined();
  });

  it("opts the editor out of browser auto-translation", async () => {
    const { container } = render(
      <MarkDownEditor value="" setValue={jest.fn()} />,
    );

    await waitFor(() => {
      expect(mockQuillConstructor).toHaveBeenCalledTimes(1);
    });

    const editorRoot = mockQuillConstructor.mock.calls[0]?.[0] as HTMLElement;
    expect(container.contains(editorRoot)).toBe(true);
    expect(editorRoot.getAttribute("translate")).toBe("no");
    expect(editorRoot.classList.contains("notranslate")).toBe(true);
  });
});
