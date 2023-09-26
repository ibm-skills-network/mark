export function absoluteUrl(path: string) {
  const base =
    process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_APP_URL || ""
      : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}

export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}
