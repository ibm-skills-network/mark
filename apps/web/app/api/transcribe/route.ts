import { TranscriptSegment } from "@/config/types";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

/** OpenAI rejects anything larger; reject it here rather than paying for the upload. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_MAX_TRACKED_SESSIONS = 5000;

const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIPTION_MODEL = "whisper-1";

const recentRequests = new Map<string, number[]>();

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  const cookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("authentication="));

  if (!cookie) return null;
  const value = cookie.slice("authentication=".length);
  return value.length > 0 ? value : null;
}

/** Identifies a caller for rate limiting without holding on to their session token. */
function sessionKey(sessionCookie: string): string {
  return createHash("sha256").update(sessionCookie).digest("hex").slice(0, 16);
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  if (recentRequests.size > RATE_LIMIT_MAX_TRACKED_SESSIONS) {
    for (const [trackedKey, timestamps] of recentRequests) {
      if (timestamps.every((timestamp) => timestamp <= cutoff)) {
        recentRequests.delete(trackedKey);
      }
    }
  }

  const timestamps = (recentRequests.get(key) ?? []).filter(
    (timestamp) => timestamp > cutoff,
  );
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    recentRequests.set(key, timestamps);
    return true;
  }

  timestamps.push(now);
  recentRequests.set(key, timestamps);
  return false;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const sessionCookie = readSessionCookie(req);
  const session = sessionCookie ? sessionKey(sessionCookie) : null;

  console.info("transcribe.request.received", {
    session,
    contentLength: req.headers.get("content-length"),
  });

  if (!session) {
    console.warn("transcribe.request.rejected", { reason: "no_session" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const apiKey = process.env.OPENAI_API_SPEECH_TEXT_KEY;
    if (!apiKey) {
      console.error("transcribe.request.failed", {
        session,
        reason: "speech_to_text_credential_missing",
      });
      return NextResponse.json(
        { error: "Transcription unavailable" },
        { status: 500 },
      );
    }

    if (isRateLimited(session)) {
      console.warn("transcribe.request.rejected", {
        session,
        reason: "rate_limited",
      });
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    let audioFile: FormDataEntryValue | null = null;
    try {
      audioFile = (await req.formData()).get("audio");
    } catch (error) {
      console.warn("transcribe.request.rejected", {
        session,
        reason: "unreadable_form_data",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (!audioFile || !(audioFile instanceof Blob) || audioFile.size === 0) {
      console.warn("transcribe.request.rejected", {
        session,
        reason: "missing_audio",
      });
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (audioFile.type && !audioFile.type.startsWith("audio/")) {
      console.warn("transcribe.request.rejected", {
        session,
        reason: "unsupported_media_type",
        mediaType: audioFile.type,
      });
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (audioFile.size > MAX_AUDIO_BYTES) {
      console.warn("transcribe.request.rejected", {
        session,
        reason: "audio_too_large",
        bytes: audioFile.size,
      });
      return NextResponse.json(
        { error: "Recording is too long" },
        { status: 413 },
      );
    }

    const openAiFormData = new FormData();
    openAiFormData.append("model", TRANSCRIPTION_MODEL);
    openAiFormData.append("file", audioFile);
    openAiFormData.append("response_format", "verbose_json");

    console.info("transcribe.speech_to_text.requested", {
      session,
      model: TRANSCRIPTION_MODEL,
      bytes: audioFile.size,
    });

    const response = await fetch(TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: openAiFormData,
    });

    if (!response.ok) {
      // Keep the upstream detail in the logs; the browser gets a generic error.
      const errorText = await response.text();
      console.error("transcribe.speech_to_text.failed", {
        session,
        status: response.status,
        durationMs: Date.now() - startedAt,
        errorText: errorText.slice(0, 500),
      });
      return NextResponse.json(
        { error: "Transcription failed" },
        { status: 502 },
      );
    }

    const data: {
      text: string;
      segments: TranscriptSegment[];
    } = (await response.json()) as {
      text: string;
      segments: TranscriptSegment[];
    };

    console.info("transcribe.request.succeeded", {
      session,
      durationMs: Date.now() - startedAt,
      // Lengths only: the transcript is learner content.
      characters: typeof data.text === "string" ? data.text.length : 0,
      segments: Array.isArray(data.segments) ? data.segments.length : 0,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("transcribe.request.failed", {
      session,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 500 },
    );
  }
}
