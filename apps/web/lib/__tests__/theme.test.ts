import {
  DEFAULT_THEME,
  THEME_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  applyTheme,
  getStoredTheme,
  isTheme,
  resolveDark,
  setStoredTheme,
} from "@/lib/theme";

function mockPrefersDark(matches: boolean) {
  (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-color-mode");
    mockPrefersDark(false);
  });

  describe("isTheme", () => {
    it("accepts the three valid themes", () => {
      expect(isTheme("light")).toBe(true);
      expect(isTheme("dark")).toBe(true);
      expect(isTheme("system")).toBe(true);
    });

    it("rejects invalid values", () => {
      expect(isTheme(null)).toBe(false);
      expect(isTheme(undefined)).toBe(false);
      expect(isTheme("")).toBe(false);
      expect(isTheme("blue")).toBe(false);
    });
  });

  describe("getStoredTheme", () => {
    it("returns the default when nothing is stored", () => {
      expect(getStoredTheme()).toBe(DEFAULT_THEME);
    });

    it("defaults to light even when the OS prefers dark", () => {
      mockPrefersDark(true);
      expect(getStoredTheme()).toBe("light");
      expect(resolveDark(getStoredTheme())).toBe(false);
    });

    it("ignores a value under the generic 'theme' key another app wrote", () => {
      window.localStorage.setItem("theme", "dark");
      expect(getStoredTheme()).toBe("light");
    });

    it("returns the default when the stored value is invalid", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
      expect(getStoredTheme()).toBe(DEFAULT_THEME);
    });

    it("returns a valid stored preference", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      expect(getStoredTheme()).toBe("dark");
    });
  });

  describe("resolveDark", () => {
    it("resolves explicit preferences regardless of the OS", () => {
      mockPrefersDark(true);
      expect(resolveDark("light")).toBe(false);
      expect(resolveDark("dark")).toBe(true);
    });

    it("follows the OS preference for system", () => {
      mockPrefersDark(false);
      expect(resolveDark("system")).toBe(false);
      mockPrefersDark(true);
      expect(resolveDark("system")).toBe(true);
    });
  });

  describe("applyTheme", () => {
    it("adds the dark class and data attribute for dark", () => {
      applyTheme("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-color-mode")).toBe(
        "dark",
      );
    });

    it("removes the dark class and sets the light attribute for light", () => {
      applyTheme("dark");
      applyTheme("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-color-mode")).toBe(
        "light",
      );
    });

    it("does not persist anything", () => {
      applyTheme("dark");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });
  });

  describe("setStoredTheme", () => {
    it("persists, applies, and announces the new theme", () => {
      const listener = jest.fn();
      window.addEventListener(THEME_CHANGED_EVENT, listener);

      setStoredTheme("dark");

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe("dark");

      window.removeEventListener(THEME_CHANGED_EVENT, listener);
    });

    it("ignores invalid themes", () => {
      setStoredTheme("neon" as never);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });
});
