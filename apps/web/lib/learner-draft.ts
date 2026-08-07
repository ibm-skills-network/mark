/**
 * Local draft persistence for in-progress learner answers.
 *
 * Answers live in the Zustand store and are only sent to the server when the
 * learner submits, so a reload, crash, or closed tab loses everything typed so
 * far. This mirrors the answer fields into localStorage as they change and
 * merges them back when the attempt is reopened.
 *
 * Deliberately client-only: no request and no schema change. Two tabs on the
 * same attempt overwrite each other's draft whole — last writer wins, so one
 * tab's newer answer can lose. Acceptable for crash recovery; the submitted
 * answers still come from whichever tab submits.
 *
 * Uploads are out of scope. A File cannot be revived from localStorage, so
 * storing its name would only promise a recovery that never happens.
 */

const KEY_PREFIX = "mark:draft:v1:";

/** Drafts older than this are dropped on read rather than restored. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reading a draft back is parsing user-editable input: anything in
 * localStorage can be hand-crafted. A field longer than any real answer is
 * dropped rather than restored, so a crafted entry cannot wedge the page or
 * blow the storage quota on every save.
 */
const MAX_DRAFT_FIELD_CHARS = 100_000;
const MAX_DRAFT_CHOICES = 200;

/** Answer fields worth persisting — everything a learner types or picks. */
export interface DraftAnswer {
  learnerTextResponse?: string;
  learnerUrlResponse?: string;
  learnerChoices?: string[];
  learnerAnswerChoice?: boolean;
}

interface DraftPayload {
  savedAt: number;
  answers: Record<string, DraftAnswer>;
}

function keyFor(attemptId: number): string {
  return `${KEY_PREFIX}${attemptId}`;
}

/**
 * localStorage throws rather than degrades in several ordinary situations —
 * Safari private mode, a full quota, storage disabled by policy — and it does
 * not exist during server rendering. Draft persistence is a convenience, so
 * every failure here is swallowed: losing a draft must never break the page
 * the learner is trying to use.
 */
function safeRead(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or storage unavailable — the answer is still in memory
    // and will be submitted normally; only crash-recovery is lost.
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do — a stale draft is dropped by its TTL on the next read.
  }
}

/**
 * Keep only the answer fields; question text and rubric are not ours to cache.
 * Empty strings and empty arrays are skipped, not stored: they are what the
 * store holds after a learner erases an answer, and keeping them would leave a
 * draft entry behind for work that no longer exists. `false` stays — it is a
 * real true/false answer.
 */
function pickAnswer(question: {
  learnerTextResponse?: string | null;
  learnerUrlResponse?: string | null;
  learnerChoices?: string[] | null;
  learnerAnswerChoice?: boolean | null;
}): DraftAnswer | null {
  const answer: DraftAnswer = {};
  if (
    typeof question.learnerTextResponse === "string" &&
    question.learnerTextResponse.length > 0
  ) {
    answer.learnerTextResponse = question.learnerTextResponse;
  }
  if (
    typeof question.learnerUrlResponse === "string" &&
    question.learnerUrlResponse.length > 0
  ) {
    answer.learnerUrlResponse = question.learnerUrlResponse;
  }
  if (
    Array.isArray(question.learnerChoices) &&
    question.learnerChoices.length > 0
  ) {
    answer.learnerChoices = question.learnerChoices;
  }
  if (typeof question.learnerAnswerChoice === "boolean") {
    answer.learnerAnswerChoice = question.learnerAnswerChoice;
  }
  return Object.keys(answer).length > 0 ? answer : null;
}

export function saveDraft(
  attemptId: number | null | undefined,
  questions: Array<{
    id?: number;
    learnerTextResponse?: string | null;
    learnerUrlResponse?: string | null;
    learnerChoices?: string[] | null;
    learnerAnswerChoice?: boolean | null;
  }>,
): void {
  if (typeof attemptId !== "number") return;

  const answers: Record<string, DraftAnswer> = {};
  for (const question of questions ?? []) {
    if (typeof question.id !== "number") continue;
    const answer = pickAnswer(question);
    if (answer) answers[String(question.id)] = answer;
  }

  if (Object.keys(answers).length === 0) {
    // Nothing answered yet: clear rather than store an empty draft, so a
    // learner who erases their work does not get it resurrected on reload.
    safeRemove(keyFor(attemptId));
    return;
  }

  const payload: DraftPayload = { savedAt: Date.now(), answers };
  safeWrite(keyFor(attemptId), JSON.stringify(payload));
}

/**
 * Rebuild one stored answer from untrusted bytes, field by field. A draft the
 * app wrote always passes; anything else — an object where a string should
 * be, a non-string choice, an absurdly long value — is dropped so it can
 * never reach the store and break rendering on every visit until the TTL
 * finally expires it.
 */
function sanitizeStoredAnswer(value: unknown): DraftAnswer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const answer: DraftAnswer = {};

  const text = record.learnerTextResponse;
  if (
    typeof text === "string" &&
    text.length > 0 &&
    text.length <= MAX_DRAFT_FIELD_CHARS
  ) {
    answer.learnerTextResponse = text;
  }

  const url = record.learnerUrlResponse;
  if (
    typeof url === "string" &&
    url.length > 0 &&
    url.length <= MAX_DRAFT_FIELD_CHARS
  ) {
    answer.learnerUrlResponse = url;
  }

  const choices = record.learnerChoices;
  if (
    Array.isArray(choices) &&
    choices.length > 0 &&
    choices.length <= MAX_DRAFT_CHOICES &&
    choices.every(
      (choice): choice is string =>
        typeof choice === "string" && choice.length <= MAX_DRAFT_FIELD_CHARS,
    )
  ) {
    answer.learnerChoices = choices;
  }

  if (typeof record.learnerAnswerChoice === "boolean") {
    answer.learnerAnswerChoice = record.learnerAnswerChoice;
  }

  return Object.keys(answer).length > 0 ? answer : null;
}

export function loadDraft(
  attemptId: number | null | undefined,
): Record<string, DraftAnswer> | null {
  if (typeof attemptId !== "number") return null;

  const raw = safeRead(keyFor(attemptId));
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupted entry (truncated write, hand-edited storage) — discard it.
    safeRemove(keyFor(attemptId));
    return null;
  }

  const payload = parsed as Partial<DraftPayload> | null;
  if (
    !payload ||
    typeof payload.savedAt !== "number" ||
    typeof payload.answers !== "object" ||
    payload.answers === null
  ) {
    safeRemove(keyFor(attemptId));
    return null;
  }

  // A timestamp from the future is as untrustworthy as one past the TTL —
  // nothing the app wrote can produce it.
  const age = Date.now() - payload.savedAt;
  if (age > DRAFT_TTL_MS || age < 0) {
    safeRemove(keyFor(attemptId));
    return null;
  }

  // Question ids are numbers; any other key shape was not written by us.
  const answers: Record<string, DraftAnswer> = {};
  for (const [key, value] of Object.entries(payload.answers)) {
    if (!/^\d+$/.test(key)) continue;
    const answer = sanitizeStoredAnswer(value);
    if (answer) answers[key] = answer;
  }

  return Object.keys(answers).length > 0 ? answers : null;
}

export function clearDraft(attemptId: number | null | undefined): void {
  if (typeof attemptId !== "number") return;
  safeRemove(keyFor(attemptId));
}

/**
 * Drop every draft except the attempt now in progress.
 *
 * Keys are per-attempt, so without this a learner accumulates one entry for
 * every assignment they have ever opened on that browser. Called when an
 * attempt starts: at most one draft exists at any time, and a fresh attempt
 * never inherits a previous one's answers.
 *
 * Pass nothing to clear all of them.
 */
export function clearOtherDrafts(keepAttemptId?: number | null): void {
  try {
    if (typeof window === "undefined") return;
    const keep =
      typeof keepAttemptId === "number" ? keyFor(keepAttemptId) : null;

    // Collect first: removing while iterating shifts localStorage's indices.
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(KEY_PREFIX) && key !== keep) stale.push(key);
    }
    for (const key of stale) safeRemove(key);
  } catch {
    // Storage unavailable — nothing to clean up.
  }
}

/**
 * Merge a stored draft over freshly-fetched questions.
 *
 * The server's copy wins when it already holds an answer — it is the graded
 * record, and a stale local draft must not overwrite it. The draft only fills
 * fields the server has nothing for, which is exactly the work that was typed
 * but never submitted.
 */
export function mergeDraftIntoQuestions<
  T extends {
    id?: number;
    learnerTextResponse?: string | null;
    learnerUrlResponse?: string | null;
    learnerChoices?: string[] | null;
    learnerAnswerChoice?: boolean | null;
  },
>(questions: T[], draft: Record<string, DraftAnswer> | null): T[] {
  if (!draft) return questions;

  return questions.map((question) => {
    if (typeof question.id !== "number") return question;
    const saved = draft[String(question.id)];
    if (!saved) return question;

    const merged: T = { ...question };
    let changed = false;

    if (!merged.learnerTextResponse && saved.learnerTextResponse) {
      merged.learnerTextResponse = saved.learnerTextResponse;
      changed = true;
    }
    if (!merged.learnerUrlResponse && saved.learnerUrlResponse) {
      merged.learnerUrlResponse = saved.learnerUrlResponse;
      changed = true;
    }
    if (
      (!merged.learnerChoices || merged.learnerChoices.length === 0) &&
      saved.learnerChoices &&
      saved.learnerChoices.length > 0
    ) {
      merged.learnerChoices = saved.learnerChoices;
      changed = true;
    }
    // Checked by type, not truthiness: a server-held `false` is a real
    // true/false answer and must win over the draft like any other field.
    if (
      typeof merged.learnerAnswerChoice !== "boolean" &&
      typeof saved.learnerAnswerChoice === "boolean"
    ) {
      merged.learnerAnswerChoice = saved.learnerAnswerChoice;
      changed = true;
    }

    return changed ? merged : question;
  });
}
