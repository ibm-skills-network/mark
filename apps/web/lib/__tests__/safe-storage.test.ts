import { createSafeStorage } from "../safe-storage";

const quotaError = () =>
  new DOMException("quota exceeded", "QuotaExceededError");

describe("createSafeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("reads and writes through to localStorage", () => {
    const storage = createSafeStorage();
    storage.setItem("key", "value");
    expect(storage.getItem("key")).toBe("value");
    expect(localStorage.getItem("key")).toBe("value");
    storage.removeItem("key");
    expect(storage.getItem("key")).toBeNull();
  });

  describe("when a write exceeds the quota", () => {
    it("keeps the value readable in memory instead of reloading", () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw quotaError();
      });
      const clearSpy = jest.spyOn(Storage.prototype, "clear");

      const storage = createSafeStorage();
      storage.setItem("big-key", "oversized value");

      // The old behavior cleared localStorage and reloaded the page. When
      // the oversized write recurs on every load that becomes an infinite
      // reload loop, so neither may happen.
      expect(clearSpy).not.toHaveBeenCalled();
      expect(storage.getItem("big-key")).toBe("oversized value");
    });

    it("does not clobber other keys", () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      localStorage.setItem("other-key", "kept");
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw quotaError();
      });

      const storage = createSafeStorage();
      storage.setItem("big-key", "oversized value");

      jest.restoreAllMocks();
      expect(localStorage.getItem("other-key")).toBe("kept");
    });

    it("prefers the newer in-memory value over a stale persisted one", () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      localStorage.setItem("key", "stale");
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw quotaError();
      });

      const storage = createSafeStorage();
      storage.setItem("key", "fresh");

      expect(storage.getItem("key")).toBe("fresh");
    });

    it("resumes persisting once a later write fits", () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const storage = createSafeStorage();

      const failing = jest
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw quotaError();
        });
      storage.setItem("key", "oversized");
      failing.mockRestore();

      storage.setItem("key", "small");
      expect(localStorage.getItem("key")).toBe("small");
      expect(storage.getItem("key")).toBe("small");
    });
  });

  it("rethrows non-quota write errors", () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("security error");
    });
    const storage = createSafeStorage();
    expect(() => storage.setItem("key", "value")).toThrow("security error");
  });
});
