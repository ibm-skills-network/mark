import { createAssignmentScopedStorage } from "../assignment-storage";

function setPathname(path: string) {
  window.history.pushState({}, "", path);
}

describe("createAssignmentScopedStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    setPathname("/author/1");
  });

  describe("key resolution by scope", () => {
    it("generates assignment-{id}-author for author scope", () => {
      setPathname("/author/123/questions");
      const storage = createAssignmentScopedStorage("author", "fallback");
      storage.setItem("ignored-name", "v");
      expect(localStorage.getItem("assignment-123-author")).toBe("v");
    });

    it("generates assignment-{id}-config for config scope", () => {
      setPathname("/author/456");
      const storage = createAssignmentScopedStorage("config", "fallback");
      storage.setItem("ignored-name", "v");
      expect(localStorage.getItem("assignment-456-config")).toBe("v");
    });

    it("generates assignmentFeedbackConfig-{id} for feedbackConfig scope", () => {
      setPathname("/author/789");
      const storage = createAssignmentScopedStorage(
        "feedbackConfig",
        "fallback",
      );
      storage.setItem("ignored-name", "v");
      expect(localStorage.getItem("assignmentFeedbackConfig-789")).toBe("v");
    });

    it("resolves key from a learner route", () => {
      setPathname("/learner/999/questions");
      const storage = createAssignmentScopedStorage("author", "fallback");
      storage.setItem("ignored-name", "v");
      expect(localStorage.getItem("assignment-999-author")).toBe("v");
    });
  });

  it("falls back to fallbackName when the URL has no assignment id", () => {
    setPathname("/admin/settings");
    const storage = createAssignmentScopedStorage("author", "my-fallback");
    storage.setItem("ignored-name", "v");
    expect(localStorage.getItem("my-fallback")).toBe("v");
  });

  it("reads from the scoped key", () => {
    setPathname("/author/123");
    localStorage.setItem("assignment-123-author", "stored");
    const storage = createAssignmentScopedStorage("author", "fallback");
    expect(storage.getItem("ignored-name")).toBe("stored");
  });

  it("removes the scoped key", () => {
    setPathname("/author/123");
    localStorage.setItem("assignment-123-author", "stored");
    const storage = createAssignmentScopedStorage("author", "fallback");
    storage.removeItem("ignored-name");
    expect(localStorage.getItem("assignment-123-author")).toBeNull();
  });

  it("re-resolves the key on every access (SPA navigation fix)", () => {
    const storage = createAssignmentScopedStorage("config", "fallback");

    setPathname("/author/100");
    storage.setItem("ignored-name", "data-100");

    setPathname("/author/200");
    storage.setItem("ignored-name", "data-200");

    setPathname("/author/100");
    expect(storage.getItem("ignored-name")).toBe("data-100");

    setPathname("/author/200");
    expect(storage.getItem("ignored-name")).toBe("data-200");
  });

  it("does not bleed state between two different assignment ids on the same scope", () => {
    const storage = createAssignmentScopedStorage("author", "fallback");

    setPathname("/author/1");
    storage.setItem("ignored-name", "assignment-1-data");

    setPathname("/author/2");
    expect(storage.getItem("ignored-name")).toBeNull();
  });
});
