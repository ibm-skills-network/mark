import { HumanMessage } from "@langchain/core/messages";
import type {
  LlmRequestOptions,
  PromptCacheSpec,
} from "../interfaces/llm-provider.interface";

/**
 * Smallest prefix OpenAI will store. Below it the request still succeeds and
 * simply caches nothing, so a prefix that shrinks under this line degrades
 * silently — hence the exported constant and the tests that assert against it.
 */
export const MIN_CACHEABLE_PREFIX_TOKENS = 1024;

/** The only time-to-live the API accepts. */
const PROMPT_CACHE_TTL = "30m";

const EXPLICIT_BREAKPOINT = { mode: "explicit" } as const;

/**
 * Top-level request parameters that opt into explicit caching. Only ever call
 * this from a provider that advertises `supportsExplicitPromptCache` — the
 * parameters are rejected with a 400 by every other OpenAI model, including
 * the GPT-5.4 pair that shares the same provider base class.
 */
export function explicitPromptCacheKwargs(
  options?: LlmRequestOptions,
): Record<string, unknown> {
  const key = options?.promptCache?.key;
  if (!key) {
    return {};
  }
  return {
    prompt_cache_key: key,
    prompt_cache_options: { mode: "explicit", ttl: PROMPT_CACHE_TTL },
  };
}

/**
 * Splits a formatted prompt into a cacheable head and a varying tail.
 *
 * The head is marked with a breakpoint and the tail follows in the same
 * message and the same role, so the model receives byte-for-byte the text it
 * would have received as a single string. That keeps this a caching change
 * rather than a prompt change.
 *
 * Falls back to the uncached single-block form whenever the spec does not
 * describe this prompt — a mismatch means the head drifted from the template,
 * and sending a wrong breakpoint would cache the wrong bytes.
 */
export function buildPromptMessage(
  formattedPrompt: string,
  cache?: PromptCacheSpec,
): HumanMessage {
  if (!cache?.prefix || !formattedPrompt.startsWith(cache.prefix)) {
    return new HumanMessage(formattedPrompt);
  }

  const tail = formattedPrompt.slice(cache.prefix.length);
  if (tail.length === 0) {
    return new HumanMessage(formattedPrompt);
  }

  // The breakpoint field is an OpenAI extension the message types do not
  // model; it is passed through to the request body untouched.
  const content = [
    {
      type: "text",
      text: cache.prefix,
      prompt_cache_breakpoint: EXPLICIT_BREAKPOINT,
    },
    { type: "text", text: tail },
  ] as unknown as HumanMessage["content"];

  return new HumanMessage({ content });
}

/**
 * Renders a prompt head into the exact text the template will produce, so it
 * can be handed over as a cache prefix.
 *
 * The replacement is a function on purpose: format instructions are JSON and
 * routinely contain `$`, which a string replacement would interpret as a
 * substitution pattern and silently corrupt.
 */
export function renderCachePrefix(
  head: string,
  formatInstructions: string,
): string {
  return head.replace("{format_instructions}", () => formatInstructions);
}

/** True when `prefix` is a usable literal head of `formattedPrompt`. */
export function promptCacheApplies(
  formattedPrompt: string,
  cache?: PromptCacheSpec,
): boolean {
  return Boolean(
    cache?.prefix &&
      formattedPrompt.startsWith(cache.prefix) &&
      formattedPrompt.length > cache.prefix.length,
  );
}
