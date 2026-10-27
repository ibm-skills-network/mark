import { getBaseApiPath } from "@/config/constants";
import { authorizeChatRequest, VerifiedChatSession } from "@/lib/chat-session";
import type { AGENT_LOOP_PROTOCOL } from "mark-chat-ops";

const BACKEND_SOURCE_HEADER = "x-mark-chat-backend";
const LOG_EVENT = "markChat.stream.request";

const AGENT_LOOP = "agent-loop-1" satisfies typeof AGENT_LOOP_PROTOCOL;

interface ChatPayload {
  userRole: "author" | "learner";
  /** Absent only when an agent-loop browser continues after running operations. */
  userText?: string;
  conversation: unknown[];
  protocol?: typeof AGENT_LOOP;
  resultsForMessageId?: number;
}

/** The browser decides what to ask, never who is asking or what shape it sends. */
function parsePayload(body: unknown): ChatPayload | null {
  if (typeof body !== "object" || body === null) return null;

  const { userRole, userText, conversation, protocol, resultsForMessageId } =
    body as Record<string, unknown>;

  if (userRole !== "author" && userRole !== "learner") return null;
  if (!Array.isArray(conversation)) return null;
  if (protocol !== undefined && protocol !== AGENT_LOOP) return null;

  const agentLoop = protocol === AGENT_LOOP;
  const hasText = typeof userText === "string" && userText.length > 0;
  if (!hasText && !(agentLoop && userText === undefined)) return null;

  if (
    resultsForMessageId !== undefined &&
    !(
      agentLoop &&
      Number.isInteger(resultsForMessageId) &&
      (resultsForMessageId as number) > 0
    )
  ) {
    return null;
  }

  return {
    userRole,
    conversation,
    ...(hasText ? { userText: userText } : {}),
    ...(agentLoop ? { protocol: AGENT_LOOP } : {}),
    ...(resultsForMessageId === undefined
      ? {}
      : { resultsForMessageId: resultsForMessageId as number }),
  };
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function callBackendChatStream(
  session: VerifiedChatSession,
  caller: string,
  payload: ChatPayload,
): Promise<Response | null> {
  const baseApiPath = getBaseApiPath("v1");
  // The caller's cookie is the credential; the identity is re-derived
  // downstream from it rather than asserted by this service.
  const authHeaders = {
    "Content-Type": "application/json",
    Cookie: session.cookie,
  };

  try {
    const chatRes = await fetch(`${baseApiPath}/chats/today`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        userId: session.userId,
        assignmentId: session.assignmentId,
      }),
    });

    if (!chatRes.ok) {
      console.warn(`${LOG_EVENT}.backend_rejected`, {
        caller,
        stage: "open_chat",
        status: chatRes.status,
      });
      return null;
    }

    const chatData = (await chatRes.json()) as { id?: string };
    if (!chatData.id) {
      console.warn(`${LOG_EVENT}.backend_rejected`, {
        caller,
        stage: "open_chat",
        reason: "missing_chat_id",
      });
      return null;
    }

    const respondRes = await fetch(
      `${baseApiPath}/chats/${chatData.id}/respond-stream`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      },
    );

    if (!respondRes.ok || !respondRes.body) {
      console.warn(`${LOG_EVENT}.backend_rejected`, {
        caller,
        stage: "respond",
        status: respondRes.status,
        hasBody: Boolean(respondRes.body),
      });
      return null;
    }

    console.info(`${LOG_EVENT}.streaming`, { caller, chatId: chatData.id });

    return new Response(respondRes.body, {
      headers: {
        // Plain text, or agent-loop events (application/x-ndjson).
        "Content-Type":
          respondRes.headers.get("content-type") ?? "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
        "X-Chat-ID": chatData.id,
        [BACKEND_SOURCE_HEADER]: "true",
      },
    });
  } catch (error) {
    console.error(`${LOG_EVENT}.failed`, {
      caller,
      reason: "chat_backend_unreachable",
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

export async function POST(req: Request) {
  const authorization = await authorizeChatRequest(req, LOG_EVENT);
  if (authorization.outcome === "denied") {
    return textResponse(authorization.message, authorization.status);
  }

  const { session, caller } = authorization;

  let payload: ChatPayload | null;
  try {
    payload = parsePayload(await req.json());
  } catch (error) {
    console.warn(`${LOG_EVENT}.rejected`, {
      caller,
      reason: "unreadable_payload",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return textResponse("Invalid request", 400);
  }

  if (!payload) {
    console.warn(`${LOG_EVENT}.rejected`, {
      caller,
      reason: "invalid_payload",
    });
    return textResponse("Missing required fields", 400);
  }

  console.info(`${LOG_EVENT}.received`, {
    caller,
    userRole: payload.userRole,
    // Lengths only: the message is learner content.
    characters: payload.userText?.length ?? 0,
    agentLoop: payload.protocol === AGENT_LOOP,
    turns: payload.conversation.length,
  });

  const backendStream = await callBackendChatStream(session, caller, payload);

  if (!backendStream) {
    return textResponse("Backend chat service unavailable", 502);
  }

  return backendStream;
}
