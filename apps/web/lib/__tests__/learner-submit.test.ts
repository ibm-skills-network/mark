import { submitAssignment } from "../learner";
import { apiClient } from "../api-client";

jest.mock("@/config/constants", () => ({
  getApiRoutes: () => ({
    assignments: "/api/assignments",
  }),
}));

jest.mock("@/lib/talkToBackend", () => ({
  submitReportAuthor: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
  },
}));

jest.mock("../api-client", () => ({
  APIError: class APIError extends Error {
    status: number;

    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  apiClient: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));

class FakeEventSource {
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 1;

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener = jest.fn();

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe("submitAssignment grading rollout responses", () => {
  const originalEventSource = global.EventSource;
  const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    FakeEventSource.instances = [];
    global.EventSource = FakeEventSource as never;
  });

  afterAll(() => {
    global.EventSource = originalEventSource;
  });

  it("returns the legacy synchronous submission response when no grading job is created", async () => {
    const onProgress = jest.fn();
    const onGradingJobCreated = jest.fn();
    const synchronousResponse = {
      id: 5,
      success: true,
      message: "Done",
      showSubmissionFeedback: true,
      feedbacksForQuestions: [],
      totalPointsEarned: 8,
      totalPossiblePoints: 10,
    };
    mockApiClient.patch.mockResolvedValueOnce(synchronousResponse);

    const result = await submitAssignment(
      9,
      5,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      onProgress,
      onGradingJobCreated,
    );

    expect(result).toBe(synchronousResponse);
    expect(onGradingJobCreated).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(onProgress).toHaveBeenCalledWith("completed", 100, "Done");
  });

  it("subscribes to grading status when the API returns a grading job", async () => {
    const onProgress = jest.fn();
    const onGradingJobCreated = jest.fn();
    const completedResponse = {
      id: 5,
      success: true,
      showSubmissionFeedback: true,
      feedbacksForQuestions: [],
      totalPointsEarned: 8,
      totalPossiblePoints: 10,
    };
    mockApiClient.patch.mockResolvedValueOnce({
      id: 5,
      success: true,
      gradingJobId: "grading-job-1",
      message: "Grading job created.",
      showSubmissionFeedback: false,
      totalPointsEarned: 0,
      totalPossiblePoints: 0,
    });

    const resultPromise = submitAssignment(
      9,
      5,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      onProgress,
      onGradingJobCreated,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(onGradingJobCreated).toHaveBeenCalledWith("grading-job-1");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(
      "/api/assignments/9/attempts/5/grading/grading-job-1/status-stream",
    );

    FakeEventSource.instances[0].onmessage?.({
      data: JSON.stringify({
        status: "Completed",
        result: completedResponse,
      }),
    });

    await expect(resultPromise).resolves.toEqual(completedResponse);
  });
});
