/**
 * @jest-environment jsdom
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import GradingBoostPage from "../page";

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

const saved = {
  enabled: false,
  pointsPerStep: 4,
  maxBoost: 3,
  updatedBy: null,
  updatedAt: null,
};

// Rendered inside act so the setting the page loads on mount is applied.
async function renderPage() {
  await act(async () => {
    render(<GradingBoostPage />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue(saved);
});

describe("GradingBoostPage", () => {
  it("loads the setting with the admin token and previews the boost per question size", async () => {
    await renderPage();
    expect(
      await screen.findByRole("heading", { name: /effort boost/i }),
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v3/grading-settings/boost", {
      headers: { "x-admin-token": "tok" },
    });
    const preview = await screen.findByRole("table", {
      name: /boost preview/i,
    });
    expect(preview).toHaveTextContent("Out of 4+1");
    expect(preview).toHaveTextContent("Out of 12+3");
    expect(preview).toHaveTextContent("Out of 2+0");
  });

  it("saves the edited setting", async () => {
    put.mockResolvedValue({
      ...saved,
      enabled: true,
      maxBoost: 2,
      updatedBy: "noah@example.com",
      updatedAt: "2026-10-30T19:00:00.000Z",
    });
    await renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: /enabled/i }));
    fireEvent.change(screen.getByLabelText(/most points per question/i), {
      target: { value: "2" },
    });
    expect(
      screen.getByRole("table", { name: /boost preview/i }),
    ).toHaveTextContent("Out of 12+2");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/api/v3/grading-settings/boost",
        { enabled: true, pointsPerStep: 4, maxBoost: 2 },
        { headers: { "x-admin-token": "tok" } },
      ),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(screen.getByText(/noah@example\.com/)).toBeInTheDocument();
  });

  it("does not send out-of-range values", async () => {
    await renderPage();
    fireEvent.change(await screen.findByLabelText(/question points per/i), {
      target: { value: "0" },
    });
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it("sends an expired admin session back to the login", async () => {
    get.mockRejectedValue({ status: 401 });
    await renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });
});
