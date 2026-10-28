import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { EmailDeliveryPanel } from "./EmailDeliveryPanel";

jest.mock("@/lib/api-client", () => ({
  apiClient: { get: jest.fn(), delete: jest.fn(), post: jest.fn() },
}));
jest.mock("@/config/constants", () => ({ getBaseApiPath: () => "/api/v1" }));

const mockedApi = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

describe("EmailDeliveryPanel", () => {
  beforeEach(() => jest.resetAllMocks());
  function mount() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={client}>
        <EmailDeliveryPanel sessionToken="test-session" />
      </QueryClientProvider>,
    );
  }

  it("shows domain warnings and lets an admin release an address", async () => {
    const get = mockedApi.get;
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("bounce-health")
          ? {
              configured: true,
              stale: false,
              lastSuccessAt: "2026-10-28T12:00:00Z",
              lastError: null,
              domains: [
                {
                  domain: "example.com",
                  recipients: 3,
                  lastBounceAt: "2026-10-28T11:00:00Z",
                },
              ],
            }
          : url.includes("temporary-holds")
            ? { items: [], total: 0 }
            : {
                items: [
                  {
                    id: 7,
                    email: "learner@example.com",
                    reason: "HARD_BOUNCE",
                    detail: "IBM UNKNOWN_USER",
                  },
                ],
                total: 1,
              },
      ),
    );
    mockedApi.delete.mockResolvedValue({ removed: true });
    mount();
    expect(
      await screen.findByText(/example.com: 3 distinct recipients/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Manage suppressed addresses" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Release learner@example.com",
      }),
    );
    await waitFor(() =>
      expect(mockedApi.delete).toHaveBeenCalledWith(
        "/api/v1/admin-dashboard/email-suppressions/7",
        expect.objectContaining({
          headers: { "x-admin-token": "test-session" },
        }),
      ),
    );
  });

  it("makes stale polling visible even when no domains are listed", async () => {
    mockedApi.get.mockResolvedValue({
      configured: true,
      stale: true,
      lastSuccessAt: null,
      lastError: "IBM HTTP 429",
      domains: [],
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("IBM HTTP 429");
  });

  it("shows automated recovery and offers an optional temporary-hold override", async () => {
    mockedApi.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("bounce-health")
          ? {
              configured: true,
              stale: false,
              lastSuccessAt: null,
              lastError: null,
              domains: [],
              senderWarning: { active: true, recipients: 12, domains: 4 },
            }
          : url.includes("temporary-holds")
            ? {
                total: 1,
                items: [
                  {
                    email: "held@example.com",
                    stage: 2,
                    reason: "MESSAGE_REFUSED",
                    holdUntil: "2026-10-31T12:00:00Z",
                    probeStartedAt: null,
                    probeAcceptedAt: null,
                  },
                ],
              }
            : { total: 0, items: [] },
      ),
    );
    mockedApi.post.mockResolvedValue({ released: true });
    mount();
    expect(
      await screen.findByText(/Possible sender or relay problem/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Routine review is not required/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Manage suppressed addresses" }),
    );
    expect(
      await screen.findByText(/Next trial eligible after/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Lift temporary hold for held@example.com",
      }),
    );
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/admin-dashboard/email-suppressions/temporary-holds/release",
        { email: "held@example.com" },
        expect.objectContaining({
          headers: { "x-admin-token": "test-session" },
        }),
      ),
    );
  });
});
