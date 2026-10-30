/**
 * @jest-environment jsdom
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import GradingEnginePage from "../page";

const get = jest.fn();
const put = jest.fn();
const replace = jest.fn();

jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
jest.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));
jest.mock("@/lib/admin-session", () => ({
  readAdminSessionFromStorage: () => ({ sessionToken: "tok" }),
  clearAdminSessionStorage: jest.fn(),
  buildAdminLoginRedirect: () => "/admin",
}));
jest.mock("@/lib/shared", () => ({
  isAdminAuthError: (err: { status?: number }) => err?.status === 401,
}));

const onV3 = {
  engine: "v3",
  assignmentOverrides: 0,
  updatedBy: "noah@example.com",
  updatedAt: "2026-10-30T19:00:00.000Z",
};

async function renderPage() {
  await act(async () => {
    render(<GradingEnginePage />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue(onV3);
});

describe("GradingEnginePage", () => {
  it("shows the current engine and offers only the other one", async () => {
    await renderPage();
    expect(get).toHaveBeenCalledWith("/api/v3/grading-settings/engine", {
      headers: { "x-admin-token": "tok" },
    });
    expect(screen.getByText("Current engine: v3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to legacy" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Switch to v3" }),
    ).not.toBeInTheDocument();
  });

  it("offers both when question types are mixed", async () => {
    get.mockResolvedValue({ ...onV3, engine: "mixed" });
    await renderPage();
    expect(screen.getByText("Current engine: Mixed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to legacy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to v3" }),
    ).toBeInTheDocument();
  });

  it("warns before switching to legacy and changes nothing on cancel", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Switch to legacy" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("no longer maintained");
    expect(dialog).toHaveTextContent("twice as much");
    expect(dialog).toHaveTextContent("within 30 seconds");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("switches after confirmation and shows the new engine", async () => {
    put.mockResolvedValue({ ...onV3, engine: "legacy" });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Switch to legacy" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Yes, switch to legacy" }),
      );
    });
    expect(put).toHaveBeenCalledWith(
      "/api/v3/grading-settings/engine",
      { engine: "legacy" },
      { headers: { "x-admin-token": "tok" } },
    );
    expect(
      await screen.findByText("Current engine: Legacy"),
    ).toBeInTheDocument();
  });

  it("leaves out the legacy warning when switching to v3", async () => {
    get.mockResolvedValue({ ...onV3, engine: "legacy" });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Switch to v3" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("within 30 seconds");
    expect(dialog).not.toHaveTextContent("no longer maintained");
  });

  it("mentions assignment settings only when some exist", async () => {
    get.mockResolvedValue({ ...onV3, assignmentOverrides: 2 });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Switch to legacy" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "2 assignments have their own settings",
    );
  });

  it("reports a failed switch and keeps showing the current engine", async () => {
    put.mockRejectedValue({ status: 500 });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Switch to legacy" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Yes, switch to legacy" }),
      );
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was changed",
    );
    expect(screen.getByText("Current engine: v3")).toBeInTheDocument();
  });

  it("sends an expired admin session back to the login", async () => {
    get.mockRejectedValue({ status: 401 });
    await renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });
});
