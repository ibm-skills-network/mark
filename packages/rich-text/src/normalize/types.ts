export interface RuleContext {
  changes: number;

  warnings: string[];
}

export interface NormalizeResult {
  html: string;

  changes: number;

  rulesFired: string[];
  warnings: string[];
}

export interface Rule {
  name: string;
  apply: (root: Element, context: RuleContext) => void;
}

export type ParseFragment = (html: string) => Element;
