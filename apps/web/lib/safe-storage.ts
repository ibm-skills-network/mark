/* eslint-disable */
/**
 * Safe localStorage wrapper that handles QuotaExceededError.
 * When quota is exceeded, it clears localStorage and reloads the page.
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

function handleQuotaExceeded(operation: string): void {
  console.error(
    `QuotaExceededError during ${operation}. Clearing localStorage and reloading...`,
  );

  try {
    localStorage.clear();
  } catch (clearError) {
    console.error("Failed to clear localStorage:", clearError);
  }

  setTimeout(() => {
    window.location.reload();
  }, 100);
}

/**
 * Creates a safe localStorage wrapper that handles QuotaExceededError
 * by clearing localStorage and reloading the page.
 */
export function createSafeStorage(): SafeStorage {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }

  return {
    getItem: (name: string) => {
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
      } catch (error) {
        if (isQuotaExceededError(error)) {
          handleQuotaExceeded(`setItem for key "${name}"`);
        } else {
          console.error(`Error writing to localStorage (${name}):`, error);
          throw error;
        }
      }
    },

    removeItem: (name: string) => {
      try {
        localStorage.removeItem(name);
      } catch (error) {
        console.error(`Error removing from localStorage (${name}):`, error);
      }
    },
  };
}
