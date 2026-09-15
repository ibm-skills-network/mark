/**
 * Issues and verifies the OAuth `state` parameter for the GitHub file picker.
 *
 * Without a `state` the callback has no binding to the session that started the
 * flow: anyone who can get a learner's browser to post a code they obtained
 * elsewhere can attach their own GitHub account to that learner's Mark session.
 *
 * The value is stateless — a short payload plus an HMAC — so it survives a
 * full-page round trip to github.com and works across replicas without any
 * shared store. The session's user id is mixed into the signature rather than
 * written into the payload, so the learner's email never travels through
 * github.com.
 */
import { Injectable } from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * Separates the user id from the payload so that a different split of the same
 * bytes cannot produce the same signature. Written as an escape, never as a
 * literal byte: a raw NUL makes git classify this file as binary, which costs
 * it its diff and hides it from grep.
 */
const SIGNATURE_SEPARATOR = "\u0000";

@Injectable()
export class GithubOauthStateService {
  /**
   * Whether key material exists at all. Callers check this before starting a
   * handoff so a missing secret surfaces as a clean configuration error rather
   * than as an unhandled throw.
   */
  isConfigured(): boolean {
    return this.keySource().length > 0;
  }

  issue(userId: string, assignmentId: number, returnUrl?: string): string {
    const payload = [
      randomBytes(12).toString("base64url"),
      String(assignmentId),
      String(Date.now() + STATE_TTL_MS),
      ...(returnUrl ? [Buffer.from(returnUrl).toString("base64url")] : []),
    ].join("~");
    const encoded = Buffer.from(payload).toString("base64url");
    return `${encoded}.${this.sign(encoded, userId)}`;
  }

  verify(state: string | undefined, userId: string): boolean {
    if (!state || state.length > 4096 || !userId || !this.isConfigured()) {
      return false;
    }

    const separator = state.lastIndexOf(".");
    if (separator <= 0) {
      return false;
    }

    const encoded = state.slice(0, separator);
    const signature = state.slice(separator + 1);
    if (!this.signaturesMatch(this.sign(encoded, userId), signature)) {
      return false;
    }

    const parts = Buffer.from(encoded, "base64url").toString("utf8").split("~");
    if (parts.length !== 3 && parts.length !== 4) {
      return false;
    }

    const expiresAt = Number(parts[2]);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }

  /** Read a return destination only after checking its signature and lifetime. */
  returnUrl(state: string | undefined, userId: string): string | undefined {
    if (!this.verify(state, userId)) return undefined;
    const encoded = state.slice(0, state.lastIndexOf("."));
    const parts = Buffer.from(encoded, "base64url").toString("utf8").split("~");
    return parts.length === 4
      ? Buffer.from(parts[3], "base64url").toString("utf8")
      : undefined;
  }

  /**
   * Key material. `GITHUB_OAUTH_STATE_SECRET` wins when it is set; otherwise it
   * is the OAuth client secret, which every replica already has and which never
   * leaves the server. Rotating it invalidates in-flight handoffs, which is
   * harmless at a 15-minute TTL.
   */
  private keySource(): string {
    return (
      process.env.GITHUB_OAUTH_STATE_SECRET ||
      (process.env.NODE_ENV === "development"
        ? process.env.GITHUB_CLIENT_SECRET_LOCAL
        : process.env.GITHUB_CLIENT_SECRET) ||
      ""
    );
  }

  /**
   * Fails closed. Deriving a key from an empty source produces a constant that
   * anyone can compute from this source file, which silently voids the CSRF
   * binding the whole class exists to provide — so refuse instead.
   */
  private key(): Buffer {
    const source = this.keySource();
    if (!source) {
      throw new Error("GitHub OAuth state secret is not configured");
    }
    return createHash("sha256")
      .update(`mark-github-oauth-state:${source}`)
      .digest();
  }

  private sign(encodedPayload: string, userId: string): string {
    return createHmac("sha256", this.key())
      .update(`${userId}${SIGNATURE_SEPARATOR}${encodedPayload}`)
      .digest("base64url");
  }

  private signaturesMatch(expected: string, received: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
