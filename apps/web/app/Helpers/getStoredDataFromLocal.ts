export function getStoredData<T>(key: string, defaultValue: T): T {
  if (typeof window !== "undefined") {
    const storedData = localStorage.getItem(key);
    if (storedData) {
      try {
        return JSON.parse(storedData) as T;
      } catch (error) {
        return defaultValue;
      }
    }
  }
  return defaultValue;
}
