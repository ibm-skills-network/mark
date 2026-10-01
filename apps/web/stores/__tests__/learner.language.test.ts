import { useLearnerStore } from "../learner";

jest.mock("@/lib/talkToBackend", () => ({
  getUser: jest.fn(),
}));

describe("useLearnerStore.setUserPreferedLanguage", () => {
  beforeEach(() => {
    useLearnerStore.setState({ userPreferedLanguage: null });
  });

  it("normalises a regional tag to the supported base language", () => {
    useLearnerStore.getState().setUserPreferedLanguage("it-IT");
    expect(useLearnerStore.getState().userPreferedLanguage).toBe("it");
  });

  it("falls back to English for an unsupported language", () => {
    useLearnerStore.getState().setUserPreferedLanguage("xx");
    expect(useLearnerStore.getState().userPreferedLanguage).toBe("en");
  });

  it("clears the preference when given null instead of coercing it to English", () => {
    // The post-submit reset passes null. Turning that into "en" makes the
    // Header's uiLang URL sync see "en" vs the URL's uiLang=it and re-navigate
    // the questions route, whose server layout mints a fresh attempt.
    useLearnerStore.getState().setUserPreferedLanguage("it");
    useLearnerStore.getState().setUserPreferedLanguage(null);
    expect(useLearnerStore.getState().userPreferedLanguage).toBeNull();
  });
});
