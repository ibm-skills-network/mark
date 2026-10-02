/**
 * @jest-environment jsdom
 */

import { createElement, forwardRef, type ReactNode, type Ref } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import FileUploader from "@/components/FileUploader";
import {
  IMAGE_ACCEPT,
  UPLOAD_ACCEPT,
  type UploadAcceptMap,
} from "@/lib/upload-accept";

const mockUploadFileToStorage = jest.fn();

jest.mock("@/lib/shared", () => ({
  uploadFileToStorage: (...args: unknown[]) => mockUploadFileToStorage(...args),
  deleteFile: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

jest.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        forwardRef(
          (
            { children, ...props }: { children?: ReactNode },
            ref: Ref<HTMLElement>,
          ) => {
            const sanitized: Record<string, unknown> = { ...props };
            for (const key of [
              "whileHover",
              "whileTap",
              "initial",
              "animate",
              "exit",
              "transition",
            ]) {
              delete sanitized[key];
            }
            return createElement(tag, { ...sanitized, ref }, children);
          },
        ),
    },
  );

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion,
  };
});

const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.51 Mobile Safari/537.36";
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function renderUploader(acceptedFileTypes: UploadAcceptMap, userAgent: string) {
  jest.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  const { container } = render(
    <FileUploader
      uploadType="learner"
      context={{ assignmentId: 1, questionId: 2 }}
      acceptedFileTypes={acceptedFileTypes}
    />,
  );
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("FileUploader rendered no file input");
  }
  return input;
}

async function selectFile(input: HTMLInputElement, file: File) {
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    // react-dropzone reads the selected files asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("FileUploader accept filter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("keeps the accept filter in desktop browsers", async () => {
    const input = renderUploader(UPLOAD_ACCEPT, DESKTOP_CHROME_UA);

    await waitFor(() => {
      expect(input.getAttribute("accept")).toContain("image/png");
    });
    expect(input.getAttribute("accept")).toContain("application/pdf");
  });

  it("drops a mixed accept filter in an Android WebView", async () => {
    const input = renderUploader(UPLOAD_ACCEPT, ANDROID_WEBVIEW_UA);

    await waitFor(() => {
      expect(input.getAttribute("accept") ?? "").toBe("");
    });
  });

  it("keeps an image-only accept filter in an Android WebView", async () => {
    const input = renderUploader(IMAGE_ACCEPT, ANDROID_WEBVIEW_UA);

    await waitFor(() => {
      expect(input.getAttribute("accept")).toContain("image/png");
    });
  });

  it("still rejects a disallowed file in an Android WebView", async () => {
    const input = renderUploader(UPLOAD_ACCEPT, ANDROID_WEBVIEW_UA);
    await waitFor(() => {
      expect(input.getAttribute("accept") ?? "").toBe("");
    });

    await selectFile(
      input,
      new File(["MZ"], "setup.exe", { type: "application/x-msdownload" }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid file type: .exe"),
        expect.anything(),
      );
    });
    expect(mockUploadFileToStorage).not.toHaveBeenCalled();
  });

  it("uploads an allowed document in an Android WebView", async () => {
    mockUploadFileToStorage.mockResolvedValue({
      fileName: "report.pdf",
      fileType: "application/pdf",
      key: "learner/report.pdf",
      bucket: "test-bucket",
    });
    const input = renderUploader(UPLOAD_ACCEPT, ANDROID_WEBVIEW_UA);
    await waitFor(() => {
      expect(input.getAttribute("accept") ?? "").toBe("");
    });

    await selectFile(
      input,
      new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" }),
    );

    await waitFor(() => {
      expect(mockUploadFileToStorage).toHaveBeenCalledWith(
        expect.objectContaining({ name: "report.pdf" }),
        expect.objectContaining({ fileName: "report.pdf" }),
        expect.anything(),
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
