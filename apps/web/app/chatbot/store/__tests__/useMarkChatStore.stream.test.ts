import { useMarkChatStore } from "../useMarkChatStore";

const streamOf = (read: () => Promise<{ value?: Uint8Array; done: boolean }>) =>
  ({
    ok: true,
    body: { getReader: () => ({ read }) },
  }) as unknown as Response;

describe("useMarkChatStore reply stream failures", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    useMarkChatStore.getState().resetChat();
    useMarkChatStore.setState({ isTyping: false });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const send = async (response: Response) => {
    global.fetch = jest.fn().mockResolvedValue(response);
    return useMarkChatStore.getState().sendMessage(true, { userText: "hi" });
  };

  it("shows an error instead of a blank reply when the stream dies before any text", async () => {
    const sent = await send(
      streamOf(() => Promise.reject(new Error("connection lost"))),
    );

    const { messages, isTyping } = useMarkChatStore.getState();
    const last = messages.at(-1);
    expect(sent).toBe(false);
    expect(isTyping).toBe(false);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toContain("connection lost");
    expect(
      messages.filter((m) => m.role === "assistant" && !m.content.trim()),
    ).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      "MarkChat: reply stream failed:",
      expect.any(Error),
    );
  });

  it("keeps the partial reply when the stream dies part way", async () => {
    let reads = 0;
    const sent = await send(
      streamOf(() => {
        reads += 1;
        return reads === 1
          ? Promise.resolve({
              value: new TextEncoder().encode("partial answer"),
              done: false,
            })
          : Promise.reject(new Error("connection lost"));
      }),
    );

    const { messages, isTyping } = useMarkChatStore.getState();
    expect(sent).toBe(true);
    expect(isTyping).toBe(false);
    expect(messages.at(-1)?.content).toBe("partial answer");
    expect(consoleError).toHaveBeenCalled();
  });
});
