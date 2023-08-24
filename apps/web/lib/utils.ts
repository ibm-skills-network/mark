export function absoluteUrl(path: string) {
  const base = process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  return `${base}${path}`;
}
