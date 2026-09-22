/**
 * @jest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import { ReportDiagnosticsPanel } from "../ReportDiagnosticsPanel";
import { getAdminReportDiagnostics } from "@/lib/talkToBackend";

jest.mock("@/lib/talkToBackend", () => ({
  getAdminReportDiagnostics: jest.fn(),
}));

const capture = {
  reportId: 7,
  capturedAt: "2026-09-17T15:00:00.000Z",
  diagnostics: {
    session: { attemptId: 1630573, attemptLanguage: "es", uiLanguage: "es" },
    page: { inIframe: true, viewport: "1400x1000" },
    rendered: [
      {
        questionId: 29377,
        type: "SINGLE_CORRECT",
        choices: [
          { text: "Apache Kafka y Apache Flink", selected: true },
          { text: "Apache Hadoop y Apache Spark", selected: false },
        ],
      },
    ],
    requests: [
      {
        method: "PATCH",
        path: "/api/v2/assignments/3723/attempts/1630573",
        status: 504,
        ms: 30011,
        requestId: "bcbd8b715d12",
      },
    ],
  },
};

// The load resolves after mount; doing it inside act lets React flush the
// resulting state (the test scheduler does not run on its own here).
const mount = () =>
  act(async () => {
    render(<ReportDiagnosticsPanel reportId={7} sessionToken="admin-token" />);
    await Promise.resolve();
  });

describe("ReportDiagnosticsPanel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows an admin what the reporter saw and which requests failed", async () => {
    (getAdminReportDiagnostics as jest.Mock).mockResolvedValue(capture);

    await mount();

    // The attempt id also appears inside the recorded request path.
    expect(await screen.findByText("1630573")).toBeInTheDocument();
    expect(screen.getByText("Apache Kafka y Apache Flink")).toBeInTheDocument();
    expect(screen.getByText(/bcbd8b715d12/)).toBeInTheDocument();
    expect(screen.getByText("504")).toBeInTheDocument();
    expect(getAdminReportDiagnostics).toHaveBeenCalledWith(7, "admin-token");
  });

  it("says so when the report has no capture", async () => {
    (getAdminReportDiagnostics as jest.Mock).mockResolvedValue(null);

    await mount();

    expect(
      await screen.findByText(/No diagnostics were captured/i),
    ).toBeInTheDocument();
  });

  it("reports a failed load instead of looking empty", async () => {
    (getAdminReportDiagnostics as jest.Mock).mockRejectedValue(
      new Error("Forbidden"),
    );

    await mount();

    expect(
      await screen.findByText(/Could not load diagnostics/i),
    ).toBeInTheDocument();
  });
});
