import { HumanMessage } from "@langchain/core/messages";
import {
  buildPromptMessage,
  explicitPromptCacheKwargs,
  promptCacheApplies,
  renderCachePrefix,
} from "./prompt-cache.util";

interface TextBlock {
  type: string;
  text: string;
  prompt_cache_breakpoint?: { mode: string };
}

function blocksOf(message: HumanMessage): TextBlock[] {
  expect(Array.isArray(message.content)).toBe(true);
  return message.content as unknown as TextBlock[];
}

describe("explicitPromptCacheKwargs", () => {
  it("sends nothing when no cache was requested", () => {
    expect(explicitPromptCacheKwargs()).toEqual({});
    expect(explicitPromptCacheKwargs({})).toEqual({});
  });

  it("sends the key and the only supported ttl", () => {
    expect(
      explicitPromptCacheKwargs({
        promptCache: { key: "mark:test:v1", prefix: "head" },
      }),
    ).toEqual({
      prompt_cache_key: "mark:test:v1",
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
    });
  });
});

describe("buildPromptMessage", () => {
  const prefix = "INVARIANT RULES\n\n";
  const tail = "QUESTION:\nwhat is the pH?";
  const formatted = prefix + tail;

  it("splits the prompt at the breakpoint without altering the text", () => {
    const blocks = blocksOf(
      buildPromptMessage(formatted, { prefix, key: "k" }),
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0].prompt_cache_breakpoint).toEqual({ mode: "explicit" });
    expect(blocks[1].prompt_cache_breakpoint).toBeUndefined();

    // The model must receive byte-for-byte what it received before caching.
    expect(blocks.map((block) => block.text).join("")).toBe(formatted);
  });

  it("falls back to a single block when no cache is requested", () => {
    const message = buildPromptMessage(formatted);
    expect(message.content).toBe(formatted);
  });

  it("falls back when the prefix is not actually a prefix", () => {
    // A head that drifted from its template would otherwise cache bytes the
    // prompt never contained.
    const message = buildPromptMessage(formatted, {
      prefix: "DIFFERENT RULES\n\n",
      key: "k",
    });
    expect(message.content).toBe(formatted);
  });

  it("falls back when the prompt is nothing but the prefix", () => {
    const message = buildPromptMessage(prefix, { prefix, key: "k" });
    expect(message.content).toBe(prefix);
  });
});

describe("promptCacheApplies", () => {
  it("requires a non-empty tail", () => {
    expect(promptCacheApplies("abcdef", { prefix: "abc", key: "k" })).toBe(
      true,
    );
    expect(promptCacheApplies("abc", { prefix: "abc", key: "k" })).toBe(false);
    expect(promptCacheApplies("abcdef", { prefix: "xyz", key: "k" })).toBe(
      false,
    );
    expect(promptCacheApplies("abcdef")).toBe(false);
  });
});

describe("renderCachePrefix", () => {
  it("substitutes the format instructions", () => {
    expect(renderCachePrefix("rules\n{format_instructions}\n", "SCHEMA")).toBe(
      "rules\nSCHEMA\n",
    );
  });

  it("preserves dollar sequences in the instructions", () => {
    // Format instructions are JSON and routinely contain `$`. A plain string
    // replacement would read `$&` as "the matched substring" and corrupt the
    // prefix, which would then never match the formatted prompt.
    const instructions = '{"pattern":"$&","cost":"$1.00","tail":"$\'"}';
    const rendered = renderCachePrefix("{format_instructions}", instructions);
    expect(rendered).toBe(instructions);
  });
});
