export function absoluteUrl(path: string) {
  const base =
    process.env.NODE_ENV === "production"
      ? "https://www.example.com"
      : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}
