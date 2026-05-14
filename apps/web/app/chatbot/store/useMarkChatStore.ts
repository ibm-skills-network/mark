/* eslint-disable */

"use client";

import { searchKnowledgeBase } from "../knowledgebase";
import * as authorStoreUtils from "../store/authorStoreUtil";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatRole = "user" | "assistant" | "system";
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp?: string;
  toolCalls?: any;
}

interface SendMessageOptions {
  // Lets caller override `userInput` (e.g. file-only message).
  userText?: string;
  // Optional metadata for local chat UI (e.g. file chips).
  toolCalls?: any;
  // Lets callers provide the exact conversation snapshot to send.
  conversation?: ChatMessage[];
}

interface MarkChatUsage {
  functionCalls: number;
  totalMessagesSent: number;
  kbLookups: number;
}

export interface AttachedFile {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  extension: string;
  /** Text extracted locally; not saved to localStorage. */
  extractedContent?: string;
  /** Leading snippet from extracted content (not semantic summary). */
  contentPrefix?: string;
  uploadStatus: "uploading" | "waiting" | "uploaded" | "error";
  uploadProgress: number;
  s3Link?: string;
  s3Key?: string;
  s3Bucket?: string;
  errorMessage?: string;
  uploadedAt: string;
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
  attachedFiles: AttachedFile[];
  sessionContextFiles: AttachedFile[];
  addAttachedFile: (file: AttachedFile) => void;
  removeAttachedFile: (fileId: string) => void;
  updateFileStatus: (fileId: string, status: Partial<AttachedFile>) => void;
  clearAttachedFiles: () => void;
  addSessionContextFiles: (files: AttachedFile[]) => void;
  clearSessionContextFiles: () => void;
  addMessage: (message: ChatMessage) => void;
  sendMessage: (
    useStreaming?: boolean,
    options?: SendMessageOptions,
  ) => Promise<boolean>;
  resetChat: () => void;
  searchKnowledgeBase: (query: string) => Promise<ChatMessage[]>;
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

      attachedFiles: [],
      sessionContextFiles: [],
      addAttachedFile: (file: AttachedFile) =>
        set((s) => ({
          attachedFiles: [...s.attachedFiles, file],
        })),
      removeAttachedFile: (fileId: string) =>
        set((s) => ({
          attachedFiles: s.attachedFiles.filter((f) => f.id !== fileId),
        })),
      updateFileStatus: (fileId: string, status: Partial<AttachedFile>) =>
        set((s) => ({
          attachedFiles: s.attachedFiles.map((f) =>
            f.id === fileId ? { ...f, ...status } : f,
          ),
        })),
      clearAttachedFiles: () => set({ attachedFiles: [] }),
      addSessionContextFiles: (files: AttachedFile[]) =>
        set((s) => {
          if (!files.length) return {};
          const merged = [...s.sessionContextFiles];
          files.forEach((file) => {
            const existingIndex = merged.findIndex((f) => f.id === file.id);
            if (existingIndex === -1) {
              merged.push(file);
            } else {
              merged[existingIndex] = file;
            }
          });
          return { sessionContextFiles: merged };
        }),
      clearSessionContextFiles: () => set({ sessionContextFiles: [] }),

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
          attachedFiles: [],
          sessionContextFiles: [],
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
              if (op.function === "showReportPreview") {
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

      async sendMessage(useStreaming = true, options?: SendMessageOptions) {
        const { userInput, messages, userRole, usage } = get();
        const effectiveUserText = options?.userText ?? userInput;
        const conversation = options?.conversation ?? messages;
        const trimmed = effectiveUserText.trim();

        if (!trimmed) return false;

        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: "user",
          content: trimmed,
          // Keep metadata so chat can show user file chips.
          ...(options?.toolCalls ? { toolCalls: options.toolCalls } : {}),
        };

        set({
          messages: [...conversation, userMsg],
          userInput: "",
          usage: { ...usage, totalMessagesSent: usage.totalMessagesSent + 1 },
          isTyping: true,
        });

        try {
          // Strip the UI-only `toolCalls` metadata from user messages — file chips are
          // local only and should not reach the API. However, file s3Links must reach
          // the backend so it can grant extractFileFromLink tool access. Reconstruct a
          // system-files-* message for each user message that carried file attachments
          // so history reloads and post-refresh sessions restore tool access correctly.
          const conversationMessages: ChatMessage[] = [];
          for (const msg of conversation) {
            if (msg.role === "system" && msg.id.includes("context")) continue;

            if (
              msg.role === "user" &&
              msg.toolCalls?.type === "file_attachments"
            ) {
              const files: Array<{
                filename?: string;
                size?: number;
                contentType?: string;
                extension?: string;
                s3Link?: string;
              }> = msg.toolCalls.files ?? [];
              if (files.length > 0) {
                let fileContent = "Files attached in this conversation:\n\n";
                files.forEach((file, index) => {
                  fileContent += `${index + 1}. ${file.filename ?? "file"}\n`;
                  if (file.s3Link) fileContent += `S3 Link: ${file.s3Link}\n`;
                  fileContent += "\n";
                });
                conversationMessages.push({
                  id: `system-files-restored-${msg.id}`,
                  role: "system",
                  content: fileContent,
                });
              }
              const { toolCalls: _tc, ...safeMessage } = msg;
              conversationMessages.push(safeMessage);
            } else {
              conversationMessages.push(msg);
            }
          }

          if (useStreaming) {
            const response = await fetch("/api/markChat/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userRole,
                userText: userMsg.content,
                conversation: conversationMessages,
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
                        toolCalls: operations,
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
                conversation: conversationMessages,
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

              await authorStoreUtils.runAuthorOperation(
                functionName,
                functionArgs,
              );
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
          return true;
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
          // Caller uses this flag to decide whether attachments should be cleared.
          return false;
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
      version: 2,
      migrate: (persistedState: any, version: number) => {
        if (!persistedState || typeof persistedState !== "object") {
          return persistedState;
        }

        if (version < 2) {
          const nextState = { ...persistedState };
          delete nextState.attachedFiles;
          delete nextState.sessionContextFiles;
          return nextState;
        }

        return persistedState;
      },
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
