export function getStoredData<T>(key: string, defaultValue: T): T {
  if (typeof window !== "undefined") {
    const storedData = localStorage.getItem(key);
    if (storedData) {
      try {
        return JSON.parse(storedData) as T;
      } catch (error) {
        console.error(`Error parsing localStorage data for key: ${key}`, error);
        return defaultValue;
      }
    }
  }
  return defaultValue;
}
