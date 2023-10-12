import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function absoluteUrl(path: string) {
  const base = getBaseUrl();
  return `${base}${path}`;
}

const getBaseUrl = () => {
  if (typeof window !== "undefined") return ""; // browser should use relative url
  if (process.env.NODE_ENV === "production") //if next server wants to get the base url
    return `http://mark-api-gateway`; // SSR should use production url
  return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

// export function debounce<T extends (...args: unknown[]) => void>(
//   func: T,
//   delay: number
// ): (...args: Parameters<T>) => void {
//   let timer: ReturnType<typeof setTimeout>;
//   return (...args: Parameters<T>): void => {
//     clearTimeout(timer);
//     timer = setTimeout(() => {
//       func.apply(this, args);
//     }, delay);
//   };
// }
