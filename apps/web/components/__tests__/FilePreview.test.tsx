/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

import FilePreview from "@/components/FileExplorer/FilePreview";
import type { EnhancedFileObject } from "@/config/types";

jest.mock("@/components/Loading", () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));

// A learner upload kept in storage: the results page knows no size for it.
const storedNotebook: EnhancedFileObject = {
  id: "file-5861-0",
  fileName: "analysis.ipynb",
  cosKey: "learner/7/analysis.ipynb",
  cosBucket: "learner-bucket",
  path: "analysis.ipynb",
  size: 0,
  fileSize: 0,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

const notebook = '{\n "cells": [],\n "nbformat": 4\n}';

describe("FilePreview", () => {
  it("shows a stored notebook's text and the size reported by storage", () => {
    const { container } = render(
      <FilePreview
        file={storedNotebook}
        content={{ content: notebook, size: 1363149 }}
        onClose={jest.fn()}
      />,
    );

    expect(container.querySelector("pre")?.textContent).toBe(notebook);
    expect(screen.getByText("1.3 MB")).toBeInTheDocument();
  });

  it("shows a spinner, not an empty file, while the content loads", () => {
    render(
      <FilePreview
        file={storedNotebook}
        content={null}
        onClose={jest.fn()}
        loading
      />,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Preview not available")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 Bytes/)).not.toBeInTheDocument();
  });
});
