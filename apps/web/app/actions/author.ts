import type { VerbosityLevels } from "@/config/types";

export async function updateFeedbackVerbosity(verbosity: VerbosityLevels) {
  // Update the verbosity level in the backend
  await new Promise((res) => setTimeout(res, 1000));
  return verbosity;
}
