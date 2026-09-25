/** A rule reports what it changed, so a caller can tell real work from a no-op. */
export interface RuleContext {
  /** Incremented once per element a rule actually rewrites. */
  changes: number;
  /** Content a rule could not convert safely, surfaced rather than guessed at. */
  warnings: string[];
}

export interface NormalizeResult {
  html: string;
  /**
   * How many elements were rewritten. **Ask this, never `html !== input`**:
   * parsing and re-serialising is not byte-identical even when nothing is
   * transformed (entity re-encoding, attribute quoting), so an inequality check
   * reports a change on content that was left alone. `normalizeQuillHtml`
   * returns the original string untouched when this is 0, which is what keeps
   * the read path byte-exact on already-converted content.
   */
  changes: number;
  /** Names of the rules that changed something. Read by the rule tests. */
  rulesFired: string[];
  warnings: string[];
}

export interface Rule {
  name: string;
  apply: (root: Element, context: RuleContext) => void;
}

/**
 * Parses an HTML fragment and returns the element holding it.
 *
 * Supplied by the caller so this package needs no HTML parser of its own: the
 * browser already has `DOMParser`, and Node callers pass one built on their own
 * dependency. Keeping the parser out means a Node DOM implementation can never
 * be pulled into a browser bundle, and the rules below stay a single
 * implementation operating on standard DOM nodes.
 */
export type ParseFragment = (html: string) => Element;
