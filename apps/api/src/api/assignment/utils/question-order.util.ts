export function sanitizeQuestionOrder(
  order?: readonly number[] | null,
): number[] {
  return Array.isArray(order)
    ? order.filter((id): id is number => Number.isFinite(id))
    : [];
}

export function normalizeQuestionOrder(
  validIds: readonly number[],
  order?: readonly number[] | null,
): number[] {
  const validSet = new Set(validIds);
  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const id of sanitizeQuestionOrder(order)) {
    if (validSet.has(id) && !seen.has(id)) {
      normalized.push(id);
      seen.add(id);
    }
  }

  for (const id of validIds) {
    if (!seen.has(id)) {
      normalized.push(id);
      seen.add(id);
    }
  }

  return normalized;
}

export function applyQuestionOrder<T extends { id: number }>(
  items: readonly T[],
  order?: readonly number[] | null,
): T[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));

  return normalizeQuestionOrder(
    items.map((item) => item.id),
    order,
  )
    .map((id) => itemMap.get(id))
    .filter((item): item is T => item !== undefined);
}
