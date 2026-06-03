/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useQueueStatus } from "../useQueueStatus";
import * as shared from "../../lib/shared";

jest.mock("../../lib/shared");

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("useQueueStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fetches queue status when a token is provided", async () => {
    (shared.getQueueStatus as jest.Mock).mockResolvedValue({
      generatedAt: "t",
      queues: [],
      workers: [],
    });
    const { result } = renderHook(() => useQueueStatus("tok"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(shared.getQueueStatus).toHaveBeenCalledWith("tok");
  });

  it("is disabled without a token", () => {
    const { result } = renderHook(() => useQueueStatus(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(shared.getQueueStatus).not.toHaveBeenCalled();
  });
});
