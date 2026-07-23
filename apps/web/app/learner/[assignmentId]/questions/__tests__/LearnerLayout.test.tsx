import { Suspense } from "react";
import LearnerLayout from "../LearnerLayout";
import ErrorModal from "@/components/ErrorModal";
import { createAttempt, getAttempts, getUser } from "@/lib/talkToBackend";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => ({ get: () => "" })),
}));

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn(),
  getAttempts: jest.fn(),
  createAttempt: jest.fn(),
  getAttempt: jest.fn(),
}));

jest.mock("@learnerComponents/Question", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../ClientComponent", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/ErrorModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/ServiceUnavailableNotice", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/app/loading", () => ({ __esModule: true, default: () => null }));
jest.mock("@/lib/error-screen", () => ({
  ErrorScreen: () => null,
  statusFromError: () => 500,
}));

const getUserMock = getUser as jest.Mock;
const getAttemptsMock = getAttempts as jest.Mock;
const createAttemptMock = createAttempt as jest.Mock;

const props = {
  params: { assignmentId: "123" },
  searchParams: {} as { authorMode?: string; lang?: string },
};

const inProgressAttempt = (id: number) => ({
  id,
  submitted: false,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
});

describe("LearnerLayout attempt resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserMock.mockResolvedValue({ role: "learner" });
  });

  it("resumes the concurrently-created attempt instead of showing a lockout when createAttempt reports 'attempt in progress'", async () => {
    getAttemptsMock
      .mockResolvedValueOnce([]) // initial list: nothing in progress
      .mockResolvedValueOnce([inProgressAttempt(321)]); // re-list after the 422
    createAttemptMock.mockResolvedValue("attempt in progress");

    const element = await LearnerLayout(props);

    // Must render the quiz with the resumed attempt id, not an error modal.
    expect(element.type).toBe(Suspense);
    expect(element.props.children.props.attemptId).toBe(321);
    // A resumed attempt is not a new one: QuestionPage clears the assignment's
    // draft-answer localStorage for new attempts, and resuming must keep it.
    expect(element.props.children.props.isNewAttempt).toBe(false);
  });

  it("resumes via the latest unsubmitted attempt when clock skew hides it from the client-side in-progress filter", async () => {
    const skewedAttempt = {
      id: 654,
      submitted: false,
      // Expired by the client clock, but the server just vouched an attempt
      // is active — the fallback must trust the server and resume it.
      expiresAt: new Date(Date.now() - 5000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    getAttemptsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([skewedAttempt]);
    createAttemptMock.mockResolvedValue("attempt in progress");

    const element = await LearnerLayout(props);

    expect(element.type).toBe(Suspense);
    expect(element.props.children.props.attemptId).toBe(654);
    expect(element.props.children.props.isNewAttempt).toBe(false);
  });

  it("keeps draft answers when the server resumes an existing attempt the client filter missed", async () => {
    const skewedAttempt = {
      id: 500,
      submitted: false,
      expiresAt: new Date(Date.now() - 5000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    getAttemptsMock.mockResolvedValue([skewedAttempt]);
    // The server's clock still considers the listed attempt active, so its
    // idempotent fast path returns the existing id instead of creating.
    createAttemptMock.mockResolvedValue(500);

    const element = await LearnerLayout(props);

    expect(element.type).toBe(Suspense);
    expect(element.props.children.props.attemptId).toBe(500);
    expect(element.props.children.props.isNewAttempt).toBe(false);
  });

  it("explains the in-progress state instead of a generic 500 when the attempt cannot be resumed after 'attempt in progress'", async () => {
    getAttemptsMock.mockResolvedValue([]);
    createAttemptMock.mockResolvedValue("attempt in progress");

    const element = await LearnerLayout(props);

    expect(element.type).toBe(ErrorModal);
    expect(element.props.headline).toBe("An attempt is already in progress");
    expect(element.props.statusCode).toBe(422);
  });

  it("renders 'No more attempts available' only for a real max-attempts lockout", async () => {
    getAttemptsMock.mockResolvedValue([]);
    createAttemptMock.mockResolvedValue("no more attempts");

    const element = await LearnerLayout(props);

    expect(element.type).toBe(ErrorModal);
    expect(element.props.headline).toBe("No more attempts available");
  });

  it("does not render 'No more attempts available' for a time-range limit", async () => {
    getAttemptsMock.mockResolvedValue([]);
    createAttemptMock.mockResolvedValue("time range exceeded");

    const element = await LearnerLayout(props);

    expect(element.type).toBe(ErrorModal);
    expect(element.props.headline).not.toBe("No more attempts available");
  });
});
