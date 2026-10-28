import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { EmailDeliveryPanel } from "./EmailDeliveryPanel";

jest.mock("@/lib/api-client", () => ({
  apiClient: { get: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/config/constants", () => ({ getBaseApiPath: () => "/api/v1" }));

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
    const get = apiClient.get as jest.Mock;
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
    (apiClient.delete as jest.Mock).mockResolvedValue({ removed: true });
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
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/api/v1/admin-dashboard/email-suppressions/7",
        expect.objectContaining({
          headers: { "x-admin-token": "test-session" },
        }),
      ),
    );
  });

  it("makes stale polling visible even when no domains are listed", async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      configured: true,
      stale: true,
      lastSuccessAt: null,
      lastError: "IBM HTTP 429",
      domains: [],
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("IBM HTTP 429");
  });
});
