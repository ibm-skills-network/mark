import {
  clearDraft,
  clearOtherDrafts,
  loadDraft,
  mergeDraftIntoQuestions,
  saveDraft,
} from "../learner-draft";

describe("learner draft persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips the answer fields for an attempt", () => {
    saveDraft(1, [
      { id: 10, learnerTextResponse: "my essay" },
      { id: 11, learnerUrlResponse: "https://github.com/a/b" },
      { id: 12, learnerChoices: ["A", "C"] },
      { id: 13, learnerAnswerChoice: false },
    ]);

    expect(loadDraft(1)).toEqual({
      "10": { learnerTextResponse: "my essay" },
      "11": { learnerUrlResponse: "https://github.com/a/b" },
      "12": { learnerChoices: ["A", "C"] },
      // `false` is a chosen answer, not an absent one, and must survive.
      "13": { learnerAnswerChoice: false },
    });
  });

  it("keeps drafts separate per attempt", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "first" }]);
    saveDraft(2, [{ id: 10, learnerTextResponse: "second" }]);

    expect(loadDraft(1)?.["10"].learnerTextResponse).toBe("first");
    expect(loadDraft(2)?.["10"].learnerTextResponse).toBe("second");
  });

  it("removes the draft when every answer is erased", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "something" }]);
    // A learner who clears their work must not have it restored on reload.
    // Erasing leaves empty strings and arrays in the store, not undefined —
    // this is the state the store actually produces after clearing.
    saveDraft(1, [
      { id: 10, learnerTextResponse: "", learnerUrlResponse: "" },
      { id: 11, learnerChoices: [], learnerAnswerChoice: null },
    ]);

    expect(loadDraft(1)).toBeNull();
  });

  it("clears one attempt's draft on submit", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "done" }]);
    clearDraft(1);

    expect(loadDraft(1)).toBeNull();
  });

  it("drops every other attempt's draft when an attempt starts", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "old" }]);
    saveDraft(2, [{ id: 10, learnerTextResponse: "older" }]);
    saveDraft(3, [{ id: 10, learnerTextResponse: "current" }]);

    clearOtherDrafts(3);

    expect(loadDraft(1)).toBeNull();
    expect(loadDraft(2)).toBeNull();
    expect(loadDraft(3)?.["10"].learnerTextResponse).toBe("current");
  });

  it("leaves unrelated localStorage keys alone", () => {
    window.localStorage.setItem("learner-123", "someone else's state");
    saveDraft(1, [{ id: 10, learnerTextResponse: "x" }]);

    clearOtherDrafts(99);

    expect(window.localStorage.getItem("learner-123")).toBe(
      "someone else's state",
    );
  });

  it("ignores a draft older than the retention window", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "ancient" }]);
    const key = "mark:draft:v1:1";
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    stored.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(key, JSON.stringify(stored));

    expect(loadDraft(1)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("discards a corrupted entry instead of throwing", () => {
    window.localStorage.setItem("mark:draft:v1:1", "{not json");

    expect(() => loadDraft(1)).not.toThrow();
    expect(loadDraft(1)).toBeNull();
  });

  it("ignores a draft whose timestamp is in the future", () => {
    saveDraft(1, [{ id: 10, learnerTextResponse: "time traveller" }]);
    const key = "mark:draft:v1:1";
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    stored.savedAt = Date.now() + 60 * 60 * 1000;
    window.localStorage.setItem(key, JSON.stringify(stored));

    expect(loadDraft(1)).toBeNull();
  });

  describe("hand-crafted storage content", () => {
    // localStorage is user-editable input: a draft the app never wrote must
    // not be able to push a broken value into the store, where it would be
    // restored — and re-break the page — on every visit until the TTL.
    function storePayload(answers: unknown): void {
      window.localStorage.setItem(
        "mark:draft:v1:1",
        JSON.stringify({ savedAt: Date.now(), answers }),
      );
    }

    it("drops fields that are not the expected type", () => {
      storePayload({
        "10": { learnerTextResponse: { nested: "object" } },
        "11": { learnerUrlResponse: 42 },
        "12": { learnerChoices: ["ok", { evil: true }] },
        "13": { learnerAnswerChoice: "true" },
        "14": { learnerTextResponse: "still fine" },
      });

      expect(loadDraft(1)).toEqual({
        "14": { learnerTextResponse: "still fine" },
      });
    });

    it("drops a field longer than any real answer", () => {
      storePayload({
        "10": { learnerTextResponse: "x".repeat(100_001) },
        "11": { learnerTextResponse: "normal answer" },
      });

      expect(loadDraft(1)).toEqual({
        "11": { learnerTextResponse: "normal answer" },
      });
    });

    it("ignores keys that are not question ids", () => {
      // Raw JSON, because in an object literal __proto__ would set the
      // prototype instead of creating the own key an attacker would store.
      window.localStorage.setItem(
        "mark:draft:v1:1",
        `{"savedAt":${Date.now()},"answers":{` +
          `"__proto__":{"learnerTextResponse":"polluted"},` +
          `"not-a-number":{"learnerTextResponse":"wrong key"},` +
          `"10":{"learnerTextResponse":"real"}}}`,
      );

      expect(loadDraft(1)).toEqual({ "10": { learnerTextResponse: "real" } });
    });

    it("returns null when nothing in the draft survives validation", () => {
      storePayload({ "10": { learnerTextResponse: 123 } });

      expect(loadDraft(1)).toBeNull();
    });
  });

  it("does nothing without an attempt id", () => {
    expect(() =>
      saveDraft(null, [{ id: 1, learnerTextResponse: "x" }]),
    ).not.toThrow();
    expect(loadDraft(null)).toBeNull();
  });

  describe("merging a draft over server questions", () => {
    it("fills only the fields the server has nothing for", () => {
      const merged = mergeDraftIntoQuestions(
        [
          { id: 10, learnerTextResponse: "" },
          { id: 11, learnerUrlResponse: "" },
          { id: 12, learnerChoices: [] },
        ],
        {
          "10": { learnerTextResponse: "recovered" },
          "11": { learnerUrlResponse: "https://x.test" },
          "12": { learnerChoices: ["B"] },
        },
      );

      expect(merged[0].learnerTextResponse).toBe("recovered");
      expect(merged[1].learnerUrlResponse).toBe("https://x.test");
      expect(merged[2].learnerChoices).toEqual(["B"]);
    });

    it("never overwrites an answer the server already holds", () => {
      // The server copy is the graded record; a stale local draft losing to it
      // is the whole reason this merge is one-directional.
      const merged = mergeDraftIntoQuestions(
        [{ id: 10, learnerTextResponse: "graded answer" }],
        { "10": { learnerTextResponse: "stale local" } },
      );

      expect(merged[0].learnerTextResponse).toBe("graded answer");
    });

    it("returns the questions untouched when there is no draft", () => {
      const questions = [{ id: 10, learnerTextResponse: "a" }];
      expect(mergeDraftIntoQuestions(questions, null)).toBe(questions);
    });

    it("fills a true/false answer the server has nothing for", () => {
      const merged = mergeDraftIntoQuestions(
        [{ id: 10, learnerAnswerChoice: null }],
        { "10": { learnerAnswerChoice: false } },
      );

      expect(merged[0].learnerAnswerChoice).toBe(false);
    });

    it("never overwrites a server-held true/false answer, even a false one", () => {
      // `false` is falsy but it is still the graded record; only a type
      // check keeps the merge one-directional for this field.
      const merged = mergeDraftIntoQuestions(
        [{ id: 10, learnerAnswerChoice: false }],
        { "10": { learnerAnswerChoice: true } },
      );

      expect(merged[0].learnerAnswerChoice).toBe(false);
    });
  });
});
