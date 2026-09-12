/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import { NetworkError } from "@/lib/api-client";

// The results page is a heavy client page; only the modules its load effect
// touches matter here, so the presentational tree is stubbed down to nothing.
const mockGetUser = jest.fn();
const mockGetCompletedAttempt = jest.fn();
const mockGetAttempts = jest.fn();

jest.mock("@/lib/talkToBackend", () => ({
  getUser: (...args: unknown[]) => mockGetUser(...args),
  getCompletedAttempt: (...args: unknown[]) => mockGetCompletedAttempt(...args),
  getAttempts: (...args: unknown[]) => mockGetAttempts(...args),
  getFeedback: jest.fn().mockResolvedValue(undefined),
  submitFeedback: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/learner/1323/successPage/2492",
}));

jest.mock("@/components/Loading", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../Question", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/ReportModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/GradeSyncStatus", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/promo/PromoBanner", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@tsparticles/react", () => ({
  __esModule: true,
  Particles: () => null,
  initParticlesEngine: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@smastrom/react-rating", () => ({
  __esModule: true,
  Rating: () => null,
  RoundedStar: {},
}));

import SuccessPage from "../page";

describe("results page when the request never reached the server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ role: "learner", userId: "a@b.com" });
    mockGetAttempts.mockResolvedValue([]);
  });

  // Prod signature: a learner whose connection dropped on the results page was
  // told the submission did not belong to them (404) or that we had failed
  // (500), and the report was filed as a server fault. Neither is true — the
  // request never got a response.
  it("shows the connection screen instead of a missing-attempt dialog", async () => {
    mockGetCompletedAttempt.mockRejectedValue(
      new NetworkError("Request timed out after 30000ms", "timeout"),
    );

    await act(async () => {
      render(<SuccessPage />);
    });

    expect(
      screen.getByRole("heading", { name: /timed out/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/does not belong to your account/i)).toBeNull();
    expect(screen.queryByText(/something went wrong on our side/i)).toBeNull();
  });

  it("does not invent an HTTP status for a dropped connection", async () => {
    mockGetCompletedAttempt.mockRejectedValue(
      new NetworkError("Unable to reach the server", "unreachable"),
    );

    const { container } = render(<SuccessPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", { name: /couldn't reach/i }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b404\b/);
    expect(container.textContent).not.toMatch(/\b500\b/);
  });

  // A genuinely missing attempt must keep its own message: routing every
  // failure to the connection screen would hide the real one.
  it("keeps the missing-attempt message when the server answered", async () => {
    mockGetCompletedAttempt.mockResolvedValue(undefined);

    await act(async () => {
      render(<SuccessPage />);
    });

    expect(
      screen.getByText(/does not belong to your account/i),
    ).toBeInTheDocument();
  });
});
