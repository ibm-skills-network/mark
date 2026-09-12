import DOMPurify from "dompurify";

/**
 * Interactive elements are removed from rendered rich text. None of them are
 * produced by the authoring editor, and the same renderer replays content that
 * did not come from an author: a learner's submitted answer is shown back in
 * the author's review screen, and translated text is written by a model that
 * can be steered by the content it is given. A credential-harvesting form
 * inside an authenticated page is the concrete risk. `KEEP_CONTENT` is left on,
 * so the element disappears but its text is still shown.
 */
const FORBIDDEN_TAGS = [
  "form",
  "input",
  "button",
  "textarea",
  "object",
  "embed",
];

/**
 * Hosts a video embed may point at. The editor's video button writes an
 * `<iframe>`, so frames cannot simply be dropped, but an arbitrary
 * cross-origin frame is a phishing surface in an authenticated page, so only
 * the players the button targets survive.
 */
const ALLOWED_EMBED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
]);

/**
 * Keeps a surviving embed from acting as the page: no top-level navigation, no
 * forms, no downloads. Scripts and its own origin are allowed because the
 * players need them, and the host is one we chose.
 */
const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation";

function isAllowedEmbedSource(source: string | null): boolean {
  if (!source) {
    return false;
  }

  try {
    const url = new URL(source, window.location.href);
    return (
      url.protocol === "https:" &&
      ALLOWED_EMBED_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    // A source DOMPurify left in place but the URL parser rejects is not one we
    // can vouch for, so the frame goes.
    return false;
  }
}

let embedHookRegistered = false;

/**
 * `FORBID_TAGS` cannot express "an iframe, but only pointing at these hosts",
 * so the source check runs after attribute sanitization, where the URL is
 * final. Registering is deferred because the hook API only exists once
 * DOMPurify has a DOM to work with.
 */
function registerEmbedHook(): void {
  if (embedHookRegistered) {
    return;
  }
  embedHookRegistered = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "IFRAME") {
      return;
    }

    if (!isAllowedEmbedSource(node.getAttribute("src"))) {
      node.remove();
      return;
    }

    node.setAttribute("sandbox", EMBED_SANDBOX);
    node.setAttribute("referrerpolicy", "no-referrer");
  });
}

/**
 * Sanitize an HTML string before it is written to `innerHTML`.
 *
 * The Quill-based viewer/editor render HTML that can originate from untrusted
 * sources (stored assignment content, learner submissions, hostile clients).
 * Quill itself does not strip active content, so every string is run through
 * DOMPurify before it reaches the DOM. The profile keeps the formatting tags,
 * classes, and data-attributes Quill emits, while removing `<script>`, inline
 * event handlers, `javascript:`-style URLs, interactive elements, and frames
 * that do not point at a known video host.
 *
 * The returned string is final. Anything that rewrites it before it reaches
 * the DOM re-opens what was closed here: sanitization is parse-then-serialize,
 * and a later string edit can move a `>` that only looked like a tag boundary,
 * turning inert attribute text into live elements.
 *
 * Safe to call during SSR: falls back to stripping all tags when the DOM is
 * unavailable so active content never appears in the initial HTML payload.
 * Components that call this directly in JSX (not inside a useEffect) should
 * add suppressHydrationWarning on the target element to silence the expected
 * server/client text-vs-html difference.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  const raw = html ?? "";
  if (typeof window === "undefined") {
    // No DOM on the server: strip all tags as a safe fallback. The `(>|$)`
    // anchor also consumes an unterminated trailing tag (e.g. a dangling
    // `<img src=x onerror=...` with no closing `>`), so no `<` survives and
    // the browser cannot parse the result as active markup.
    return raw.replace(/<[^>]*(?:>|$)/g, "");
  }

  registerEmbedHook();

  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling"],
    FORBID_TAGS: FORBIDDEN_TAGS,
  });
}
