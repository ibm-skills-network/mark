import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import AuthorAccess from "../AuthorAccess";
import { getUser } from "@/lib/shared";
import { apiClient, APIError } from "@/lib/api-client";
import { useAuthorStore } from "@/stores/author";

jest.mock("@/lib/shared", () => ({ getUser: jest.fn() }));
jest.mock("@/lib/author", () => ({}));
jest.mock("../ErrorModal", () => () => <div>Assignment error</div>);

const author = {
  userId: "author@example.test",
  assignmentId: 4892,
  role: "author" as const,
  returnUrl: "",
};
const originalFetch = global.fetch;

beforeEach(() => {
  window.history.replaceState({}, "", "/author/4892/questions");
  useAuthorStore.setState({ pageState: "success", activeAssignmentId: 4892 });
  jest.mocked(getUser).mockResolvedValue(author);
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

function show() {
  return render(
    <AuthorAccess assignmentId={4892} awbUrl="https://author.example">
      <input aria-label="Quiz title" defaultValue="Original" />
      <button
        onClick={() => {
          // Same request/error path as Header.SyncAssignment.
          void apiClient
            .get("/api/v1/assignments/4892")
            .catch((error: unknown) =>
              useAuthorStore.getState().setPageError(error),
            );
        }}
      >
        Sync assignment
      </button>
    </AuthorAccess>,
  );
}

it("restores the same draft after a sync 401 and successful reauthentication", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    json: async () => ({ message: "Expired" }),
  });
  await act(async () => {
    show();
  });
  const input = await screen.findByLabelText("Quiz title");
  fireEvent.change(input, { target: { value: "Unsaved title" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sync assignment" }));
  });
  await screen.findByRole("heading", { name: "Sign in to edit this quiz" });
  expect(input).not.toBeVisible();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check access again" }));
  });
  await waitFor(() => expect(input).toBeVisible());
  expect(input).toHaveValue("Unsaved title");
  expect(screen.queryByText("Assignment error")).not.toBeInTheDocument();
});

it("keeps genuine sync failures visible after a successful session check", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    json: async () => ({ message: "Failed to load" }),
  });
  await act(async () => {
    show();
  });
  const input = await screen.findByLabelText("Quiz title");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sync assignment" }));
  });
  expect(await screen.findByText("Assignment error")).toBeVisible();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(input).not.toBeVisible();
  expect(screen.getByText("Assignment error")).toBeVisible();
});

it("does not clear an existing workspace error when a session expires", () => {
  useAuthorStore.setState({ pageState: "error" });
  useAuthorStore
    .getState()
    .setPageError(new APIError("Expired", 401, "Unauthorized"));
  expect(useAuthorStore.getState().pageState).toBe("error");
});
