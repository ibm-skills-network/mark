/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorPage from "../ErrorPage";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn().mockResolvedValue({
    userId: "learner@example.com",
    role: "learner",
    assignmentId: 42,
    returnUrl: "",
  }),
}));

describe("ErrorPage", () => {
  it("renders the headline, message and steps for a status", () => {
    render(<ErrorPage error="Something broke" statusCode={500} />);

    expect(
      screen.getByRole("heading", {
        name: /something went wrong on our side/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(screen.getByText(/what you can do/i)).toBeInTheDocument();
  });

  it("does not duplicate the message in a support panel", () => {
    render(<ErrorPage error="Something broke" statusCode={500} />);

    // The message shows once, in the header — there's no redundant
    // "Details for support" panel re-printing the header facts.
    expect(screen.getAllByText("Something broke")).toHaveLength(1);
    expect(screen.queryByText(/details for support/i)).not.toBeInTheDocument();
  });

  it("renders caller-provided support details when present", () => {
    render(
      <ErrorPage
        error="x"
        statusCode={500}
        debugDetails={[{ label: "Request ID", value: "abc-123" }]}
      />,
    );
    expect(screen.getByText("Request ID")).toBeInTheDocument();
    expect(screen.getByText("abc-123")).toBeInTheDocument();
  });

  it("omits the activity timeline when there are no events", () => {
    render(<ErrorPage error="x" statusCode={500} />);
    expect(screen.queryByText(/recent activity/i)).not.toBeInTheDocument();
  });

  it("shows the activity timeline when events are provided", () => {
    render(
      <ErrorPage
        error="x"
        statusCode={500}
        stateTimeline={[{ step: "Loaded page" }]}
      />,
    );
    expect(screen.getByText(/recent activity/i)).toBeInTheDocument();
    expect(screen.getByText("Loaded page")).toBeInTheDocument();
  });

  it("always renders a prominent report button", () => {
    render(<ErrorPage error="Something broke" statusCode={500} />);
    expect(
      screen.getByRole("button", { name: /report this issue/i }),
    ).toBeInTheDocument();
  });

  it("opens the report form prefilled from the error", async () => {
    const user = userEvent.setup();
    render(
      <ErrorPage
        error="Attempts could not be fetched"
        statusCode={500}
        stateTimeline={[{ step: "Attempts fetch failed" }]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /report this issue/i }),
    );

    expect(await screen.findByText(/report issue/i)).toBeInTheDocument();
    // The required "Actual result" field arrives prefilled with the error.
    expect(
      screen.getByDisplayValue(/Attempts could not be fetched/),
    ).toBeInTheDocument();
  });
});
