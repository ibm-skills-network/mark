/**
 * @jest-environment node
 */

import {
  addMessageToChat,
  findTodayChat,
  getOrCreateTodayChat,
} from "../shared";

const post = jest.fn();

jest.mock("../api-client", () => ({
  ...jest.requireActual("../api-client"),
  apiClient: { post: (...args: unknown[]) => post(...args) },
}));

describe("chat client", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("looks up today's chat with a POST carrying the assignment, so access is still checked", async () => {
    post.mockResolvedValue({ id: null, messages: [] });

    const result = await findTodayChat("learner-1", 3670, "session=abc");

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, init] = post.mock.calls[0];
    expect(url).toMatch(/\/chats\/today\/lookup$/);
    expect(body).toEqual({ userId: "learner-1", assignmentId: 3670 });
    expect(init.headers).toEqual({ Cookie: "session=abc" });
    expect(result).toEqual({ id: null, messages: [] });
  });

  it("creates today's chat on the separate create route", async () => {
    post.mockResolvedValue({ id: "chat-1", messages: [] });

    await getOrCreateTodayChat("learner-1", 3670);

    const [url] = post.mock.calls[0];
    expect(url).toMatch(/\/chats\/today$/);
  });

  it("sends only the role and text when saving a message", async () => {
    post.mockResolvedValue({ id: 1 });

    await addMessageToChat("chat-1", "USER", "hello");

    const [url, body] = post.mock.calls[0];
    expect(url).toMatch(/\/chats\/chat-1\/messages$/);
    expect(body).toEqual({ role: "USER", content: "hello" });
  });
});
