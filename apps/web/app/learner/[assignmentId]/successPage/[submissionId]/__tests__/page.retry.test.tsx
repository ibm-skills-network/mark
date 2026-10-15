import { act, fireEvent, render, screen } from "@testing-library/react";
import { APIError, NetworkError } from "@/lib/api-client";
import { getAttempts, getCompletedAttempt, getUser } from "@/lib/talkToBackend";
import SuccessPage from "../page";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn(),
  getCompletedAttempt: jest.fn(),
  getAttempts: jest.fn(),
  getFeedback: jest.fn(),
  submitFeedback: jest.fn(),
  submitReportAuthor: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/learner/3532/successPage/2486",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The results page pulls in animation, particle and charting libraries that
// have nothing to do with the error path under test.
jest.mock("next/dynamic", () => () => {
  const Stub = () => null;
  return Stub;
});
jest.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children }: { children?: React.ReactNode }) =>
          children,
    },
  ),
}));
jest.mock("@tsparticles/react", () => ({ Particles: () => null }));
jest.mock("@smastrom/react-rating", () => ({
  Rating: () => null,
  RoundedStar: {},
}));
jest.mock("react-circular-progressbar", () => ({
  buildStyles: () => ({}),
  CircularProgressbarWithChildren: () => null,
}));
jest.mock("@tabler/icons-react", () => ({ IconRefresh: () => null }));
jest.mock("../../Question", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/Loading", () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));
jest.mock("@/components/ReportModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/GradeSyncStatus", () => ({
  __esModule: true,
  default: (props: { lmsHost?: string }) => (
    <div data-testid="grade-sync" data-lms-host={props.lmsHost} />
  ),
}));
jest.mock("@/components/promo/PromoBanner", () => ({
  __esModule: true,
  default: (props: { placement: string; lmsHost?: string }) => (
    <div
      data-testid="promo"
      data-placement={props.placement}
      data-lms-host={props.lmsHost}
    />
  ),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock("@/components/ErrorModal", () => ({
  __esModule: true,
  default: (props: { statusCode: number; headline: string; error: string }) => (
    <div
      data-testid="error-modal"
      data-status={String(props.statusCode)}
      data-headline={props.headline}
    >
      {props.error}
    </div>
  ),
}));

const getUserMock = getUser as jest.Mock;
const getCompletedAttemptMock = getCompletedAttempt as jest.Mock;
const getAttemptsMock = getAttempts as jest.Mock;

const learner = {
  role: "learner",
  userId: "learner-1",
  assignmentId: 3532,
  returnUrl: "",
};

const loadedAttempt = {
  id: 2486,
  name: "Quiz",
  questions: [],
  showQuestions: false,
  grade: 0.9,
  passingGrade: 50,
  passed: true,
  totalPossiblePoints: 10,
  totalPointsEarned: 9,
};

// The /api proxy answers 500 when the API does not respond within 30s.
const proxyTimeout = () => new APIError("x", 500, "Internal Server Error");

const TROUBLE_HEADING = { name: /having trouble loading your results/i };

// jest.setup.js replaces MessageChannel, which React's scheduler uses to
// flush work, so async state has to be settled inside act() here.
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderAndSettle = async () => {
  await act(async () => {
    render(<SuccessPage />);
  });
  await settle();
};

// Longer than the largest jittered automatic-retry delay.
const advancePastNextRetry = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(12_001);
  });
  await settle();
};

const clickTryAgain = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  });
  await settle();
};

describe("results page — temporary failures retry instead of reporting a missing attempt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    getUserMock.mockResolvedValue(learner);
    getAttemptsMock.mockResolvedValue([{ id: 2486, submitted: true }]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("retries a proxy timeout by itself and shows the results once it loads", async () => {
    getCompletedAttemptMock
      .mockRejectedValueOnce(proxyTimeout())
      .mockResolvedValueOnce(loadedAttempt);

    await renderAndSettle();

    expect(screen.getByRole("heading", TROUBLE_HEADING)).toBeInTheDocument();
    expect(screen.getByText(/trying again automatically/i)).toBeInTheDocument();
    expect(screen.queryByTestId("error-modal")).toBeNull();
    // A timed-out read is not a missing attempt: no fallback lookup.
    expect(getAttemptsMock).not.toHaveBeenCalled();

    await advancePastNextRetry();

    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", TROUBLE_HEADING)).toBeNull();
    expect(screen.queryByTestId("error-modal")).toBeNull();
    expect(screen.getByTestId("grade-sync")).toBeInTheDocument();
  });

  it("stops retrying automatically after a few attempts and leaves a manual retry", async () => {
    getCompletedAttemptMock.mockRejectedValue(proxyTimeout());

    await renderAndSettle();
    for (let retry = 0; retry < 3; retry++) {
      await advancePastNextRetry();
    }

    // The first load plus three automatic retries.
    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(4);
    expect(screen.getByText(/still did not load/i)).toBeInTheDocument();

    await advancePastNextRetry();
    await advancePastNextRetry();
    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(4);

    getCompletedAttemptMock.mockResolvedValueOnce(loadedAttempt);
    await clickTryAgain();

    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole("heading", TROUBLE_HEADING)).toBeNull();
    expect(screen.getByTestId("grade-sync")).toBeInTheDocument();
  });

  it("lets the learner retry straight away without waiting for the timer", async () => {
    getCompletedAttemptMock
      .mockRejectedValueOnce(new APIError("x", 503, "Service Unavailable"))
      .mockResolvedValueOnce(loadedAttempt);

    await renderAndSettle();
    await clickTryAgain();

    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("grade-sync")).toBeInTheDocument();

    // The pending automatic retry was cancelled by the manual one.
    await advancePastNextRetry();
    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(2);
  });

  it("retries a user lookup that failed on the server", async () => {
    getUserMock
      .mockRejectedValueOnce(new Error("Failed to fetch user"))
      .mockResolvedValueOnce(learner);
    getCompletedAttemptMock.mockResolvedValue(loadedAttempt);

    await renderAndSettle();
    expect(screen.getByRole("heading", TROUBLE_HEADING)).toBeInTheDocument();

    await advancePastNextRetry();

    expect(getUserMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("grade-sync")).toBeInTheDocument();
  });

  it("shows the missing-attempt screen if a retry finds the attempt is really gone", async () => {
    getCompletedAttemptMock
      .mockRejectedValueOnce(proxyTimeout())
      .mockResolvedValueOnce(undefined);

    await renderAndSettle();
    await advancePastNextRetry();

    expect(screen.queryByRole("heading", TROUBLE_HEADING)).toBeNull();
    expect(screen.getByTestId("error-modal")).toHaveAttribute(
      "data-status",
      "404",
    );
    // The fallback lookup for another of the learner's attempts still runs.
    expect(getAttemptsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a real 404 on the missing-attempt screen without retrying", async () => {
    getCompletedAttemptMock.mockResolvedValue(undefined);

    await renderAndSettle();
    await advancePastNextRetry();

    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(1);
    expect(getAttemptsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error-modal")).toHaveAttribute(
      "data-status",
      "404",
    );
    expect(screen.queryByRole("heading", TROUBLE_HEADING)).toBeNull();
  });

  it.each([401, 403])(
    "keeps a %i on its own screen without retrying",
    async (status) => {
      getCompletedAttemptMock.mockRejectedValue(
        new APIError("x", status, "denied"),
      );

      await renderAndSettle();
      await advancePastNextRetry();

      expect(getCompletedAttemptMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("error-modal")).toHaveAttribute(
        "data-status",
        String(status),
      );
      expect(screen.queryByRole("heading", TROUBLE_HEADING)).toBeNull();
    },
  );

  it("retries a request that got no response on the connection screen", async () => {
    getCompletedAttemptMock
      .mockRejectedValueOnce(new NetworkError("x", "unreachable"))
      .mockResolvedValueOnce(loadedAttempt);

    await renderAndSettle();
    expect(
      screen.getByRole("heading", { name: /couldn't reach/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/trying again automatically/i)).toBeInTheDocument();

    await advancePastNextRetry();

    expect(getCompletedAttemptMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("grade-sync")).toBeInTheDocument();
  });
});
