import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import AssignmentAttempts from "../page";

const mockListOfAttempts: Array<Record<string, unknown>> = [];

jest.mock("@/stores/learner", () => ({
  useLearnerOverviewStore: (selector: (state: unknown) => unknown) =>
    selector({ listOfAttempts: mockListOfAttempts }),
  useAssignmentDetails: (selector: (state: unknown) => unknown) =>
    selector({ assignmentDetails: { name: "Quiz" } }),
}));

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ isDark: false }),
}));

// Render every row's action cell directly; the table's own chrome is not
// what these tests are about.
jest.mock("react-data-table-component", () => ({
  __esModule: true,
  createTheme: jest.fn(),
  default: (props: {
    columns: Array<{
      name: string;
      cell?: (row: unknown) => React.ReactNode;
    }>;
    data: unknown[];
  }) => (
    <div>
      {props.data.map((row, index) => (
        <div key={index} data-testid="row">
          {props.columns
            .filter((column) => column.name === "Action")
            .map((column) => column.cell?.(row))}
        </div>
      ))}
    </div>
  ),
}));

const inAnHour = new Date(Date.now() + 60 * 60_000).toISOString();
const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();

describe("attempts list — where each row's action leads", () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    mockListOfAttempts.length = 0;
    open = jest.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    open.mockRestore();
  });

  it("opens a submitted attempt's results", () => {
    mockListOfAttempts.push({
      id: 71,
      assignmentId: 98,
      submitted: true,
      grade: 0.8,
      createdAt: anHourAgo,
      expiresAt: anHourAgo,
    });

    render(<AssignmentAttempts />);
    fireEvent.click(screen.getByRole("button", { name: /view/i }));

    expect(open).toHaveBeenCalledWith("/learner/98/successPage/71", "_self");
  });

  it("resumes an attempt that is still open instead of showing results it does not have", () => {
    mockListOfAttempts.push({
      id: 72,
      assignmentId: 98,
      submitted: false,
      grade: null,
      createdAt: anHourAgo,
      expiresAt: inAnHour,
    });

    render(<AssignmentAttempts />);
    expect(screen.queryByRole("button", { name: /view/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /resume/i }));

    expect(open).toHaveBeenCalledWith("/learner/98/questions", "_self");
  });

  it("offers nothing to open for an attempt that expired unsubmitted", () => {
    mockListOfAttempts.push({
      id: 73,
      assignmentId: 98,
      submitted: false,
      grade: null,
      createdAt: anHourAgo,
      expiresAt: anHourAgo,
    });

    render(<AssignmentAttempts />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/not submitted/i)).toBeInTheDocument();
  });
});
