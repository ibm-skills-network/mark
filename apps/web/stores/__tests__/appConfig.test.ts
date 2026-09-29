/**
 * @jest-environment jsdom
 */

const SESSION_DISMISSAL_KEY = "appConfig.tipsDismissedForSession";

type AppConfigModule = typeof import("../appConfig");
type AppConfigStore = AppConfigModule["useAppConfig"];

/**
 * The store hydrates from storage at creation time, so "what does a learner see
 * on the next page load" can only be asked by building the store again.
 */
async function loadModule(): Promise<AppConfigModule> {
  jest.resetModules();
  return import("../appConfig");
}

/** The store exactly as it is built — the state the server also renders. */
async function loadStore(): Promise<AppConfigStore> {
  return (await loadModule()).useAppConfig;
}

/**
 * A real page load: the store is built, React hydrates it, and only then does
 * the page apply anything that exists solely in the browser.
 */
async function mountStore(): Promise<AppConfigStore> {
  const { useAppConfig, applyTipsSessionDismissal } = await loadModule();
  applyTipsSessionDismissal();
  return useAppConfig;
}

function persistedTips(): boolean | undefined {
  const raw = localStorage.getItem("appConfig");
  if (!raw) return undefined;
  return (JSON.parse(raw) as { state?: { tips?: boolean } }).state?.tips;
}

describe("appConfig tips visibility", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("shows tips on a first visit", async () => {
    expect((await mountStore()).getState().tips).toBe(true);
  });

  it("remembers a dismissal for the rest of the browser session", async () => {
    (await mountStore()).getState().setTips(false);

    expect(sessionStorage.getItem(SESSION_DISMISSAL_KEY)).toBe("true");
    // A reload rebuilds the store from storage.
    expect((await mountStore()).getState().tips).toBe(false);
  });

  it("does not let the persisted default reopen tips after a dismissal", async () => {
    (await mountStore()).getState().setTips(false);

    // Without "don't show again" the localStorage copy deliberately stays true
    // so tips return in a later session; the session dismissal must still win.
    expect(persistedTips()).toBe(true);
    expect((await mountStore()).getState().tips).toBe(false);
  });

  it("shows tips again in a new browser session", async () => {
    (await mountStore()).getState().setTips(false);

    sessionStorage.clear(); // a new tab / a new session
    expect((await mountStore()).getState().tips).toBe(true);
  });

  it("keeps 'don't show this again' across sessions", async () => {
    const store = await mountStore();
    store.getState().setPersistTips(true);
    store.getState().setTips(false);

    expect(persistedTips()).toBe(false);
    sessionStorage.clear();
    expect((await mountStore()).getState().tips).toBe(false);
  });

  it("reopens tips when the tips content version changes", async () => {
    (await mountStore()).getState().setTips(false);

    const store = await mountStore();
    store.getState().setTipsVersion("v2.0");

    expect(store.getState().tips).toBe(true);
    expect(sessionStorage.getItem(SESSION_DISMISSAL_KEY)).toBeNull();
  });
});

describe("appConfig server/client first render", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("builds with tips visible even when this session already dismissed them", async () => {
    // The store is built at module scope, which on the server happens without
    // sessionStorage. If construction consults it on the client, the first
    // client render disagrees with the server HTML and React throws the whole
    // question grid away and repaints it — the learner watches the tips column
    // appear and vanish.
    sessionStorage.setItem(SESSION_DISMISSAL_KEY, "true");

    expect((await loadStore()).getState().tips).toBe(true);
  });

  it("does not read sessionStorage while the store is being built", async () => {
    sessionStorage.setItem(SESSION_DISMISSAL_KEY, "true");
    const getItem = jest.spyOn(Storage.prototype, "getItem");

    try {
      await loadStore();

      const sessionReads = getItem.mock.contexts.filter(
        (context) => context === window.sessionStorage,
      ).length;
      expect(sessionReads).toBe(0);
    } finally {
      getItem.mockRestore();
    }
  });

  it("applies the session dismissal once the page has mounted", async () => {
    sessionStorage.setItem(SESSION_DISMISSAL_KEY, "true");
    const { useAppConfig, applyTipsSessionDismissal } = await loadModule();

    expect(useAppConfig.getState().tips).toBe(true);

    applyTipsSessionDismissal();

    expect(useAppConfig.getState().tips).toBe(false);
    expect(useAppConfig.getState().tipsDismissedForSession).toBe(true);
  });

  it("leaves tips alone after mount when this session never dismissed them", async () => {
    const { useAppConfig, applyTipsSessionDismissal } = await loadModule();

    applyTipsSessionDismissal();

    expect(useAppConfig.getState().tips).toBe(true);
    expect(useAppConfig.getState().tipsDismissedForSession).toBe(false);
  });
});
