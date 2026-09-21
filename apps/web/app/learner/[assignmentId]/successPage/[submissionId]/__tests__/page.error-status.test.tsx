import { act, render, screen } from "@testing-library/react";
import { APIError } from "@/lib/api-client";
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
  default: () => null,
}));
jest.mock("@/components/promo/PromoBanner", () => ({
  __esModule: true,
  default: () => null,
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

describe("results page — a failed load is reported as what failed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserMock.mockResolvedValue(learner);
    getAttemptsMock.mockResolvedValue([]);
  });

  // jest.setup.js replaces MessageChannel, which React's scheduler uses to
  // flush work, so async state has to be settled inside act() here.
  const renderAndSettle = async () => {
    await act(async () => {
      render(<SuccessPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("asks the fetcher to surface failures rather than report them as a missing attempt", async () => {
    getCompletedAttemptMock.mockResolvedValue(undefined);

    await renderAndSettle();

    expect(getCompletedAttemptMock).toHaveBeenCalledWith(
      3532,
      2486,
      undefined,
      expect.objectContaining({ throwOnError: true }),
    );
  });

  it.each([
    ["a server fault", 500],
    ["a gateway failure", 502],
    ["a gateway timeout", 504],
  ])(
    "shows %s as itself, not as someone else's submission",
    async (_label, status) => {
      getCompletedAttemptMock.mockRejectedValue(
        new APIError("x", status, "failed"),
      );

      await renderAndSettle();

      const modal = screen.getByTestId("error-modal");
      expect(modal).toHaveAttribute("data-status", String(status));
      expect(modal).not.toHaveTextContent(/belongs to another account/i);
      expect(modal).not.toHaveTextContent(/no longer exists/i);
    },
  );

  it("does not blame the learner's session when the server fails under a replaced session", async () => {
    // The session belongs to a later launch AND the request failed on the
    // server: the outage is the thing to report.
    getUserMock.mockResolvedValue({ ...learner, assignmentId: 3528 });
    getCompletedAttemptMock.mockRejectedValue(new APIError("x", 503, "failed"));

    await renderAndSettle();

    const modal = screen.getByTestId("error-modal");
    expect(modal).toHaveAttribute("data-status", "503");
    expect(modal.getAttribute("data-headline")).not.toMatch(
      /another assignment/i,
    );
  });

  it("still explains a replaced session when the server refused the read", async () => {
    getUserMock.mockResolvedValue({ ...learner, assignmentId: 3528 });
    getCompletedAttemptMock.mockRejectedValue(
      new APIError("x", 403, "Forbidden"),
    );

    await renderAndSettle();

    const modal = screen.getByTestId("error-modal");
    expect(modal).toHaveAttribute("data-status", "403");
    expect(modal.getAttribute("data-headline")).toMatch(/another assignment/i);
  });

  it("still reports a genuinely missing attempt as missing", async () => {
    getCompletedAttemptMock.mockResolvedValue(undefined);

    await renderAndSettle();

    expect(screen.getByTestId("error-modal")).toHaveAttribute(
      "data-status",
      "404",
    );
  });
});
