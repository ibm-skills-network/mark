/**
 * Helpers shared by every multimodal provider so a caller can hand one image
 * or several through the same entry point.
 *
 * `invokeWithImage` accepts `string | string[]`: a single learner upload is by
 * far the common case, but a submission with several images must reach the
 * model as several image parts rather than silently grading only the first
 * one. Normalizing here keeps each provider's change to one map() call and
 * guarantees they all agree on what an "empty" image list means.
 */

/**
 * Normalize a single-or-many image payload to a list, dropping blank entries.
 * Blank entries are dropped rather than passed through because every provider
 * rejects an empty image URL, and one malformed member of a batch must not
 * fail the whole grade.
 */
export function toImageDataList(imageData: string | string[]): string[] {
  const list = Array.isArray(imageData) ? imageData : [imageData];
  return list.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
}

/**
 * Total encoded length of an image payload, for log context only. Never used
 * for token accounting — providers estimate image tokens separately and must
 * not tokenize a Base64 payload as prompt text.
 */
export function totalImageDataLength(imageData: string | string[]): number {
  return toImageDataList(imageData).reduce(
    (sum, entry) => sum + entry.length,
    0,
  );
}
