/* eslint-disable */

"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { searchKnowledgeBase } from "../knowledgebase";
import * as authorStoreUtils from "../store/authorStoreUtil";

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
  isExecutingClientSide: boolean;
  setIsExecutingClientSide: (value: boolean) => void;

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

      // Execute multiple operations in sequence
      executeOperations: async function (operations) {
        if (!operations || operations.length === 0) return;

        set({ isExecutingClientSide: true });

        try {
          console.log(`Executing ${operations.length} operations:`, operations);

          // Add a system message indicating operations in progress
          const operationMsg: ChatMessage = {
            id: `system-operations-${Date.now()}`,
            role: "system",
            content: `Executing ${operations.length} operations...`,
          };

          set((s) => ({
            messages: [...s.messages, operationMsg],
          }));

          // Execute operations in sequence
          const results = [];

          for (const op of operations) {
            try {
              // Use the runAuthorOperation function which handles different operation types
              const result = await authorStoreUtils.runAuthorOperation(
                op.function,
                op.params,
              );

              results.push({ success: true, function: op.function, result });
            } catch (error) {
              console.error(`Error executing ${op.function}:`, error);
              results.push({
                success: false,
                function: op.function,
                error: error.message || "Unknown error",
              });
            }
          }

          // Add a response message with the results
          const resultMsg: ChatMessage = {
            id: `assistant-operations-${Date.now()}`,
            role: "assistant",
            content: processOperationResults(results),
          };

          // Update messages (replace the system operation message with the result)
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

          console.log(`Operations completed:`, results);
        } catch (error) {
          console.error(`Error executing operations:`, error);

          // Add an error message
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

      // Execute a single author operation
      executeAuthorOperation: async function (functionName, args) {
        console.log(`Executing author operation: ${functionName}`, args);

        try {
          // Use the runAuthorOperation function from authorStoreUtils
          const result = await authorStoreUtils.runAuthorOperation(
            functionName,
            args,
          );
          console.log(`Operation ${functionName} completed:`, result);
          return result;
        } catch (error) {
          console.error(`Error executing ${functionName}:`, error);
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

                // Extract client execution marker if present
                const markerMatch = accumulatedContent.match(
                  /<!-- CLIENT_EXECUTION_MARKER\n([\s\S]*?)\n-->/,
                );
                let contentToDisplay = accumulatedContent;

                if (markerMatch) {
                  // Remove the marker from displayed content
                  contentToDisplay = accumulatedContent.replace(
                    /<!-- CLIENT_EXECUTION_MARKER\n[\s\S]*?\n-->/g,
                    "",
                  );
                }

                // Update the message content with accumulated text (without markers)
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
              console.error("Stream reading error:", streamError);
            } finally {
              // Turn off typing indicator when streaming is done
              set({ isTyping: false });

              // Check for execution markers after stream is complete
              const markerMatch = accumulatedContent.match(
                /<!-- CLIENT_EXECUTION_MARKER\n([\s\S]*?)\n-->/,
              );

              if (markerMatch && userRole === "author") {
                try {
                  const operations = JSON.parse(markerMatch[1]);
                  console.log(
                    "Found client execution marker with operations:",
                    operations,
                  );

                  // Clean up content by removing the marker
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
                      };
                    }
                    return { messages: clone };
                  });

                  // Execute the operations
                  await get().executeOperations(operations);
                } catch (err) {
                  console.error("Error parsing or executing operations:", err);
                }
              }
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

            if (data.requiresClientExecution && userRole === "author") {
              // Execute client-side operation
              const { functionName, functionArgs } = data;

              // Add AI response first
              const assistantMsg: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                content: `I'll help you with that by using the ${functionName} tool.`,
              };

              set((s) => ({
                messages: [...s.messages, assistantMsg],
                isTyping: false,
              }));

              // Execute the operation
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
              // Regular response without function calls
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

// Helper function to process operation results into a readable message
function processOperationResults(results) {
  if (!results || results.length === 0) {
    return "No operations were executed.";
  }

  // Count successes and failures
  const successes = results.filter((r) => r.success).length;
  const failures = results.filter((r) => !r.success).length;

  let message = `✅ I've completed ${successes} operation${successes !== 1 ? "s" : ""}`;
  if (failures > 0) {
    message += ` with ${failures} error${failures !== 1 ? "s" : ""}`;
  }
  message += ".\n\n";

  // Add details of each operation
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
