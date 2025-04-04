/* eslint-disable */ import { create } from "zustand";
import { persist } from "zustand/middleware";
import { searchKnowledgeBase } from "../knowledgebase";

export type ChatRole = "user" | "assistant" | "system";
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

interface MarkChatUsage {
  functionCalls: number;
  totalMessagesSent: number;
  kbLookups: number;
}

interface MarkChatState {
  isOpen: boolean;
  toggleChat: () => void;
  userRole: "author" | "learner";
  setUserRole: (role: "author" | "learner") => void;
  messages: ChatMessage[];
  userInput: string;
  setUserInput: (val: string) => void;
  usage: MarkChatUsage;
  isTyping: boolean;
  setIsTyping: (value: boolean) => void;

  sendMessage: (useStreaming?: boolean) => Promise<void>;
  resetChat: () => void;
  searchKnowledgeBase: (query: string) => Promise<ChatMessage[]>;
}

export const useMarkChatStore = create<MarkChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),
      userRole: "learner", // Default to learner role
      setUserRole: (role) => set({ userRole: role }),

      messages: [
        {
          id: "assistant-initial",
          role: "assistant",
          content:
            "Hello, I'm Mark! How can I help you with your assignment today?",
        },
      ],

      userInput: "",
      setUserInput: (val) => set({ userInput: val }),

      usage: {
        functionCalls: 0,
        totalMessagesSent: 0,
        kbLookups: 0,
      },

      isTyping: false,
      setIsTyping: (value) => set({ isTyping: value }),

      resetChat: () =>
        set({
          messages: [
            {
              id: "assistant-initial",
              role: "assistant",
              content:
                "Hello, I'm Mark! How can I help you with your assignment today?",
            },
          ],
          userInput: "",
        }),

      async sendMessage(useStreaming = true) {
        const { userInput, messages, userRole, usage } = get();
        const trimmed = userInput.trim();

        if (!trimmed) return;

        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: "user",
          content: trimmed,
        };

        // Update state to show user message and typing indicator
        set({
          messages: [...messages, userMsg],
          userInput: "",
          usage: { ...usage, totalMessagesSent: usage.totalMessagesSent + 1 },
          isTyping: true,
        });

        try {
          // Get only conversation messages that are not system context messages
          const conversationMessages = messages.filter(
            (msg) => msg.role !== "system" || !msg.id.includes("context"),
          );

          if (useStreaming) {
            // Use the streaming API
            const response = await fetch("/api/markChat/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userRole,
                userText: userMsg.content,
                conversation: messages, // Include all messages including context
              }),
            });

            if (!response.ok) {
              throw new Error(`Server error: ${response.status}`);
            }

            if (!response.body) {
              throw new Error("No response body");
            }

            // Create a new message for the streaming response
            const newId = `assistant-${Date.now()}`;
            set((s) => ({
              messages: [
                ...s.messages,
                { id: newId, role: "assistant", content: "" },
              ],
              isTyping: true,
            }));

            // Set up streaming reader
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = "";

            // Process stream chunks
            try {
              while (true) {
                const { value, done } = await reader.read();

                if (done) break;

                // Decode the chunk
                const chunk = decoder.decode(value, { stream: true });
                accumulatedContent += chunk;

                // Update the message content with accumulated text
                set((s) => {
                  const clone = [...s.messages];
                  const idx = clone.findIndex((m) => m.id === newId);
                  if (idx !== -1) {
                    clone[idx] = {
                      ...clone[idx],
                      content: accumulatedContent,
                    };
                  }
                  return { messages: clone };
                });
              }
            } catch (streamError) {
              console.error("Stream reading error:", streamError);
            } finally {
              // Turn off typing indicator when streaming is done
              set({ isTyping: false });
            }
          } else {
            // Regular non-streaming API call (fallback)
            const resp = await fetch("/api/markChat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userRole,
                userText: userMsg.content,
                conversation: messages,
              }),
            });

            if (!resp.ok) throw new Error(resp.statusText);

            const data = await resp.json();

            if (data.functionCalled) {
              set((s) => ({
                usage: {
                  ...s.usage,
                  functionCalls: s.usage.functionCalls + 1,
                },
              }));
            }

            if (data.reply) {
              const assistantMsg: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: data.reply,
              };

              set((s) => ({
                messages: [...s.messages, assistantMsg],
                isTyping: false, // Turn off typing indicator
              }));
            }
          }
        } catch (err: any) {
          console.error("sendMessage error:", err);

          // Show error message
          const errorMsg: ChatMessage = {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            content: `Sorry, I encountered an error: ${err.message}. Please try again or refresh the page if the problem persists.`,
          };

          set((s) => ({
            messages: [...s.messages, errorMsg],
            isTyping: false, // Turn off typing indicator
          }));
        }
      },

      async searchKnowledgeBase(query: string) {
        const { usage } = get();
        set({ usage: { ...usage, kbLookups: usage.kbLookups + 1 } });

        // Call knowledge base function (placeholder implementation)
        const results = searchKnowledgeBase(query);

        if (!results.length) {
          return [
            {
              id: `kb-none-${Date.now()}`,
              role: "assistant",
              content: `No specific information found for "${query}". I'll use my general knowledge to help.`,
            },
          ];
        }

        // Return search results as messages
        return results.map((item: any) => ({
          id: `kb-${item.id}-${Date.now()}`,
          role: "assistant",
          content: `**${item.title}**\n\n${item.description}`,
        }));
      },
    }),
    {
      name: "mark-chat-store",
      partialize: (state) => ({
        userRole: state.userRole,
        messages: state.messages.filter((msg) => msg.role !== "system"), // Don't persist system messages
        usage: state.usage,
      }),
    },
  ),
);
