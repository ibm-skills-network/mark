/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import AuthFetchToAbout from "../AuthFetchToAbout";
import { getAssignment, getAttempts } from "@/lib/talkToBackend";
import { recentClientErrors, clearRequestLog } from "@/lib/request-log";

let searchParams = new URLSearchParams("");

jest.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

jest.mock("@/lib/talkToBackend", () => ({
  getAssignment: jest.fn(),
  getAttempts: jest.fn(),
}));

jest.mock("@/app/loading", () => ({
  __esModule: true,
  default: () => <div data-testid="loading" />,
}));

// The About page is the success marker; it also exposes the component's own
// fetchData so a test can run the reload the learner would trigger.
let exposedFetchData: (() => Promise<void>) | undefined;
jest.mock("../../(components)/AboutTheAssignment", () => ({
  __esModule: true,
  default: (props: { fetchData: () => Promise<void> }) => {
    exposedFetchData = props.fetchData;
    return <div data-testid="about" />;
  },
}));

jest.mock("@/lib/error-screen", () => ({
  ErrorScreen: (props: { status: number }) => (
    <div data-testid="error-screen">{props.status}</div>
  ),
  statusFromError: (error: { status?: number }) => error?.status ?? 500,
}));

jest.mock("@/components/ErrorPage", () => ({
  __esModule: true,
  default: () => <div data-testid="error-page" />,
}));

const getAssignmentMock = getAssignment as jest.Mock;
const getAttemptsMock = getAttempts as jest.Mock;

const assignment = { id: 3049, name: "Lab", allotedTimeMinutes: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Renders, letting the load's promises settle inside act. */
async function renderSettled(ui: React.ReactElement) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(ui);
  });
  return view;
}

async function rerenderSettled(
  view: ReturnType<typeof render>,
  ui: React.ReactElement,
) {
  await act(async () => {
    view.rerender(ui);
  });
}

const props = {
  assignmentId: 3049,
  role: "learner" as const,
  cookie: "",
  lmsHost: undefined,
};

describe("AuthFetchToAbout", () => {
  beforeEach(() => {
    getAssignmentMock.mockReset();
    getAttemptsMock.mockReset();
    clearRequestLog();
    searchParams = new URLSearchParams("");
    exposedFetchData = undefined;
    getAttemptsMock.mockResolvedValue([]);
  });

  // The load re-runs when the language in the URL changes, so two loads overlap. When
  // the superseded one failed, its error used to be stored anyway and was
  // checked before the assignment, replacing a page that had loaded fine.
  it("ignores a failure from a load that was superseded", async () => {
    const first = deferred<typeof assignment>();
    getAssignmentMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(assignment);

    const view = await renderSettled(<AuthFetchToAbout {...props} />);

    searchParams = new URLSearchParams("lang=es");
    await rerenderSettled(view, <AuthFetchToAbout {...props} />);
    expect(await screen.findByTestId("about")).toBeInTheDocument();

    await act(async () => {
      first.reject(new TypeError("network error"));
    });

    expect(screen.queryByTestId("error-screen")).not.toBeInTheDocument();
    expect(screen.getByTestId("about")).toBeInTheDocument();
  });

  it("clears an earlier failure once a later load succeeds", async () => {
    getAssignmentMock
      .mockRejectedValueOnce(Object.assign(new Error("x"), { status: 503 }))
      .mockResolvedValueOnce(assignment);

    const view = await renderSettled(<AuthFetchToAbout {...props} />);
    expect(await screen.findByTestId("error-screen")).toHaveTextContent("503");

    searchParams = new URLSearchParams("lang=es");
    await rerenderSettled(view, <AuthFetchToAbout {...props} />);

    expect(await screen.findByTestId("about")).toBeInTheDocument();
    expect(screen.queryByTestId("error-screen")).not.toBeInTheDocument();
    expect(exposedFetchData).toBeDefined();
  });

  // Triage could not tell which exception produced the screen; the report
  // capture now carries its name and message.
  it("records the failure that produced the error screen for the report", async () => {
    getAssignmentMock.mockRejectedValueOnce(new SyntaxError("Unexpected end"));

    await renderSettled(<AuthFetchToAbout {...props} />);
    await screen.findByTestId("error-screen");

    expect(recentClientErrors()).toEqual([
      expect.objectContaining({
        name: "SyntaxError",
        message: "Unexpected end",
        where: "learner-about-load",
      }),
    ]);
  });
});
