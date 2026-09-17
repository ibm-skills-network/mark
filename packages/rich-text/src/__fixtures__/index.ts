/**
 * Markup shapes taken verbatim from stored content, so the rules are tested
 * against what the database actually holds rather than an idealised sample.
 */
export const FIXTURES = {
  /** Quill wrote every list as `<ol>`, marking the real kind on each item. */
  bulletsAsOrderedList:
    '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Review your notes.</li>' +
    '<li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Upload the workbook.</li></ol>',

  orderedList:
    '<ol><li data-list="ordered"><span class="ql-ui" contenteditable="false"></span>First.</li>' +
    '<li data-list="ordered"><span class="ql-ui" contenteditable="false"></span>Second.</li></ol>',

  /** Both kinds inside one `<ol>`; absent from the sampled data but legal. */
  mixedList:
    '<ol><li data-list="ordered">One</li><li data-list="bullet">Bullet</li><li data-list="ordered">Two</li></ol>',

  /** Nesting was stored as a class, not as a nested list. */
  indentedList:
    '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Question 1: Upload your notebook.</li>' +
    '<li data-list="bullet" class="ql-indent-1"><span class="ql-ui" contenteditable="false"></span>1.1: Notebook uploaded.</li>' +
    '<li data-list="bullet" class="ql-indent-1"><span class="ql-ui" contenteditable="false"></span>1.2: Complete Question 1.</li></ol>',

  /** One `<div>` per line, plus the language dropdown serialised into content. */
  codeBlock:
    '<div class="ql-code-block-container" spellcheck="false">' +
    '<select class="ql-ui" contenteditable="false"><option value="plain">Plain</option><option value="bash">Bash</option></select>' +
    '<div class="ql-code-block" data-language="plain">const Row = React.memo(({ item }) =&gt; &lt;li&gt;{item.name}&lt;/li&gt;,</div>' +
    '<div class="ql-code-block" data-language="plain">                        (p, n) =&gt; p.item.id === n.item.id);</div>' +
    "</div>",

  codeBlockWithLanguage:
    '<div class="ql-code-block-container">' +
    '<div class="ql-code-block" data-language="python">value = 1</div>' +
    '<div class="ql-code-block" data-language="python">print(value)</div>' +
    "</div>",

  /** The shape the first editor generation wrote. */
  legacyCodeBlock: '<pre class="ql-syntax" spellcheck="false">print(1)\n</pre>',

  video:
    '<iframe class="ql-video" frameborder="0" allowfullscreen="true" src="https://www.youtube.com/embed/5BlARhT2t4Q?showinfo=0"></iframe>',

  /** A word-processor paste: colours on `<strong>`, and colours meaning "none". */
  colorsOnStrong:
    "<p>The <strong>final project</strong>" +
    '<span style="color: windowtext; background-color: transparent;"> consists of </span>' +
    '<strong style="color: rgb(255, 0, 0); background-color: rgb(238, 238, 238);">3 questions</strong></p>',

  table:
    '<table><tbody><tr><td data-row="1">Aspect</td></tr>' +
    '<tr><td data-row="2">State</td><td data-row="2">Hooks</td></tr></tbody></table>',

  /** Already in the target shape; every rule must leave this alone. */
  alreadyMigrated:
    "<p>Intro</p><ul><li>Alpha</li><li>Beta</li></ul>" +
    "<pre><code>print(1)</code></pre><p><strong>bold</strong></p>",

  plainParagraph: "<p>Nothing special here.</p>",
} as const;
