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
}));

describe("AdminQueuesPage", () => {
  it("renders the dashboard inside a QueryClient provider (no 'No QueryClient set')", async () => {
    render(<AdminQueuesPage />);
    expect(
      await screen.findByRole("heading", { name: /queues & workers/i }),
    ).toBeInTheDocument();
  });
});
