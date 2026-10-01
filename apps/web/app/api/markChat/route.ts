import { getBaseApiPath } from "@/config/constants";
import { authorizeChatRequest, VerifiedChatSession } from "@/lib/chat-session";
import { NextResponse } from "next/server";

const BACKEND_SOURCE_HEADER = "x-mark-chat-backend";
const LOG_EVENT = "markChat.request";

interface ChatPayload {
  userRole: "author" | "learner";
  userText: string;
  conversation: unknown[];
}

interface BackendChatResult {
  reply: string;
  chatId: string;
  functionResults?: unknown[];
  functionCalled?: boolean;
}

/** The browser decides what to ask, never who is asking or what shape it sends. */
function parsePayload(body: unknown): ChatPayload | null {
  if (typeof body !== "object" || body === null) return null;

  const { userRole, userText, conversation } = body as Record<string, unknown>;

  if (userRole !== "author" && userRole !== "learner") return null;
  if (typeof userText !== "string" || userText.length === 0) return null;
  if (!Array.isArray(conversation)) return null;

  return { userRole, userText, conversation };
}

async function callBackendChat(
  session: VerifiedChatSession,
  caller: string,
  payload: ChatPayload,
): Promise<BackendChatResult | null> {
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
      `${baseApiPath}/chats/${chatData.id}/respond`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      },
    );

    if (!respondRes.ok) {
      console.warn(`${LOG_EVENT}.backend_rejected`, {
        caller,
        stage: "respond",
        status: respondRes.status,
      });
      return null;
    }

    const responseData = (await respondRes.json()) as {
      reply?: string;
      functionResults?: unknown[];
      functionCalled?: boolean;
    };

    if (!responseData.reply) {
      console.warn(`${LOG_EVENT}.backend_rejected`, {
        caller,
        stage: "respond",
        reason: "empty_reply",
      });
      return null;
    }

    return {
      reply: responseData.reply,
      chatId: chatData.id,
      functionResults: responseData.functionResults,
      functionCalled: responseData.functionCalled,
    };
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
  const startedAt = Date.now();

  const authorization = await authorizeChatRequest(req, LOG_EVENT);
  if (authorization.outcome === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
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
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!payload) {
    console.warn(`${LOG_EVENT}.rejected`, {
      caller,
      reason: "invalid_payload",
    });
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  console.info(`${LOG_EVENT}.received`, {
    caller,
    userRole: payload.userRole,
    // Lengths only: the message is learner content.
    characters: payload.userText.length,
    turns: payload.conversation.length,
  });

  const backendResult = await callBackendChat(session, caller, payload);

  if (!backendResult) {
    return NextResponse.json(
      { error: "Backend chat service unavailable" },
      { status: 502 },
    );
  }

  console.info(`${LOG_EVENT}.succeeded`, {
    caller,
    durationMs: Date.now() - startedAt,
    functionCalled: backendResult.functionCalled === true,
  });

  return NextResponse.json(
    {
      reply: backendResult.reply,
      source: "backend",
      chatId: backendResult.chatId,
      functionResults: backendResult.functionResults,
      functionCalled: backendResult.functionCalled,
    },
    {
      headers: {
        [BACKEND_SOURCE_HEADER]: "true",
      },
    },
  );
}
