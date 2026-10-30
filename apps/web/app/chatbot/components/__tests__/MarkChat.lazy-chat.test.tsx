import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { MarkChat } from "../MarkChat";
import { useMarkChatStore } from "../../store/useMarkChatStore";
import {
  addMessageToChat,
  endChat,
  findTodayChat,
  getOrCreateTodayChat,
} from "@/lib/shared";

jest.mock("@/lib/shared", () => ({
  getUser: jest
    .fn()
    .mockResolvedValue({ userId: "learner-1", role: "learner" }),
  findTodayChat: jest.fn(),
  getOrCreateTodayChat: jest.fn(),
  addMessageToChat: jest.fn(),
  endChat: jest.fn(),
}));

const markUnavailable = jest.fn();
jest.mock("../../../../hooks/useChatbot", () => ({
  useChatbot: () => ({
    isOpen: true,
    toggle: jest.fn(),
    isUnavailable: false,
    markUnavailable,
  }),
}));

const learnerContext = {
  assignmentId: 3670,
  currentQuestion: null,
  isFeedbackMode: false,
  isGradedAssignment: true,
  questions: [],
  getContextMessage: jest.fn().mockResolvedValue(null),
  setActiveQuestionNumber: jest.fn(),
};
jest.mock("../../store/useLearnerContext", () => ({
  useLearnerContext: () => learnerContext,
}));

const authorContext = {
  activeAssignmentId: null,
  getContextMessage: jest.fn().mockResolvedValue(null),
};
jest.mock("../../store/useAuthorContext", () => ({
  useAuthorContext: () => authorContext,
}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/ReportPreviewModal", () => ({
  __esModule: true,
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <button onClick={onClose}>report form</button> : null,
}));
jest.mock("@/lib/report-client", () => ({ submitBugReport: jest.fn() }));
jest.mock("sonner", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const sendMessage = jest.fn().mockResolvedValue(true);

const waitForInit = async () => {
  await waitFor(() => expect(findTodayChat).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.getByPlaceholderText("Ask Mark anything..."),
    ).not.toBeDisabled(),
  );
};

// jest.setup.js stubs MessageChannel, so updates must land inside act.
const flushUpdates = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const clickAndSettle = async (title: string, done: () => boolean) => {
  await act(async () => {
    fireEvent.click(screen.getByTitle(title));
    for (let tick = 0; tick < 50 && !done(); tick++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

const typeAndSend = async (text: string) => {
  await waitForInit();
  fireEvent.change(screen.getByPlaceholderText("Ask Mark anything..."), {
    target: { value: text },
  });
  const sent = () =>
    sendMessage.mock.calls.some(([, options]) => options?.userText === text);
  await clickAndSettle("Send message", sent);
  expect(sendMessage).toHaveBeenCalledWith(true, { userText: text });
};

describe("MarkChat chat rows", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
    window.scrollTo = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (findTodayChat as jest.Mock).mockResolvedValue({ id: null, messages: [] });
    (getOrCreateTodayChat as jest.Mock).mockResolvedValue({
      id: "chat-9",
      messages: [],
    });
    (addMessageToChat as jest.Mock).mockResolvedValue({ id: 1 });
    (endChat as jest.Mock).mockResolvedValue({ id: "chat-9" });
    useMarkChatStore.setState({
      userRole: "learner",
      isTyping: false,
      userInput: "",
      sendMessage,
    });
  });

  it("opening the chat only looks up today's chat and creates nothing", async () => {
    render(<MarkChat />);
    await waitForInit();

    expect(findTodayChat).toHaveBeenCalledWith("learner-1", 3670);
    expect(getOrCreateTodayChat).not.toHaveBeenCalled();
    expect(addMessageToChat).not.toHaveBeenCalled();
  });

  it("hides the chat when the lookup is forbidden", async () => {
    (findTodayChat as jest.Mock).mockRejectedValue({ status: 403 });

    render(<MarkChat />);

    await waitFor(() => expect(markUnavailable).toHaveBeenCalled());
    expect(getOrCreateTodayChat).not.toHaveBeenCalled();
  });

  it("creates the chat on the first send and reuses it afterwards", async () => {
    render(<MarkChat />);

    await typeAndSend("hi");
    expect(getOrCreateTodayChat).toHaveBeenCalledTimes(1);
    expect(getOrCreateTodayChat).toHaveBeenCalledWith(
      "learner-1",
      3670,
      expect.any(String),
    );
    expect(addMessageToChat).toHaveBeenCalledWith(
      "chat-9",
      "USER",
      "hi",
      expect.any(String),
    );

    await typeAndSend("again");
    expect(getOrCreateTodayChat).toHaveBeenCalledTimes(1);
    expect(addMessageToChat).toHaveBeenLastCalledWith(
      "chat-9",
      "USER",
      "again",
      expect.any(String),
    );
  });

  it("restores today's chat and sends into it without creating", async () => {
    (findTodayChat as jest.Mock).mockResolvedValue({
      id: "chat-5",
      messages: [
        {
          id: 1,
          role: "USER",
          content: "earlier question",
          timestamp: "2026-10-28T10:00:00.000Z",
        },
        {
          id: 2,
          role: "ASSISTANT",
          content: "earlier answer",
          timestamp: "2026-10-28T10:00:05.000Z",
        },
      ],
    });

    render(<MarkChat />);
    expect(await screen.findByText("earlier question")).toBeInTheDocument();

    await typeAndSend("follow up");
    expect(getOrCreateTodayChat).not.toHaveBeenCalled();
    expect(addMessageToChat).toHaveBeenCalledWith(
      "chat-5",
      "USER",
      "follow up",
      expect.any(String),
    );
  });

  it("still asks the assistant when creating the chat fails", async () => {
    (getOrCreateTodayChat as jest.Mock).mockRejectedValue(new Error("down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    render(<MarkChat />);
    await typeAndSend("hi");

    expect(addMessageToChat).not.toHaveBeenCalled();
  });

  it("offers no way to open chat history", async () => {
    render(<MarkChat />);
    await waitForInit();

    expect(screen.queryByTitle("Chat History")).not.toBeInTheDocument();
    expect(screen.getByTitle("Start New Chat")).toBeInTheDocument();
  });

  it("shows a restored chat that holds a single message", async () => {
    (findTodayChat as jest.Mock).mockResolvedValue({
      id: "chat-5",
      messages: [
        {
          id: 1,
          role: "USER",
          content: "only question",
          timestamp: "2026-10-28T10:00:00.000Z",
        },
      ],
    });

    render(<MarkChat />);

    expect(await screen.findByText("only question")).toBeInTheDocument();
  });

  it("restores a reply that opened a report form without the marker or the form", async () => {
    const operations = [
      { function: "showReportPreview", params: { type: "report" } },
    ];
    (findTodayChat as jest.Mock).mockResolvedValue({
      id: "chat-5",
      messages: [
        {
          id: 1,
          role: "USER",
          content: "the upload is broken",
          timestamp: "2026-10-28T10:00:00.000Z",
        },
        {
          id: 2,
          role: "ASSISTANT",
          content: `Please review the form.\n\n<!-- CLIENT_EXECUTION_MARKER\n${JSON.stringify(operations)}\n-->`,
          timestamp: "2026-10-28T10:00:05.000Z",
          toolCalls: operations,
        },
      ],
    });

    // Every stage runs inside act, or the effect that opens forms never fires.
    await act(async () => {
      render(<MarkChat />);
    });
    for (let stage = 0; stage < 4; stage++) {
      await flushUpdates();
    }

    expect(screen.getByText("Please review the form.")).toBeInTheDocument();
    expect(screen.queryByText(/CLIENT_EXECUTION_MARKER/)).toBeNull();
    expect(screen.queryByText("report form")).toBeNull();
  });

  it("does not reopen a report form when the message list mounts again", async () => {
    const showReplyWithForm = () =>
      act(() => {
        useMarkChatStore.setState({
          messages: [
            { id: "user-1", role: "user", content: "the upload is broken" },
            {
              id: "assistant-1",
              role: "assistant",
              content: "Please review the form.",
              toolCalls: [
                { function: "showReportPreview", params: { type: "report" } },
              ],
            },
          ],
        });
      });

    render(<MarkChat />);
    await waitForInit();

    showReplyWithForm();
    fireEvent.click(await screen.findByText("report form"));
    expect(screen.queryByText("report form")).toBeNull();

    // The list unmounts whenever there is nothing to show, like a closed panel.
    act(() => useMarkChatStore.getState().resetChat());
    showReplyWithForm();

    expect(
      await screen.findByText("Please review the form."),
    ).toBeInTheDocument();
    await flushUpdates();
    expect(screen.queryByText("report form")).toBeNull();
  });

  it("starting a new chat before any message creates and ends nothing", async () => {
    render(<MarkChat />);
    await waitForInit();

    await clickAndSettle(
      "Start New Chat",
      () => (toast.success as jest.Mock).mock.calls.length > 0,
    );

    expect(toast.success).toHaveBeenCalledWith("Started a new chat session");
    expect(endChat).not.toHaveBeenCalled();
    expect(getOrCreateTodayChat).not.toHaveBeenCalled();
  });

  it("a new chat after a send ends the old one and the next send creates another", async () => {
    render(<MarkChat />);
    await typeAndSend("hi");

    (getOrCreateTodayChat as jest.Mock).mockResolvedValue({
      id: "chat-10",
      messages: [],
    });
    await clickAndSettle(
      "Start New Chat",
      () => (endChat as jest.Mock).mock.calls.length > 0,
    );
    expect(endChat).toHaveBeenCalledWith("chat-9");
    expect(getOrCreateTodayChat).toHaveBeenCalledTimes(1);

    await typeAndSend("fresh start");
    expect(getOrCreateTodayChat).toHaveBeenCalledTimes(2);
    expect(addMessageToChat).toHaveBeenLastCalledWith(
      "chat-10",
      "USER",
      "fresh start",
      expect.any(String),
    );
  });
});
