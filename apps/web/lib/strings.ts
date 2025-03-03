import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const extractAssignmentId = (url: string): string | null => {
  const match = url.match(/\/author\/(\d+)/);
  if (!match || match.length < 2) {
    console.error("Invalid URL format. Unable to extract assignment ID.");
    return null;
  }
  return match[1];
};
