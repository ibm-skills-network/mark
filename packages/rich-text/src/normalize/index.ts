import { resolveParser } from "./parse";
import { normalizeBlockIndent } from "./rules/block-indent";
import { normalizeBlockFormats } from "./rules/block-formats";
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

// Normalize block formats before code blocks, and colors after structure.
const RULES: Rule[] = [
  stripEditorChrome,
  normalizeBlockFormats,
  normalizeBlockIndent,
  normalizeCodeBlocks,
  normalizeLists,
  normalizeEmbeds,
  normalizeTables,
  normalizeInlineColors,
];

export interface NormalizeOptions {
  parse?: ParseFragment;
}

/** Idempotent legacy HTML conversion. Sanitize its output before rendering. */
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
    // Preserve original bytes when no rule changed the content.
    html: context.changes === 0 ? input : root.innerHTML,
    changes: context.changes,
    rulesFired,
    warnings: context.warnings,
  };
}
