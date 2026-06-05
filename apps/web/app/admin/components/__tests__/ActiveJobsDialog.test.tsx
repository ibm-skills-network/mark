/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ActiveJobsDialog } from "../ActiveJobsDialog";
import type { ActiveJob } from "../../../../lib/shared";
import * as shared from "../../../../lib/shared";

jest.mock("../../../../lib/shared");

const noop = jest.fn();

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
};

const job: ActiveJob = {
  id: "7",
  name: "grade",
  attemptsMade: 1,
  maxAttempts: 3,
  runningForMs: 65_000,
  progress: 0.5,
  processedBy: "pod-abc:worker:1",
  domainIds: { assignmentId: 12 },
};

describe("ActiveJobsDialog", () => {
  beforeEach(() => {
    (shared.getQueueActiveJobs as jest.Mock).mockResolvedValue({
      queueName: "mark.attempt",
      active: [job],
    });
  });

  it("renders running-for, owning pod, attempt count, progress and domain ids", async () => {
    wrap(
      <ActiveJobsDialog
        sessionToken="tok"
        queueName="mark.attempt"
        onClose={noop}
      />,
    );

    expect(await screen.findByText("grade#7")).toBeInTheDocument();
    expect(screen.getByText(/1\/3 attempts/)).toBeInTheDocument();
    expect(screen.getByText(/running for 1m 5s/)).toBeInTheDocument();
    expect(screen.getByText(/pod-abc:worker:1/)).toBeInTheDocument();

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText(/assignmentId=12/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no active jobs", async () => {
    (shared.getQueueActiveJobs as jest.Mock).mockResolvedValue({
      queueName: "mark.attempt",
      active: [],
    });
    wrap(
      <ActiveJobsDialog
        sessionToken="tok"
        queueName="mark.attempt"
        onClose={noop}
      />,
    );
    expect(await screen.findByText(/no active jobs/i)).toBeInTheDocument();
  });
});
