/* eslint-disable */
import { getBaseApiPath } from "@/config/constants";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_SOURCE_HEADER = "x-mark-chat-backend";
const USER_SESSION_CACHE_TTL_MS = 30_000;
const userSessionCache = new Map<
  string,
  {
    value: { userId: string; assignmentId?: number; cookie?: string };
    expiresAt: number;
  }
>();

function getUserSessionHeader(req: NextRequest): string | null {
  const directHeader = req.headers.get("user-session");
  if (directHeader) return directHeader;

  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const sessionCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("userSession="));

  if (!sessionCookie) return null;

  const value = sessionCookie.split("=").slice(1).join("=");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUserId(userSessionHeader: string | null): string | null {
  if (!userSessionHeader) return null;
  try {
    const parsed = JSON.parse(userSessionHeader) as { userId?: string };
    return parsed.userId || null;
  } catch {
    return null;
  }
}

function parseAssignmentId(userSessionHeader: string | null): number | null {
  if (!userSessionHeader) return null;
  try {
    const parsed = JSON.parse(userSessionHeader) as { assignmentId?: number };
    return typeof parsed.assignmentId === "number" ? parsed.assignmentId : null;
  } catch {
    return null;
  }
}

async function resolveUserSession(req: NextRequest): Promise<{
  userId: string;
  assignmentId?: number;
  header?: string;
  cookie?: string;
} | null> {
  const userSessionHeader = getUserSessionHeader(req);
  const cookieHeader = req.headers.get("cookie") || "";

  if (userSessionHeader) {
    const userId = parseUserId(userSessionHeader);
    if (!userId) return null;
    return {
      userId,
      assignmentId: parseAssignmentId(userSessionHeader) || undefined,
      header: userSessionHeader,
    };
  }

  const cacheKey = cookieHeader;
  const cached = cacheKey ? userSessionCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return {
      userId: cached.value.userId,
      assignmentId: cached.value.assignmentId,
      cookie: cached.value.cookie,
    };
  }

  try {
    const res = await fetch(`${getBaseApiPath("v1")}/user-session`, {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      userId?: string;
      assignmentId?: number;
    };
    if (!data.userId) return null;
    const resolved = {
      userId: data.userId,
      assignmentId: data.assignmentId,
      cookie: cookieHeader || undefined,
    };
    if (cacheKey) {
      userSessionCache.set(cacheKey, {
        value: resolved,
        expiresAt: Date.now() + USER_SESSION_CACHE_TTL_MS,
      });
    }
    return resolved;
  } catch {
    return null;
  }
}

async function callBackendChat(
  req: NextRequest,
  payload: { userRole: string; userText: string; conversation: any[] },
): Promise<{
  reply: string;
  chatId?: string;
  functionResults?: any[];
  functionCalled?: boolean;
} | null> {
  const session = await resolveUserSession(req);
  if (!session?.userId) return null;

  const assignmentId = session.assignmentId;
  const baseApiPath = getBaseApiPath("v1");
  const authHeaders = session.header
    ? { "user-session": session.header }
    : session.cookie
      ? { Cookie: session.cookie }
      : {};

  try {
    const chatRes = await fetch(`${baseApiPath}/chats/today`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ userId: session.userId, assignmentId }),
    });

    if (!chatRes.ok) {
      return null;
    }

    const chatData = (await chatRes.json()) as { id?: string };
    if (!chatData.id) return null;

    const respondRes = await fetch(
      `${baseApiPath}/chats/${chatData.id}/respond`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      },
    );

    if (!respondRes.ok) {
      return null;
    }

    const responseData = (await respondRes.json()) as {
      reply?: string;
      functionResults?: any[];
      functionCalled?: boolean;
    };
    if (!responseData.reply) return null;

    return {
      reply: responseData.reply,
      chatId: chatData.id,
      functionResults: responseData.functionResults,
      functionCalled: responseData.functionCalled,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userRole, userText, conversation } = body;

    if (!userRole || !userText || !conversation) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const backendResult = await callBackendChat(req, {
      userRole,
      userText,
      conversation,
    });

    if (!backendResult) {
      return NextResponse.json(
        { error: "Backend chat service unavailable" },
        { status: 502 },
      );
    }

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
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
