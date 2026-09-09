import { act, renderHook } from "@testing-library/react";

let currentSearch = "";
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { setStoredUiLanguage } from "@/lib/ui-language";

import { useActiveUiLanguage } from "../use-active-ui-language";

describe("useActiveUiLanguage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("adopts and persists a supported ?uiLang", () => {
    currentSearch = "uiLang=fr";
    const { result } = renderHook(() => useActiveUiLanguage());

    expect(result.current).toBe("fr");
    expect(window.localStorage.getItem("ui-language")).toBe("fr");
  });

  // The clobber this guards against: the user switches languages while the
  // page is still loading, then a component whose mount was gated on a fetch
  // mounts under the not-yet-updated URL. Its instance must defer to the
  // stored choice, not re-persist the stale ?uiLang and broadcast it.
  it("does not let a late-mounting instance re-assert an overridden ?uiLang", () => {
    currentSearch = "uiLang=de";
    const first = renderHook(() => useActiveUiLanguage());
    expect(first.result.current).toBe("de");

    act(() => {
      setStoredUiLanguage("en");
    });
    expect(first.result.current).toBe("en");

    const late = renderHook(() => useActiveUiLanguage());
    expect(late.result.current).toBe("en");
    expect(window.localStorage.getItem("ui-language")).toBe("en");
    expect(first.result.current).toBe("en");
  });

  it("re-applies ?uiLang on a fresh navigation to a new URL", () => {
    currentSearch = "uiLang=es";
    const { result, rerender } = renderHook(() => useActiveUiLanguage());
    expect(result.current).toBe("es");

    act(() => {
      setStoredUiLanguage("en");
    });
    currentSearch = "";
    rerender();
    expect(result.current).toBe("en");

    currentSearch = "uiLang=es";
    rerender();
    expect(result.current).toBe("es");
    expect(window.localStorage.getItem("ui-language")).toBe("es");
  });
});
