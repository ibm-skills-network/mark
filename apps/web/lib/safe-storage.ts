/**
 * Safe localStorage wrapper that tolerates QuotaExceededError.
 *
 * A write that exceeds the quota falls back to an in-memory map instead of
 * clearing localStorage and reloading: when the oversized write happens on
 * every page load, clear-and-reload turns into an infinite reload loop (the
 * next load repeats the same write). With the fallback the session keeps
 * working; only cross-reload persistence of the oversized key is lost.
 */

export interface SafeStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
  );
}

/**
 * Creates a safe localStorage wrapper that falls back to in-memory storage
 * for writes that exceed the quota.
 */
export function createSafeStorage(): SafeStorage {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }

  // Overflowed values live here for the rest of the session. Reads prefer
  // this map so the store never observes a stale localStorage value after a
  // fallback write.
  const memoryFallback = new Map<string, string>();

  return {
    getItem: (name: string) => {
      const fallback = memoryFallback.get(name);
      if (fallback !== undefined) {
        return fallback;
      }
      try {
        return localStorage.getItem(name);
      } catch (error) {
        console.error(`Error reading from localStorage (${name}):`, error);
        return null;
      }
    },

    setItem: (name: string, value: string) => {
      try {
        localStorage.setItem(name, value);
        memoryFallback.delete(name);
      } catch (error) {
        if (isQuotaExceededError(error)) {
          console.error(
            `QuotaExceededError writing ${value.length} chars to ` +
              `localStorage key "${name}"; keeping the value in memory for ` +
              `this session instead.`,
          );
          memoryFallback.set(name, value);
        } else {
          console.error(`Error writing to localStorage (${name}):`, error);
          throw error;
        }
      }
    },

    removeItem: (name: string) => {
      memoryFallback.delete(name);
      try {
        localStorage.removeItem(name);
      } catch (error) {
        console.error(`Error removing from localStorage (${name}):`, error);
      }
    },
  };
}
