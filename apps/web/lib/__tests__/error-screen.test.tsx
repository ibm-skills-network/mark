/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { NetworkError } from "../api-client";
import { ErrorScreen, statusFromError } from "../error-screen";

// Stub the three screens to distinctive markers so the test asserts the
// mapping, not each screen's internals.
jest.mock("@/components/SessionExpired", () => ({
  __esModule: true,
  default: () => <div data-testid="session-expired" />,
}));
jest.mock("@/components/AccessRestricted", () => ({
  __esModule: true,
  default: () => <div data-testid="access-restricted" />,
}));
jest.mock("@/components/ErrorPage", () => ({
  __esModule: true,
  default: (props: { statusCode?: number }) => (
    <div data-testid="error-page">{props.statusCode}</div>
  ),
}));
jest.mock("@/components/ConnectionProblem", () => ({
  __esModule: true,
  default: (props: { kind: string }) => (
    <div data-testid="connection-problem">{props.kind}</div>
  ),
}));

describe("statusFromError", () => {
  it("reads .status from an APIError-shaped object", () => {
    expect(statusFromError({ status: 401 })).toBe(401);
    expect(statusFromError({ status: 403 })).toBe(403);
    expect(statusFromError({ status: 500 })).toBe(500);
  });

  it("maps getUser's Error('Unauthorized') to 401", () => {
    expect(statusFromError(new Error("Unauthorized"))).toBe(401);
    expect(statusFromError(new Error("unauthorized"))).toBe(401);
  });

  it("falls back to 500 for opaque / network errors", () => {
    expect(statusFromError(new Error("Failed to fetch"))).toBe(500);
    expect(statusFromError("boom")).toBe(500);
    expect(statusFromError(null)).toBe(500);
    expect(statusFromError(undefined)).toBe(500);
  });
});

describe("ErrorScreen mapping", () => {
  it("401 -> SessionExpired (reload can re-establish the session)", () => {
    render(<ErrorScreen status={401} />);
    expect(screen.getByTestId("session-expired")).toBeInTheDocument();
  });

  it("403 -> AccessRestricted (reload won't help)", () => {
    render(<ErrorScreen status={403} />);
    expect(screen.getByTestId("access-restricted")).toBeInTheDocument();
  });

  it("other statuses -> ErrorPage carrying the real status", () => {
    render(<ErrorScreen status={500} message="kaboom" />);
    const page = screen.getByTestId("error-page");
    expect(page).toBeInTheDocument();
    expect(page).toHaveTextContent("500");
  });
});

// A stalled or dropped browser request produced no HTTP response at all, so
// presenting it as one of the server's statuses ("408 — Something went wrong
// on our side") both misinforms the learner and files a server fault against
// a connection problem.
describe("ErrorScreen with a client network failure", () => {
  it("shows the connection screen for a timeout instead of a status page", () => {
    const error = new NetworkError("timed out", "timeout");

    render(<ErrorScreen status={statusFromError(error)} error={error} />);

    expect(screen.getByTestId("connection-problem")).toHaveTextContent(
      "timeout",
    );
    expect(screen.queryByTestId("error-page")).not.toBeInTheDocument();
  });

  it("shows the connection screen when the server could not be reached", () => {
    const error = new NetworkError("dropped", "unreachable");

    render(<ErrorScreen status={statusFromError(error)} error={error} />);

    expect(screen.getByTestId("connection-problem")).toHaveTextContent(
      "unreachable",
    );
  });

  it("still renders real statuses when an error is passed alongside", () => {
    const error = { status: 403 };

    render(<ErrorScreen status={statusFromError(error)} error={error} />);

    expect(screen.getByTestId("access-restricted")).toBeInTheDocument();
  });
});
