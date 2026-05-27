/**
 * Pre-grading sanity check for text responses. Rejects obvious noise
 * (empty, binary, random/encoded data) before the response reaches the
 * LLM grading pipeline. Cheap heuristic intended to short-circuit clearly
 * ungradable input — NOT a substitute for the rubric judge.
 */

export interface SanityCheckDetails {
  length: number;
  printableRatio: number;
  whitespaceRatio: number;
  entropyBitsPerChar: number;
}

export type SanityRejectionReason =
  | "response_too_short"
  | "response_unprintable"
  | "response_high_entropy";

export interface SanityCheckResult {
  isUsable: boolean;
  reason?: SanityRejectionReason;
  details?: SanityCheckDetails;
}

const MIN_LENGTH = 3;
const MIN_LENGTH_FOR_PRINTABLE_CHECK = 16;
const PRINTABLE_RATIO_THRESHOLD = 0.7;
const MIN_LENGTH_FOR_ENTROPY_CHECK = 50;
// Encoded random data has high entropy AND almost no whitespace. Natural
// prose hits ~4 bits/char and >10% whitespace; minified code is high entropy
// but still carries punctuation/newlines. The combined check catches base64
// / hex blobs without flagging dense text.
const HIGH_ENTROPY_THRESHOLD = 4.5;
const WHITESPACE_FLOOR_FOR_LONG_RESPONSE = 0.04;

const UNPRINTABLE = /\p{C}/u;
const WHITESPACE = /\s/u;

function isPrintable(char: string): boolean {
  return WHITESPACE.test(char) || !UNPRINTABLE.test(char);
}

function computePrintableRatio(codePoints: string[]): number {
  if (codePoints.length === 0) return 1;
  let printable = 0;
  for (const char of codePoints) {
    if (isPrintable(char)) printable += 1;
  }
  return printable / codePoints.length;
}

function computeWhitespaceRatio(codePoints: string[]): number {
  if (codePoints.length === 0) return 0;
  let whitespace = 0;
  for (const char of codePoints) {
    if (WHITESPACE.test(char)) whitespace += 1;
  }
  return whitespace / codePoints.length;
}

function computeShannonEntropy(codePoints: string[]): number {
  if (codePoints.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const c of codePoints) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  const total = codePoints.length;
  for (const count of counts.values()) {
    const p = count / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function checkTextResponseSanity(response: string): SanityCheckResult {
  const trimmed = (response ?? "").trim();
  const codePoints = [...trimmed];
  const length = codePoints.length;

  if (length < MIN_LENGTH) {
    return { isUsable: false, reason: "response_too_short" };
  }

  const printableRatio = computePrintableRatio(codePoints);
  const whitespaceRatio = computeWhitespaceRatio(codePoints);
  const entropyBitsPerChar = computeShannonEntropy(codePoints);
  const details: SanityCheckDetails = {
    length,
    printableRatio,
    whitespaceRatio,
    entropyBitsPerChar,
  };

  if (
    length >= MIN_LENGTH_FOR_PRINTABLE_CHECK &&
    printableRatio < PRINTABLE_RATIO_THRESHOLD
  ) {
    return { isUsable: false, reason: "response_unprintable", details };
  }

  if (
    length >= MIN_LENGTH_FOR_ENTROPY_CHECK &&
    entropyBitsPerChar >= HIGH_ENTROPY_THRESHOLD &&
    whitespaceRatio < WHITESPACE_FLOOR_FOR_LONG_RESPONSE
  ) {
    return { isUsable: false, reason: "response_high_entropy", details };
  }

  return { isUsable: true };
}
