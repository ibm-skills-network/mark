import { act, render, screen } from "@testing-library/react";
import GradeSyncStatus from "../GradeSyncStatus";

const renderStatus = async (status: string) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status }),
  });
  await act(async () => {
    render(<GradeSyncStatus assignmentId={123} attemptId={456} />);
  });
};

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
});
