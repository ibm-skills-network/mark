export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  async run<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    if (tasks.length === 0) return [];

    const results: T[] = Array.from({ length: tasks.length });
    let index = 0;

    const workers = Array.from({
      length: Math.min(this.maxConcurrent, tasks.length),
    }).fill(null);

    await Promise.all(
      workers.map(async () => {
        while (index < tasks.length) {
          const currentIndex = index;
          index += 1;
          results[currentIndex] = await tasks[currentIndex]();
        }
      }),
    );

    return results;
  }
}
