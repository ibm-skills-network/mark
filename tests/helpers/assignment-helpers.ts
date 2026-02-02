import fs from "fs";
import path from "path";

const DEFAULT_ASSIGNMENT_ID = 1;
const CACHE_PATH = path.resolve(
  __dirname,
  "../playwright/.cache/assignment.json",
);

export function getAssignmentId(): number {
  const envValue = process.env.PW_ASSIGNMENT_ID;
  if (envValue) {
    const parsed = Number(envValue);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const data = JSON.parse(raw) as { id?: number };
    if (typeof data.id === "number" && !Number.isNaN(data.id)) {
      return data.id;
    }
  } catch {
    // Ignore cache read errors and fall back to default.
  }

  return DEFAULT_ASSIGNMENT_ID;
}
