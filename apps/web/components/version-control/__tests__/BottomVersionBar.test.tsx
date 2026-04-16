/**
 * @jest-environment jsdom
 */

import { createElement, forwardRef, type ReactNode, type Ref } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BottomVersionBar } from "../BottomVersionBar";

const mockPush = jest.fn();
const mockCheckoutVersion = jest.fn();
const mockToggleFavoriteStore = jest.fn();

const mockUseVersionControl = jest.fn();
const mockUseChatbot = jest.fn();
const mockUseAuthorStore = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("@/hooks/useVersionControl", () => ({
  useVersionControl: () => mockUseVersionControl(),
}));

jest.mock("@/hooks/useChatbot", () => ({
  useChatbot: () => mockUseChatbot(),
}));

jest.mock("@/stores/author", () => {
  const hook = (selector: (state: any) => unknown) =>
    mockUseAuthorStore(selector);
  (hook as any).setState = (...args: any[]) => mockToggleFavoriteStore(...args);

  return {
    useAuthorStore: hook,
  };
});

jest.mock("../UnsavedChangesModal", () => ({
  UnsavedChangesModal: () => null,
}));

jest.mock("../VersionSelectionModal", () => ({
  VersionSelectionModal: () => null,
}));

jest.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        forwardRef(({ children, ...props }: any, ref: Ref<HTMLElement>) => {
          const sanitizedProps = { ...props };

          delete sanitizedProps.whileHover;
          delete sanitizedProps.whileTap;
          delete sanitizedProps.initial;
          delete sanitizedProps.animate;
          delete sanitizedProps.exit;
          delete sanitizedProps.transition;

          return createElement(tag, { ...sanitizedProps, ref }, children);
        }),
    },
  );

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion,
  };
});

describe("BottomVersionBar", () => {
  const versions = [
    {
      id: 1,
      versionNumber: "1.0.0",
      versionDescription: "Initial version",
      createdAt: "2026-03-20T12:00:00.000Z",
      createdBy: "author@example.com",
      questionCount: 2,
      isDraft: false,
      isActive: true,
      published: true,
    },
    {
      id: 2,
      versionNumber: "1.1.0",
      versionDescription: "Updated version",
      createdAt: "2026-03-21T12:00:00.000Z",
      createdBy: "author@example.com",
      questionCount: 3,
      isDraft: false,
      isActive: false,
      published: true,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseChatbot.mockReturnValue({ isOpen: false });
    mockCheckoutVersion.mockResolvedValue(true);

    mockUseVersionControl.mockReturnValue({
      versions,
      currentVersion: versions[0],
      checkedOutVersion: null,
      checkoutVersion: mockCheckoutVersion,
      formatVersionAge: () => "1 day ago",
      hasUnsavedChanges: false,
      createVersion: jest.fn(),
      updateExistingVersion: jest.fn(),
      loadDraft: jest.fn(),
      loadVersions: jest.fn(),
      isLoadingVersions: false,
      versionsLoadFailed: false,
    });

    mockUseAuthorStore.mockImplementation((selector) =>
      selector({
        activeAssignmentId: 42,
        favoriteVersions: [],
      }),
    );
  });

  it("checks out a selected version immediately when there are no unsaved changes", async () => {
    render(<BottomVersionBar />);

    fireEvent.click(screen.getByRole("button", { name: /v1\.0\.0/i }));
    fireEvent.click(screen.getByRole("button", { name: /v1\.1\.0/i }));

    await waitFor(() => {
      expect(mockCheckoutVersion).toHaveBeenCalledWith(2, "1.1.0");
    });
  });

  it("does not render a nested button inside another button in the version list", () => {
    const { container } = render(<BottomVersionBar />);

    fireEvent.click(screen.getByRole("button", { name: /v1\.0\.0/i }));

    expect(container.querySelector("button button")).toBeNull();
  });

  it("does not checkout a version when clicking the favorite button", () => {
    render(<BottomVersionBar />);

    fireEvent.click(screen.getByRole("button", { name: /v1\.0\.0/i }));
    fireEvent.click(screen.getAllByTitle("Add to favorites")[0]);

    expect(mockCheckoutVersion).not.toHaveBeenCalled();
    expect(mockToggleFavoriteStore).toHaveBeenCalled();
  });
});
