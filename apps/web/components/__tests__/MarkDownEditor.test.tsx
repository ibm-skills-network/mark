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
        value={'<p>safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'}
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
});
