/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import ErrorPage from "../ErrorPage";

describe("ErrorPage", () => {
  it("renders the headline, message, steps and support details for a status", () => {
    render(<ErrorPage error="Something broke" statusCode={500} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong on our side/i }),
    ).toBeInTheDocument();
    // The message shows in the header and again in the support details.
    expect(screen.getAllByText("Something broke").length).toBeGreaterThan(0);
    expect(screen.getByText(/what you can do/i)).toBeInTheDocument();
    expect(screen.getByText(/details for support/i)).toBeInTheDocument();
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
});
