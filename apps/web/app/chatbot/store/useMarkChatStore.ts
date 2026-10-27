/* eslint-disable */

"use client";

import { searchKnowledgeBase } from "../knowledgebase";
import * as authorStoreUtils from "../store/authorStoreUtil";
import {
  AGENT_LOOP,
  isAgentLoopResponse,
  MAX_CONTINUATIONS,
  readAgentTurn,
  runPendingCalls,
} from "./agentLoop";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatRole = "user" | "assistant" | "system";
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp?: string;
  toolCalls?: any;
  /** Shown in the chat but never sent to the API (e.g. the ✅ summary). */
  displayOnly?: boolean;
}

interface SendMessageOptions {
  // Lets caller override `userInput` (e.g. file-only message).
  userText?: string;
  // Optional metadata for local chat UI (e.g. file chips).
  toolCalls?: any;
  // Lets callers provide the exact conversation snapshot to send.
  conversation?: ChatMessage[];
  // Fresh assignment context for each continuation after operations run.
  getContext?: () => Promise<ChatMessage | null>;
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
  sendMessage: (options?: SendMessageOptions) => Promise<boolean>;
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

      async sendMessage(options?: SendMessageOptions) {
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

        const updateMessage = (id: string, change: Partial<ChatMessage>) =>
          set((s) => ({
            messages: s.messages.map((message) =>
              message.id === id ? { ...message, ...change } : message,
            ),
          }));

        try {
          // What precedes each request: the history before the user's
          // message, then (on continuations) everything up to the outcomes.
          let history = conversation;
          let userText: string | undefined = userMsg.content;
          let resultsForMessageId: number | undefined;

          for (let round = 0; ; round++) {
            const response = await fetch("/api/markChat/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userRole,
                ...(userText ? { userText } : {}),
                conversation: toConversationPayload(history),
                protocol: AGENT_LOOP,
                ...(resultsForMessageId ? { resultsForMessageId } : {}),
              }),
            });

            if (!response.ok) {
              throw new Error(`Server error: ${response.status}`);
            }

            if (!response.body) {
              throw new Error("No response body");
            }

            const assistantId = `assistant-${Date.now()}-${round}`;
            set((s) => ({
              messages: [
                ...s.messages,
                { id: assistantId, role: "assistant", content: "" },
              ],
              isTyping: true,
            }));

            if (!isAgentLoopResponse(response)) {
              // An API without the agent loop (e.g. rolled back) streams text.
              await readLegacyTurn(response.body, assistantId);
              break;
            }

            let text = "";
            const turn = await readAgentTurn(response.body, (delta) => {
              text += delta;
              updateMessage(assistantId, { content: text });
            });
            if (turn.actions.length > 0 || turn.calls.length > 0) {
              updateMessage(assistantId, {
                toolCalls: [...turn.actions, ...turn.calls],
              });
            }

            if (turn.calls.length === 0 || round >= MAX_CONTINUATIONS) break;

            set({ isExecutingClientSide: true });
            const completed = await runPendingCalls(turn.calls);
            set((s) => ({
              isExecutingClientSide: false,
              messages: [
                ...s.messages.map((message) =>
                  message.id === assistantId
                    ? { ...message, toolCalls: [...turn.actions, ...completed] }
                    : message,
                ),
                {
                  id: `assistant-operations-${Date.now()}`,
                  role: "assistant",
                  content: processOperationResults(
                    completed.map((call) =>
                      call.output?.success
                        ? {
                            success: true,
                            function: call.toolName,
                            result: { message: call.output.message },
                          }
                        : {
                            success: false,
                            function: call.toolName,
                            error: call.output?.message,
                          },
                    ),
                  ),
                  displayOnly: true,
                },
              ],
              usage: {
                ...s.usage,
                functionCalls: s.usage.functionCalls + completed.length,
              },
            }));

            history = withFreshContext(
              get().messages,
              (await options?.getContext?.()) ?? null,
            );
            userText = undefined;
            resultsForMessageId = turn.savedMessageId;
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
        } finally {
          set({ isTyping: false, isExecutingClientSide: false });
        }

        /** The pre-agent-loop stream: text, then an execution marker. */
        async function readLegacyTurn(
          body: ReadableStream<Uint8Array>,
          assistantId: string,
        ) {
          const reader = body.getReader();
          const decoder = new TextDecoder();
          let accumulatedContent = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            accumulatedContent += decoder.decode(value, { stream: true });
            updateMessage(assistantId, {
              content: accumulatedContent.replace(LEGACY_MARKER_GLOBAL, ""),
            });
          }
          const markerMatch = accumulatedContent.match(LEGACY_MARKER);
          if (!markerMatch) return;
          try {
            const operations = JSON.parse(markerMatch[1]);
            updateMessage(assistantId, {
              content: accumulatedContent.replace(LEGACY_MARKER_GLOBAL, ""),
              toolCalls: operations,
            });
            await get().executeOperations(operations);
          } catch (err) {
            console.error("Error processing client execution marker:", err);
          }
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

const LEGACY_MARKER = /<!-- CLIENT_EXECUTION_MARKER\n([\s\S]*?)\n-->/;
const LEGACY_MARKER_GLOBAL = /<!-- CLIENT_EXECUTION_MARKER\n[\s\S]*?\n-->/g;

/**
 * The conversation as the API receives it: display-only messages left out,
 * and file attachments turned into the system note that grants file access.
 */
function toConversationPayload(messages: ChatMessage[]): ChatMessage[] {
  const payload: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.displayOnly) continue;
    // NOTE: do NOT drop `system-context-*` messages here. The backend
    // (mark-chat.service.getSystemPromptParts) keys on
    // `role === "system" && id.includes("context")` to build the LLM
    // system prompt and detect assignment mode/id. Stripping them blinds
    // the chatbot to the current app/session (assignment, question,
    // responses, feedback). See useLearnerContext/useAuthorContext.
    if (msg.role === "user" && msg.toolCalls?.type === "file_attachments") {
      // Strip the UI-only `toolCalls` metadata from user messages — file chips are
      // local only and should not reach the API. However, file s3Links must reach
      // the backend so it can grant extractFileFromLink tool access. Reconstruct a
      // system-files-* message for each user message that carried file attachments
      // so history reloads and post-refresh sessions restore tool access correctly.
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
        payload.push({
          id: `system-files-restored-${msg.id}`,
          role: "system",
          content: fileContent,
        });
      }
      const { toolCalls: _tc, ...safeMessage } = msg;
      payload.push(safeMessage);
    } else {
      payload.push(msg);
    }
  }
  return payload;
}

/** Messages with the assignment context replaced by a fresh one. */
function withFreshContext(
  messages: ChatMessage[],
  context: ChatMessage | null,
): ChatMessage[] {
  if (!context) return messages;
  const withoutContext = messages.filter(
    (message) => message.role !== "system" || !message.id.includes("context"),
  );
  const lastUserIndex = withoutContext
    .map((message, index) => (message.role === "user" ? index : -1))
    .filter((index) => index !== -1)
    .pop();
  const result = [...withoutContext];
  result.splice(lastUserIndex ?? 0, 0, context);
  return result;
}

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
