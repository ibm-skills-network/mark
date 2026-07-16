/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportBugButton from "../ReportBugButton";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn().mockResolvedValue({
    userId: "tester@example.com",
    role: "learner",
    assignmentId: 42,
    returnUrl: "",
  }),
}));

jest.mock("sonner", () => ({
  toast: {
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe("ReportBugButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "ok", issueNumber: 1 }),
    });
  });

  it("renders the floating flag button", () => {
    render(<ReportBugButton />);

    expect(
      screen.getByRole("button", { name: /report a bug/i }),
    ).toBeInTheDocument();
  });

  it("opens the report dialog when the flag is clicked", async () => {
    const user = userEvent.setup();
    render(<ReportBugButton />);

    await user.click(screen.getByRole("button", { name: /report a bug/i }));

    expect(await screen.findByText("Report Issue")).toBeInTheDocument();
    expect(screen.getByText(/steps to reproduce/i)).toBeInTheDocument();
  });

  it("submits the filled form to the reports endpoint", async () => {
    const user = userEvent.setup();
    render(<ReportBugButton />);

    await user.click(screen.getByRole("button", { name: /report a bug/i }));
    await screen.findByText("Report Issue");

    await user.type(
      screen.getByPlaceholderText(/^1\./),
      "Open assignment, click submit",
    );
    await user.type(
      screen.getByPlaceholderText(/what you expected to happen/i),
      "It submits",
    );
    await user.type(
      screen.getByPlaceholderText(/what actually happened/i),
      "It crashed",
    );

    const submitButton = screen
      .getAllByRole("button", { name: /^submit/i })
      .find((button) => !button.hasAttribute("disabled"));
    expect(submitButton).toBeDefined();
    await user.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/reports");
    expect(options.method).toBe("POST");

    const formData = options.body as FormData;
    expect(formData.get("description")).toContain(
      "Open assignment, click submit",
    );
    expect(formData.get("userEmail")).toBe("tester@example.com");
    expect(formData.get("assignmentId")).toBe("42");
  });
});
