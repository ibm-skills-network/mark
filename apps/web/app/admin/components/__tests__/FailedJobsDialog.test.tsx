/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { FailedJobsDialog } from "../FailedJobsDialog";
import type { FailedJob } from "../../../../lib/shared";
import * as shared from "../../../../lib/shared";

jest.mock("../../../../lib/shared", () => ({
  ...jest.requireActual("../../../../lib/shared"),
  getQueueFailedJobs: jest.fn(),
  retryFailedJob: jest.fn(),
  removeFailedJob: jest.fn(),
}));

const noop = jest.fn();

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
};

const job: FailedJob = {
  id: "42",
  name: "grade",
  attemptsMade: 2,
  maxAttempts: 3,
  failedReason: "boom: decrypt failed",
  failedAt: "2026-06-04T10:00:00.000Z",
  enqueuedAt: "2026-06-04T09:58:00.000Z",
  processedAt: "2026-06-04T09:59:00.000Z",
  finishedAt: "2026-06-04T10:00:00.000Z",
  stacktrace: ["Error: boom", "    at grade (worker.ts:10)"],
  files: [
    {
      filename: "submission.pdf",
      sizeBytes: 2048,
      mimeType: "application/pdf",
      bucket: "b",
      storageKey: "k",
      downloadUrl: "https://signed.example/getObject",
    },
  ],
  domainIds: { assignmentId: 7, attemptId: 99 },
};

describe("FailedJobsDialog", () => {
  beforeEach(() => {
    (shared.getQueueFailedJobs as jest.Mock).mockResolvedValue({
      queueName: "mark.assignment.v2",
      failed: [job],
    });
    (shared.retryFailedJob as jest.Mock).mockResolvedValue({ ok: true });
    (shared.removeFailedJob as jest.Mock).mockResolvedValue({ ok: true });
  });

  it("renders attempts, a file link with size/mimetype, and expandable stacktrace", async () => {
    wrap(
      <FailedJobsDialog
        sessionToken="tok"
        queueName="mark.assignment.v2"
        onClose={noop}
      />,
    );

    expect(await screen.findByText("grade#42")).toBeInTheDocument();
    expect(screen.getByText(/2\/3 attempts/)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /open file/i });
    expect(link).toHaveAttribute("href", "https://signed.example/getObject");
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();

    // Stacktrace is hidden until toggled.
    expect(screen.queryByText(/at grade/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/show stacktrace/i));
    expect(screen.getByText(/at grade/)).toBeInTheDocument();
  });

  it("requires a confirm step before retrying a job", async () => {
    wrap(
      <FailedJobsDialog
        sessionToken="tok"
        queueName="mark.assignment.v2"
        onClose={noop}
      />,
    );
    await screen.findByText("grade#42");

    // Clicking Retry only arms the confirm — it does NOT call the API yet.
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(shared.retryFailedJob).not.toHaveBeenCalled();
    expect(screen.getByText(/retry this job\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() =>
      expect(shared.retryFailedJob).toHaveBeenCalledWith(
        "tok",
        "mark.assignment.v2",
        "42",
      ),
    );
  });

  it("requires a confirm step before removing a job and can be cancelled", async () => {
    wrap(
      <FailedJobsDialog
        sessionToken="tok"
        queueName="mark.assignment.v2"
        onClose={noop}
      />,
    );
    await screen.findByText("grade#42");

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(screen.getByText(/remove this job\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/remove this job\?/i)).not.toBeInTheDocument();
    expect(shared.removeFailedJob).not.toHaveBeenCalled();
  });

  it("never renders a userId field", async () => {
    wrap(
      <FailedJobsDialog
        sessionToken="tok"
        queueName="mark.assignment.v2"
        onClose={noop}
      />,
    );
    await screen.findByText("grade#42");
    expect(screen.queryByText(/userId/i)).not.toBeInTheDocument();
  });
});
