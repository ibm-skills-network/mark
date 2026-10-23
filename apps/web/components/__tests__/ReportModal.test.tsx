/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { submitReportLearner } from "@/lib/talkToBackend";
import ReportModal from "../ReportModal";

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock("@/lib/talkToBackend", () => ({
  submitReportAuthor: jest.fn(),
  submitReportLearner: jest.fn(),
}));

describe("ReportModal", () => {
  it("sends one request for rapid repeated clicks", async () => {
    let resolve!: (value: { success: boolean }) => void;
    (submitReportLearner as jest.Mock).mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    const setIsReportModalOpen = jest.fn();
    render(
      <ReportModal
        assignmentId={1}
        attemptId={2}
        isAuthor={false}
        isReportModalOpen
        setIsReportModalOpen={setIsReportModalOpen}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("Provide details about the issue..."),
      { target: { value: "Something broke" } },
    );

    const button = screen.getByRole("button", { name: "Submit Report" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(submitReportLearner).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ success: true }));
    expect(setIsReportModalOpen).toHaveBeenCalledWith(false);
  });
});
