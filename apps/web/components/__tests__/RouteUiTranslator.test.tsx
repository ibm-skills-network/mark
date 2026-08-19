jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

jest.mock("@/lib/static-ui-translations", () => ({
  getStaticUiTranslations: jest.fn().mockResolvedValue({}),
}));

import { isInsideOptedOutSubtree, translateScope } from "../RouteUiTranslator";

// The translator rewrites text nodes in place, using a per-node "original" it
// records the first time it sees each node. Live UI — a ticking countdown, a
// changing status — rewrites those same nodes between passes, so the translator
// has to treat the app's newer text as the source. Otherwise every subsequent
// pass restores the first text it ever saw, silently reverting live UI to its
// first-rendered value.
//
// translateScope is driven by a MutationObserver in the component, but the
// observer's timing is not deterministic under jsdom, so these call it directly:
// pass 1 records, the app then writes, pass 2 must respect that write.
describe("RouteUiTranslator translateScope", () => {
  const hosts: HTMLElement[] = [];

  // Returns the Text node itself. React updates text in place via nodeValue on
  // the SAME node rather than reassigning element.textContent (which would swap
  // in a fresh node and defeat the translator's per-node memory), so the tests
  // have to mutate it the same way to exercise the real code path.
  const mountHost = (text: string): Text => {
    const host = document.createElement("div");
    const textNode = document.createTextNode(text);
    host.append(textNode);
    document.body.append(host);
    hosts.push(host);
    return textNode;
  };

  afterEach(() => {
    for (const host of hosts) host.remove();
    hosts.length = 0;
  });

  it("does not revert text the app updated between passes", () => {
    const node = mountHost("Please wait 5m 0s before retrying");

    translateScope(document.body, "en");
    node.nodeValue = "Please wait 4m 59s before retrying";
    translateScope(document.body, "en");

    expect(node.nodeValue).toBe("Please wait 4m 59s before retrying");
  });

  it("keeps following further updates instead of pinning to one value", () => {
    const node = mountHost("Please wait 3m 0s before retrying");
    translateScope(document.body, "en");

    for (const text of [
      "Please wait 2m 59s before retrying",
      "Please wait 2m 58s before retrying",
      "Please wait 2m 57s before retrying",
    ]) {
      node.nodeValue = text;
      translateScope(document.body, "en");
      expect(node.nodeValue).toBe(text);
    }
  });

  it("leaves static text untouched across repeated passes", () => {
    const node = mountHost("About this assignment");

    translateScope(document.body, "en");
    translateScope(document.body, "en");
    translateScope(document.body, "en");

    expect(node.nodeValue).toBe("About this assignment");
  });

  it("still restores its own translation if nothing else rewrote the node", () => {
    // With no loaded translations the pass is a no-op rewrite, but the node must
    // remain stable rather than drifting across passes.
    const node = mountHost("Begin the assignment");

    translateScope(document.body, "en");
    const afterFirst = node.nodeValue;
    translateScope(document.body, "en");

    expect(node.nodeValue).toBe(afterFirst);
  });
});

// The observer half of the fix: a mutation inside an opted-out subtree must not
// schedule a translation pass. Without this, isolating the ticking value stops
// it being rewritten but still walks and re-translates the whole route each
// second to produce no change.
describe("RouteUiTranslator isInsideOptedOutSubtree", () => {
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    for (const host of hosts) host.remove();
    hosts.length = 0;
  });

  const mount = (html: string): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    hosts.push(host);
    return host;
  };

  it("detects a text node inside an opted-out element", () => {
    const host = mount(`<span data-no-ui-translate="true">4m 54s</span>`);
    const textNode = host.querySelector("span")!.firstChild;
    expect(isInsideOptedOutSubtree(textNode)).toBe(true);
  });

  it("detects the opted-out element itself", () => {
    const host = mount(`<span data-no-ui-translate="true">4m 54s</span>`);
    expect(isInsideOptedOutSubtree(host.querySelector("span"))).toBe(true);
  });

  it("does not flag ordinary translatable content", () => {
    const host = mount(`<span>Please wait</span>`);
    const textNode = host.querySelector("span")!.firstChild;
    expect(isInsideOptedOutSubtree(textNode)).toBe(false);
    expect(isInsideOptedOutSubtree(host)).toBe(false);
  });

  it("still translates the static sentence around an opted-out value", () => {
    const host = mount(
      `Please wait <span data-no-ui-translate="true">4m 54s</span> before retrying`,
    );
    const time = host.querySelector("span")!.firstChild as Text;

    translateScope(document.body, "en");
    time.nodeValue = "4m 53s";
    translateScope(document.body, "en");

    // The value is left exactly as the app set it, never re-baselined or reverted.
    expect(time.nodeValue).toBe("4m 53s");
    expect(host.textContent).toContain("Please wait");
    expect(host.textContent).toContain("before retrying");
  });
});

// The re-baseline in readTextOriginal only works because every collected node
// reaches writeTextTranslation. That holds because the tree walker rejects text
// without letters, so empty/whitespace nodes are never collected or pinned —
// React reuses those nodes ({cond ? "" : "Label"}). These lock that invariant:
// if isTranslatableText is ever loosened, the pinning bug reappears here first.
describe("RouteUiTranslator nodes that start empty", () => {
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    for (const host of hosts) host.remove();
    hosts.length = 0;
  });

  const mountText = (text: string): Text => {
    const host = document.createElement("div");
    const node = document.createTextNode(text);
    host.append(node);
    document.body.append(host);
    hosts.push(host);
    return node;
  };

  it("keeps real text that replaces an empty node", () => {
    const node = mountText("");

    translateScope(document.body, "en");
    node.nodeValue = "Label";
    translateScope(document.body, "en");

    expect(node.nodeValue).toBe("Label");
  });

  it("keeps real text that replaces a whitespace-only node", () => {
    const node = mountText("   ");

    translateScope(document.body, "en");
    node.nodeValue = "Label";
    translateScope(document.body, "en");

    expect(node.nodeValue).toBe("Label");
  });
});
