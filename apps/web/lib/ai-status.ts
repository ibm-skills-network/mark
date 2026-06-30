/**
 * Client helper for the public AI kill-switch status endpoint. Used as a UX
 * hint only (hiding the chat widget, pre-disabling AI-graded "Start" CTAs);
 * the server enforces every AI gate independently.
 */
import { getApiRoutes } from "@/config/constants";
import { apiClient } from "./api-client";

export interface AiStatus {
  grading: boolean;
  chat: boolean;
  authoring: boolean;
}

/**
 * Fetches the current AI component status. Returns `undefined` on any failure
 * so callers can fall back to their default (show everything) — the backend
 * still blocks disabled components regardless.
 */
export async function getAiStatus(): Promise<AiStatus | undefined> {
  try {
    return await apiClient.get<AiStatus>(getApiRoutes().aiStatus);
  } catch {
    return undefined;
  }
}
