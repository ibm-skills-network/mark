/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import MarkdownViewer from "../MarkdownViewer";

const mockQuillConstructor = jest.fn();

jest.mock("quill", () => ({
  __esModule: true,
  default: mockQuillConstructor,
}));

describe("MarkdownViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockQuillConstructor.mockImplementation((container: HTMLDivElement) => {
      const root = document.createElement("div");
      container.appendChild(root);

      return {
        root,
        disable: jest.fn(),
      };
    });
  });

  it("does not initialize Quill after the component unmounts", async () => {
    const { unmount } = render(<MarkdownViewer>hello</MarkdownViewer>);

    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockQuillConstructor).not.toHaveBeenCalled();
  });

  it("initializes Quill once and updates the rendered content", async () => {
    const { rerender } = render(<MarkdownViewer>first</MarkdownViewer>);

    await waitFor(() => {
      expect(mockQuillConstructor).toHaveBeenCalledTimes(1);
    });

    const quillInstance = mockQuillConstructor.mock.results[0]?.value;
    expect(quillInstance.disable).toHaveBeenCalled();
    expect(quillInstance.root.innerHTML).toBe("first");

    rerender(<MarkdownViewer>second</MarkdownViewer>);

    await waitFor(() => {
      expect(quillInstance.root.innerHTML).toBe("second");
    });
  });

  it("strips active content before writing untrusted HTML to the DOM", async () => {
    render(
      <MarkdownViewer>
        {'<p>safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'}
      </MarkdownViewer>,
    );

    await waitFor(() => {
      expect(mockQuillConstructor).toHaveBeenCalledTimes(1);
    });

    const html = mockQuillConstructor.mock.results[0]?.value.root.innerHTML;
    expect(html).toContain("safe");
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<script/i);
  });
});
