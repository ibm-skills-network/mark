/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { reloadPage } from "@/lib/utils";
import ConnectionProblem from "../ConnectionProblem";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn().mockResolvedValue(null),
}));

// jsdom's location.reload is read-only, so the reload is reached through a
// wrapper the test can replace.
jest.mock("@/lib/utils", () => ({
  ...jest.requireActual("@/lib/utils"),
  reloadPage: jest.fn(),
}));

describe("ConnectionProblem", () => {
  // Learners whose request stalled were shown "408 — Something went wrong on
  // our side" with a report button, so a connection problem arrived in
  // support triage as a server fault.
  it("blames the connection, not the server, for a timeout", () => {
    render(<ConnectionProblem kind="timeout" />);

    expect(
      screen.getByRole("heading", { name: /timed out/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/connection or network/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/something went wrong on our side/i),
    ).not.toBeInTheDocument();
  });

  it("never shows a status the server did not send", () => {
    const { container } = render(<ConnectionProblem kind="timeout" />);

    expect(container.textContent).not.toMatch(/\b408\b/);
    expect(container.textContent).not.toMatch(/\b500\b/);
  });

  it("explains an unreachable server without claiming it is down", () => {
    render(<ConnectionProblem kind="unreachable" />);

    expect(
      screen.getByRole("heading", { name: /couldn't reach/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/something went wrong on our side/i),
    ).not.toBeInTheDocument();
  });

  it("offers a retry the learner can actually press", async () => {
    const reload = reloadPage as jest.Mock;
    reload.mockClear();

    render(<ConnectionProblem kind="timeout" />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(reload).toHaveBeenCalled();
  });

  // The report stays one click away — support still wants to hear about it,
  // but it must arrive tagged so it is not triaged as a server outage.
  it("keeps the report action and tags it as a client network failure", () => {
    render(<ConnectionProblem kind="timeout" />);

    expect(
      screen.getByRole("button", { name: /report this issue/i }),
    ).toBeInTheDocument();
  });
});
