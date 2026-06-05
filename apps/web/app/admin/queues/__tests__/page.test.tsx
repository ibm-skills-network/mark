/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import AdminQueuesPage from "../page";

jest.mock("@/lib/admin-session", () => ({
  readAdminSessionFromStorage: () => ({ sessionToken: "tok" }),
}));
jest.mock("@/lib/shared", () => ({
  getQueueStatus: jest
    .fn()
    .mockResolvedValue({ generatedAt: "t", queues: [], workers: [] }),
  getQueueFailedJobs: jest.fn(),
  getQueueActiveJobs: jest.fn(),
  getRedisHealth: jest.fn().mockResolvedValue({
    usedMemoryBytes: null,
    usedMemoryHuman: null,
    connectedClients: null,
    opsPerSec: null,
    workerConnections: 0,
    heartbeatPods: 0,
    reconciled: true,
  }),
  retryFailedJob: jest.fn(),
  removeFailedJob: jest.fn(),
  formatFileSize: (b: number) => `${b} B`,
}));

describe("AdminQueuesPage", () => {
  it("renders the dashboard inside a QueryClient provider (no 'No QueryClient set')", async () => {
    render(<AdminQueuesPage />);
    expect(
      await screen.findByRole("heading", { name: /queues & workers/i }),
    ).toBeInTheDocument();
  });
});
