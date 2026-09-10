import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import AuthorAccess from "../AuthorAccess";
import { getUser } from "@/lib/shared";
import { APIError } from "@/lib/api-client";

jest.mock("@/lib/shared", () => ({ getUser: jest.fn() }));
jest.mock("@/lib/api-client", () => ({
  APIError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
jest.mock("@/stores/author", () => ({
  useAuthorStore: Object.assign(() => "editing", { setState: jest.fn() }),
}));
jest.mock("../ErrorModal", () => () => <div>Assignment error</div>);

const author = {
  userId: "author@example.test",
  assignmentId: 4892,
  role: "author" as const,
  returnUrl: "",
};
const getSession = jest.mocked(getUser);
const show = () =>
  render(
    <AuthorAccess
      assignmentId={4892}
      awbUrl="https://author.example"
      providerId="7"
    >
      <input aria-label="Quiz title" defaultValue="Original" />
    </AuthorAccess>,
  );

beforeEach(() => {
  jest.clearAllMocks();
});

it("offers the correct AWB recovery link for a missing session, without mounting the editor", async () => {
  getSession.mockRejectedValue(
    new APIError("Unauthorized", 401, "Unauthorized"),
  );
  await act(async () => {
    show();
  });
  expect(
    await screen.findByRole("heading", { name: "Sign in to edit this quiz" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Sign in through Author Workbench" }),
  ).toHaveAttribute(
    "href",
    "https://author.example/assignments/from-mark/4892?provider_id=7",
  );
  expect(screen.queryByLabelText("Quiz title")).not.toBeInTheDocument();
});

it.each([
  { ...author, role: "learner" as const },
  { ...author, assignmentId: 4941 },
])("requires a matching author launch", async (user) => {
  getSession.mockResolvedValue(user);
  await act(async () => {
    show();
  });
  expect(
    await screen.findByRole("heading", { name: "Sign in to edit this quiz" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("Quiz title")).not.toBeInTheDocument();
});

it("preserves unsaved editor state through expiry and same-account recovery", async () => {
  getSession.mockResolvedValue(author);
  await act(async () => {
    show();
  });
  const input = await screen.findByLabelText("Quiz title");
  fireEvent.change(input, { target: { value: "Unsaved title" } });
  act(() => window.dispatchEvent(new Event("mark-author-auth-required")));
  expect(input).not.toBeVisible();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check access again" }));
  });
  await waitFor(() => expect(input).toBeVisible());
  expect(input).toHaveValue("Unsaved title");
});

it("does not reopen another account's unsaved editor", async () => {
  getSession
    .mockResolvedValueOnce(author)
    .mockResolvedValueOnce({ ...author, userId: "other@example.test" })
    .mockResolvedValue(author);
  await act(async () => {
    show();
  });
  const input = await screen.findByLabelText("Quiz title");
  fireEvent.change(input, { target: { value: "Private draft" } });
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(
    await screen.findByRole("heading", {
      name: "Your signed-in account changed",
    }),
  ).toBeVisible();
  expect(input).not.toBeVisible();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check access again" }));
  });
  await waitFor(() => expect(input).toBeVisible());
  expect(input).toHaveValue("Private draft");
});

it("ignores a session check that completed after an unauthorized API response", async () => {
  let resolveSession: (user: typeof author) => void = () => {
    throw new Error("Not initialized");
  };
  getSession.mockReturnValue(
    new Promise((resolve) => {
      resolveSession = resolve;
    }),
  );
  await act(async () => {
    show();
  });
  act(() => window.dispatchEvent(new Event("mark-author-auth-required")));
  await act(async () => {
    resolveSession(author);
  });
  expect(
    screen.getByRole("heading", { name: "Sign in to edit this quiz" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("Quiz title")).not.toBeInTheDocument();
});
