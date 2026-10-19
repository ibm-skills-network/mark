import { act, render, screen } from "@testing-library/react";
import GradeSyncStatus, {
  YOUR_LEARNING_SYNC_HEADING,
  YOUR_LEARNING_SYNC_MESSAGE,
} from "../GradeSyncStatus";

const YL_HOST = "courses.yl.skillsnetwork.site";

const renderBody = async (body: string, lmsHost?: string) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => body,
  });
  await act(async () => {
    render(
      <GradeSyncStatus assignmentId={123} attemptId={456} lmsHost={lmsHost} />,
    );
  });
};

const renderStatus = (status: string, lmsHost?: string) =>
  renderBody(JSON.stringify({ status }), lmsHost);

const PER_STATUS_HEADLINES = [
  "Your completion was sent to your course platform",
  "Syncing your completion to your course platform...",
  "Your completion is safely recorded with us",
];

describe("GradeSyncStatus for yourLearning launches", () => {
  it.each(["SUCCESS", "IN_PROGRESS", "PENDING", "SCHEDULED", "FAILED"])(
    "shows only the yourLearning notice when the sync is %s",
    async (status) => {
      await renderStatus(status, YL_HOST);

      const notice = await screen.findByTestId("yourlearning-sync-notice");
      expect(notice).toHaveAttribute("role", "status");
      expect(
        screen.getByRole("heading", { name: YOUR_LEARNING_SYNC_HEADING }),
      ).toBeInTheDocument();
      expect(screen.getByText(YOUR_LEARNING_SYNC_MESSAGE)).toBeInTheDocument();
      expect(YOUR_LEARNING_SYNC_MESSAGE).toMatch(/can take a few hours/);
      expect(YOUR_LEARNING_SYNC_MESSAGE).toMatch(/please be patient/);
      for (const headline of PER_STATUS_HEADLINES) {
        expect(screen.queryByText(headline)).not.toBeInTheDocument();
      }
    },
  );

  it("renders nothing when a yourLearning attempt has no sync row", async () => {
    await renderBody("", YL_HOST);

    expect(
      screen.queryByTestId("yourlearning-sync-notice"),
    ).not.toBeInTheDocument();
  });

  it.each([undefined, "courses.cognitiveclass.ai", "www.coursera.org"])(
    "keeps the per-status box for lmsHost %s",
    async (lmsHost) => {
      await renderStatus("SUCCESS", lmsHost);

      expect(
        await screen.findByText(
          "Your completion was sent to your course platform",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("yourlearning-sync-notice"),
      ).not.toBeInTheDocument();
    },
  );
});

describe("GradeSyncStatus", () => {
  it("explains the LMS display delay after a successful delivery", async () => {
    await renderStatus("SUCCESS");

    expect(
      await screen.findByText(
        "Your completion was sent to your course platform",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/may take a couple of hours/)).toBeInTheDocument();
    expect(
      screen.queryByText("Your completion is safely recorded with us"),
    ).not.toBeInTheDocument();
  });

  it("explains the same display delay while delivery is in progress", async () => {
    await renderStatus("IN_PROGRESS");

    expect(
      await screen.findByText(
        "Syncing your completion to your course platform...",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/may take a couple of hours/)).toBeInTheDocument();
  });

  it("keeps the retry message for a failed delivery", async () => {
    await renderStatus("SCHEDULED");

    expect(
      await screen.findByText("Your completion is safely recorded with us"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/still syncing your completion/),
    ).toBeInTheDocument();
  });

  it("renders nothing and logs no error when the attempt has no sync row", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await renderBody("");

    expect(
      screen.queryByText("Checking grade sync status..."),
    ).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
