/**
 * @jest-environment jsdom
 */

const SESSION_DISMISSAL_KEY = "appConfig.tipsDismissedForSession";

type AppConfigStore = (typeof import("../appConfig"))["useAppConfig"];

/**
 * The store hydrates from storage at creation time, so "what does a learner see
 * on the next page load" can only be asked by building the store again.
 */
async function loadStore(): Promise<AppConfigStore> {
  jest.resetModules();
  const { useAppConfig } = await import("../appConfig");
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
    expect((await loadStore()).getState().tips).toBe(true);
  });

  it("remembers a dismissal for the rest of the browser session", async () => {
    (await loadStore()).getState().setTips(false);

    expect(sessionStorage.getItem(SESSION_DISMISSAL_KEY)).toBe("true");
    // A reload rebuilds the store from storage.
    expect((await loadStore()).getState().tips).toBe(false);
  });

  it("does not let the persisted default reopen tips after a dismissal", async () => {
    (await loadStore()).getState().setTips(false);

    // Without "don't show again" the localStorage copy deliberately stays true
    // so tips return in a later session; the session dismissal must still win.
    expect(persistedTips()).toBe(true);
    expect((await loadStore()).getState().tips).toBe(false);
  });

  it("shows tips again in a new browser session", async () => {
    (await loadStore()).getState().setTips(false);

    sessionStorage.clear(); // a new tab / a new session
    expect((await loadStore()).getState().tips).toBe(true);
  });

  it("keeps 'don't show this again' across sessions", async () => {
    const store = await loadStore();
    store.getState().setPersistTips(true);
    store.getState().setTips(false);

    expect(persistedTips()).toBe(false);
    sessionStorage.clear();
    expect((await loadStore()).getState().tips).toBe(false);
  });

  it("reopens tips when the tips content version changes", async () => {
    (await loadStore()).getState().setTips(false);

    const store = await loadStore();
    store.getState().setTipsVersion("v2.0");

    expect(store.getState().tips).toBe(true);
    expect(sessionStorage.getItem(SESSION_DISMISSAL_KEY)).toBeNull();
  });
});
