/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueueStatusDashboard } from "../QueueStatusDashboard";
import * as shared from "../../../../lib/shared";

jest.mock("../../../../lib/shared");

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
};

describe("QueueStatusDashboard", () => {
  it("renders a queue row and a stale worker badge", async () => {
    (shared.getQueueStatus as jest.Mock).mockResolvedValue({
      generatedAt: "t",
      queues: [
        {
          name: "mark.attempt",
          waiting: 2,
          active: 1,
          delayed: 0,
          failed: 3,
          completed: 9,
          paused: 0,
        },
      ],
      workers: [
        {
          instanceId: "w1",
          hostname: "h1",
          pid: 1,
          startedAt: null,
          updatedAt: null,
          uptimeMs: null,
          lastSeenMs: null,
          stale: true,
          workerCount: 5,
          queues: ["mark.attempt"],
        },
      ],
    });
    wrap(<QueueStatusDashboard sessionToken="tok" />);
    expect(await screen.findByText("mark.attempt")).toBeInTheDocument();
    expect(await screen.findByText(/stale/i)).toBeInTheDocument();
  });
});
