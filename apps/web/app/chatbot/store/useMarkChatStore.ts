/* eslint-disable */

"use client";

import { searchKnowledgeBase } from "../knowledgebase";
import * as authorStoreUtils from "../store/authorStoreUtil";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/* eslint-disable */

export type ChatRole = "user" | "assistant" | "system";
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp?: string;
  toolCalls?: any;
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
  isExecutingClientSide: boolean;
  setIsExecutingClientSide: (value: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  sendMessage: (useStreaming?: boolean) => Promise<void>;
  resetChat: () => void;
  searchKnowledgeBase: (query: string) => Promise<ChatMessage[]>;
  executeAuthorOperation: (functionName: string, args: any) => Promise<any>;
  executeOperations: (operations: any[]) => Promise<void>;
}

export const useMarkChatStore = create<MarkChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),
      userRole: "learner",
      setUserRole: (role) => set({ userRole: role }),
      addMessage: (message: ChatMessage) =>
        set((s) => ({
          messages: [...s.messages, message],
        })),

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

      isExecutingClientSide: false,
      setIsExecutingClientSide: (value) =>
        set({ isExecutingClientSide: value }),

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

      executeOperations: async function (operations) {
        if (!operations || operations.length === 0) return;

        set({ isExecutingClientSide: true });

        try {
          const operationMsg: ChatMessage = {
            id: `system-operations-${Date.now()}`,
            role: "system",
            content: `Executing ${operations.length} operations...`,
          };

          set((s) => ({
            messages: [...s.messages, operationMsg],
          }));

          const results = [];

          for (const op of operations) {
            try {
              // Handle showReportPreview specially - don't process through store operations
              if (op.function === "showReportPreview") {
                // This will be handled by the React component directly
                results.push({
                  success: true,
                  function: op.function,
                  result: {
                    success: true,
                    message: "Report preview form will be displayed",
                  },
                });
                continue;
              }

              const result = await authorStoreUtils.runAuthorOperation(
                op.function,
                op.params,
              );

              results.push({ success: true, function: op.function, result });
            } catch (error) {
              results.push({
                success: false,
                function: op.function,
                error: error.message || "Unknown error",
              });
            }
          }

          const resultMsg: ChatMessage = {
            id: `assistant-operations-${Date.now()}`,
            role: "assistant",
            content: processOperationResults(results),
          };

          set((s) => ({
            messages: [
              ...s.messages.filter((m) => m.id !== operationMsg.id),
              resultMsg,
            ],
            usage: {
              ...s.usage,
              functionCalls: s.usage.functionCalls + operations.length,
            },
          }));
        } catch (error) {
          const errorMsg: ChatMessage = {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            content: `❌ Error executing operations: ${error.message || "An unknown error occurred"}. Please try again.`,
          };

          set((s) => ({
            messages: [...s.messages, errorMsg],
          }));
        } finally {
          set({ isExecutingClientSide: false });
        }
      },

      executeAuthorOperation: async function (functionName, args) {
        try {
          const result = await authorStoreUtils.runAuthorOperation(
            functionName,
            args,
          );

          return result;
        } catch (error) {
          throw error;
        }
      },

      async sendMessage(useStreaming = true) {
        const { userInput, messages, userRole, usage } = get();
        const trimmed = userInput.trim();

        if (!trimmed) return;

        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: "user",
          content: trimmed,
        };

        set({
          messages: [...messages, userMsg],
          userInput: "",
          usage: { ...usage, totalMessagesSent: usage.totalMessagesSent + 1 },
          isTyping: true,
        });

        try {
          const conversationMessages = messages.filter(
            (msg) => msg.role !== "system" || !msg.id.includes("context"),
          );

          if (useStreaming) {
            const response = await fetch("/api/markChat/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userRole,
                userText: userMsg.content,
                conversation: messages,
              }),
            });

            if (!response.ok) {
              throw new Error(`Server error: ${response.status}`);
            }

            if (!response.body) {
              throw new Error("No response body");
            }

            const newId = `assistant-${Date.now()}`;
            set((s) => ({
              messages: [
                ...s.messages,
                { id: newId, role: "assistant", content: "" },
              ],
              isTyping: true,
            }));

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = "";

            try {
              while (true) {
                const { value, done } = await reader.read();

                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                accumulatedContent += chunk;

                const markerMatch = accumulatedContent.match(
                  /<!-- CLIENT_EXECUTION_MARKER\n([\s\S]*?)\n-->/,
                );
                let contentToDisplay = accumulatedContent;

                if (markerMatch) {
                  contentToDisplay = accumulatedContent.replace(
                    /<!-- CLIENT_EXECUTION_MARKER\n[\s\S]*?\n-->/g,
                    "",
                  );
                }

                set((s) => {
                  const clone = [...s.messages];
                  const idx = clone.findIndex((m) => m.id === newId);
                  if (idx !== -1) {
                    clone[idx] = {
                      ...clone[idx],
                      content: contentToDisplay,
                    };
                  }
                  return { messages: clone };
                });
              }
            } catch (streamError) {
            } finally {
              set({ isTyping: false });

              const markerMatch = accumulatedContent.match(
                /<!-- CLIENT_EXECUTION_MARKER\n([\s\S]*?)\n-->/,
              );

              if (markerMatch) {
                try {
                  const operations = JSON.parse(markerMatch[1]);

                  const cleanContent = accumulatedContent.replace(
                    /<!-- CLIENT_EXECUTION_MARKER\n[\s\S]*?\n-->/g,
                    "",
                  );

                  set((s) => {
                    const clone = [...s.messages];
                    const idx = clone.findIndex((m) => m.id === newId);
                    if (idx !== -1) {
                      clone[idx] = {
                        ...clone[idx],
                        content: cleanContent,
                        toolCalls: operations, // Add toolCalls to the message
                      };
                    }
                    return { messages: clone };
                  });

                  await get().executeOperations(operations);
                } catch (err) {
                  console.error(
                    "Error processing client execution marker:",
                    err,
                  );
                }
              }
            }
          } else {
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

            if (data.requiresClientExecution && userRole === "author") {
              const { functionName, functionArgs } = data;

              const assistantMsg: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: `I'll help you with that by using the ${functionName} tool.`,
              };

              set((s) => ({
                messages: [...s.messages, assistantMsg],
                isTyping: false,
              }));

              await get().executeAuthorOperation(functionName, functionArgs);
            } else if (data.functionCalled) {
              set((s) => ({
                usage: {
                  ...s.usage,
                  functionCalls: s.usage.functionCalls + 1,
                },
              }));

              if (data.reply) {
                const assistantMsg: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  content: data.reply,
                };

                set((s) => ({
                  messages: [...s.messages, assistantMsg],
                  isTyping: false,
                }));
              }
            } else {
              const assistantMsg: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: data.reply || "I'm not sure how to respond to that.",
              };

              set((s) => ({
                messages: [...s.messages, assistantMsg],
                isTyping: false,
              }));
            }
          }
        } catch (err: any) {
          const errorMsg: ChatMessage = {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            content: `Sorry, I encountered an error: ${err.message}. Please try again or refresh the page if the problem persists.`,
          };

          set((s) => ({
            messages: [...s.messages, errorMsg],
            isTyping: false,
          }));
        }
      },

      async searchKnowledgeBase(query: string) {
        const { usage } = get();
        set({ usage: { ...usage, kbLookups: usage.kbLookups + 1 } });

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
        messages: state.messages.filter((msg) => msg.role !== "system"),
        usage: state.usage,
      }),
    },
  ),
);

function processOperationResults(results) {
  if (!results || results.length === 0) {
    return "No operations were executed.";
  }

  const successes = results.filter((r) => r.success).length;
  const failures = results.filter((r) => !r.success).length;

  let message = `✅ I've completed ${successes} operation${successes !== 1 ? "s" : ""}`;
  if (failures > 0) {
    message += ` with ${failures} error${failures !== 1 ? "s" : ""}`;
  }
  message += ".\n\n";

  results.forEach((result, index) => {
    const functionName =
      result.function.charAt(0).toUpperCase() + result.function.slice(1);

    if (result.success) {
      message += `${index + 1}. ${functionName}: Successfully completed`;
      if (result.result && result.result.message) {
        message += ` - ${result.result.message}`;
      }
    } else {
      message += `${index + 1}. ${functionName}: Failed - ${result.error}`;
    }

    message += "\n";
  });

  return message;
}
