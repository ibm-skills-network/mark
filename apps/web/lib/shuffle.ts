/**
 * Shuffle an array into a uniformly-random order using the Fisher-Yates
 * algorithm.
 *
 * Use this instead of `array.sort(() => Math.random() - 0.5)`, whose
 * distribution is heavily biased toward the original order for short arrays
 * (for 4 elements it leaves the array untouched ~19% of the time vs ~4% for a
 * true shuffle).
 *
 * Returns a new array; the input is not mutated. `random` is injectable so the
 * shuffle can be exercised deterministically in tests.
 */
export function shuffleArray<T>(
  items: T[],
  random: () => number = Math.random,
): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
