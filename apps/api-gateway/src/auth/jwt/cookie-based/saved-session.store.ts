import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

export const SAVED_SESSION_COOKIE = "mark_saved_sessions";

const MAX_ASSIGNMENT_ID = 2_147_483_647;
const STORE_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const logger = new Logger("SavedSessionStore");

export function isStoreId(value: unknown): value is string {
  return typeof value === "string" && STORE_ID.test(value);
}

/** Quiz session tokens saved in mark-api, keyed by the browser's store id. */
@Injectable()
export class SavedSessionStore {
  async find(
    storeId: string,
    role: string,
    assignmentId: number,
  ): Promise<string | undefined> {
    const data = await this.send("post", "/lookup", {
      storeId,
      role,
      assignmentId,
    });
    const token = (data as { token?: unknown } | undefined)?.token;
    return typeof token === "string" ? token : undefined;
  }

  async save(
    storeId: string,
    role: string,
    assignmentId: number,
    token: string,
  ): Promise<void> {
    await this.send("put", "", { storeId, role, assignmentId, token });
  }

  private async send(
    method: "post" | "put",
    path: string,
    body: {
      storeId: string;
      role: string;
      assignmentId: number;
      token?: string;
    },
  ): Promise<unknown> {
    const endpoint = process.env.MARK_API_ENDPOINT;
    const secret = process.env.JOB_QUEUE_SECRET; // pragma: allowlist secret
    if (!endpoint || !secret || body.assignmentId > MAX_ASSIGNMENT_ID) return;
    try {
      const response = await axios.request<unknown>({
        method,
        url: `${endpoint}/api/internal/saved-sessions${path}`,
        data: body,
        headers: { "x-job-queue-secret": secret },
        timeout: 1000,
      });
      return response.data;
    } catch (error) {
      const reason = axios.isAxiosError(error)
        ? (error.response?.status ?? error.code)
        : "unexpected error";
      logger.warn(
        `Saved session ${
          method === "post" ? "lookup" : "save"
        } failed (${String(reason)})`,
      );
    }
  }
}
