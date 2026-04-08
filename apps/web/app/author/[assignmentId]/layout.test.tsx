/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import Layout from "./layout";

const mockGetUser = jest.fn();
const mockGetAssignmentIdFromURL = jest.fn();
const mockSetState = jest.fn();
const mockUseAuthorStore = jest.fn();

jest.mock("@/components/ErrorModal", () => ({
  __esModule: true,
  default: ({ headline }: { headline: string }) => <div>{headline}</div>,
}));

jest.mock("@/lib/shared", () => ({
  getUser: () => mockGetUser(),
}));

jest.mock("@/stores/learner", () => ({
  getAssignmentIdFromURL: (...args: any[]) =>
    mockGetAssignmentIdFromURL(...args),
}));

jest.mock("@/stores/author", () => {
  const hook = (selector: (state: any) => unknown) =>
    mockUseAuthorStore(selector);
  (hook as any).setState = (...args: any[]) => mockSetState(...args);

  return {
    useAuthorStore: hook,
  };
});

describe("author assignment layout", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetAssignmentIdFromURL.mockReturnValue("123");
    mockGetUser.mockResolvedValue({ role: "author" });
    mockUseAuthorStore.mockImplementation((selector) =>
      selector({
        pageState: "ready",
      }),
    );
  });

  it("does not mutate the author store during render", () => {
    renderToString(
      <Layout>
        <div>child</div>
      </Layout>,
    );

    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("updates the active assignment id after mount", async () => {
    render(
      <Layout>
        <div>child</div>
      </Layout>,
    );

    await waitFor(() => {
      expect(mockSetState).toHaveBeenCalledWith({
        activeAssignmentId: 123,
      });
    });
  });
});
