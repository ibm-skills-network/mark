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
import { createLowlight } from "lowlight";

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

// Keep language aliases found in legacy HTML.
const ALIASES: Record<string, keyof typeof LANGUAGES> = {
  cs: "csharp",
  html: "xml",
  js: "javascript",
  py: "python",
  sh: "bash",
};

export const lowlight = createLowlight();

for (const [name, grammar] of Object.entries(LANGUAGES)) {
  lowlight.register(name, grammar);
}
for (const [alias, target] of Object.entries(ALIASES)) {
  lowlight.registerAlias(target, alias);
}

export const CODE_BLOCK_LANGUAGES = Object.keys(LANGUAGES).sort();
