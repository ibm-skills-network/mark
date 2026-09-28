import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import hljs from "highlight.js/lib/core";
import { createLowlight } from "lowlight";

/**
 * The languages the previous editor offered, and only those.
 *
 * Its code-block dropdown listed exactly these, so anything stored as
 * `data-language` is one of them. Registering lowlight's `common` set instead
 * would pull in roughly three times as many grammars for content that cannot
 * reference them.
 *
 * `plain` is deliberately absent: it is the previous editor's word for "no
 * language", not a grammar, and the shared normalizer drops it rather than
 * writing it as a class.
 */
const LANGUAGES = {
  bash,
  cpp,
  csharp,
  css,
  diff,
  java,
  javascript,
  markdown,
  php,
  python,
  ruby,
  sql,
  xml,
} as const;

/**
 * Aliases the old editor wrote into stored content. `cs` was its key for C#,
 * so a stored block says `language-cs` while the grammar is registered as
 * `csharp`; without the alias those blocks silently render unhighlighted.
 */
const ALIASES: Record<string, keyof typeof LANGUAGES> = {
  cs: "csharp",
  html: "xml",
  js: "javascript",
  py: "python",
  sh: "bash",
};

/**
 * One registry shared by every editor instance. The highlighter is part of the
 * schema, so building a second one gives two schemas that cannot exchange
 * content.
 */
export const lowlight = createLowlight();

/**
 * The same grammars for the read-only viewer, which highlights finished markup
 * rather than a live document and so needs highlight.js itself.
 *
 * `highlight.js/lib/core` carries no grammars of its own. Importing the package
 * root instead would register every language it ships — roughly 190 of them —
 * for content that can only ever name the thirteen below, and it would put the
 * whole set in the client bundle. Both registries are fed from one list here so
 * a language cannot exist in the editor and be missing in the viewer.
 */
export const highlighter = hljs;

for (const [name, grammar] of Object.entries(LANGUAGES)) {
  lowlight.register(name, grammar);
  hljs.registerLanguage(name, grammar);
}
for (const [alias, target] of Object.entries(ALIASES)) {
  lowlight.registerAlias(target, alias);
  hljs.registerAliases(alias, { languageName: target });
}

/** Language names a code block may carry, for the toolbar's picker. */
export const CODE_BLOCK_LANGUAGES = Object.keys(LANGUAGES).sort();
