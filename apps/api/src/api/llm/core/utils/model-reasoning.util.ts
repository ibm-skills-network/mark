/** Keep request parameters and grading cache identities in agreement. */
export function getModelReasoningEffort(modelKey: string): "none" | "low" {
  // GPT-6.1 Sol does not support `none`; preserve it for Terra and Luna.
  return modelKey === "gpt-6.1-sol" ? "low" : "none";
}
