import { resolveParser } from "./parse";
import { stripBlockIndent } from "./rules/block-indent";
import { normalizeCodeBlocks } from "./rules/code-blocks";
import { normalizeEmbeds } from "./rules/embeds";
import { normalizeInlineColors } from "./rules/inline-colors";
import { normalizeLists } from "./rules/lists";
import { stripEditorChrome } from "./rules/strip-editor-chrome";
import { normalizeTables } from "./rules/tables";
import type {
  NormalizeResult,
  ParseFragment,
  Rule,
  RuleContext,
} from "./types";

/**
 * Order is deliberate.
 *
 * Editor furniture goes first so later rules never see a stray marker span or a
 * serialised language dropdown. Code blocks are rebuilt before lists so the
 * per-line `<div>`s are gone before anything walks list structure. Block indent
 * runs after lists, so that list items have already had their indent consumed
 * as nesting and only non-list blocks are left for it. Colours run last, on the
 * final elements, so a hoisted wrapper is not left behind on an element another
 * rule was about to replace.
 */
const RULES: Rule[] = [
  stripEditorChrome,
  normalizeCodeBlocks,
  normalizeLists,
  stripBlockIndent,
  normalizeEmbeds,
  normalizeTables,
  normalizeInlineColors,
];

export interface NormalizeOptions {
  /** Fragment parser. Defaults to the browser's `DOMParser` when present. */
  parse?: ParseFragment;
}

/**
 * Rewrites editor-specific markup into the plain HTML the current editor reads.
 *
 * Every rule keys off a marker the old editor produced and does nothing when
 * that marker is absent, so running this on already-converted content is a
 * no-op and running it twice gives the same answer as running it once.
 *
 * Call it on already-sanitized HTML — sanitizing is what decides which tags and
 * hosts are permitted, and it has to see the untrusted string first.
 */
export function normalizeQuillHtml(
  html: string | null | undefined,
  options: NormalizeOptions = {},
): NormalizeResult {
  const input = html ?? "";
  if (input.trim() === "") {
    return { html: input, changes: 0, rulesFired: [], warnings: [] };
  }

  const root = resolveParser(options.parse)(input);

  const rulesFired: string[] = [];
  const context: RuleContext = { changes: 0, warnings: [] };

  for (const rule of RULES) {
    const before = context.changes;
    rule.apply(root, context);
    if (context.changes > before) {
      rulesFired.push(rule.name);
    }
  }

  return {
    // Returning the original string when nothing fired keeps this byte-exact
    // for untouched content: parsing and re-serialising alone rewrites
    // entities and attribute quoting, which would look like a change to every
    // caller that compares stored values.
    html: context.changes === 0 ? input : root.innerHTML,
    changes: context.changes,
    rulesFired,
    warnings: context.warnings,
  };
}
