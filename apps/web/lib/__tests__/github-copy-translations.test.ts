import {
  describeGithubAuthFailure,
  type GithubAuthFailure,
} from "@/lib/github-oauth";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";
import languages from "@/public/languages.json";

// The catalogs are keyed by the exact English source text, so a new English
// string is invisible to every non-English learner until it is added to all of
// them. The GitHub file picker rewrote its whole error vocabulary, and the one
// message that used to be translated ("Your GitHub token is invalid or
// expired.") no longer exists.
const FAILURE_KINDS: GithubAuthFailure[] = [
  "configuration",
  "authorization_expired",
  "authorization_invalid",
  "access_denied",
  "token_rejected",
  "session_expired",
  "unavailable",
  "unknown",
];

// Rendered by GithubUploadModal when there is no usable connection.
const MODAL_COPY = [
  "Connect to GitHub",
  "Upload a file instead",
  "Connect your GitHub account to browse your repositories.",
  "The GitHub connection is unavailable. You can upload your file directly " +
    "on this question instead — close this dialog and drop it into the " +
    "upload box.",
];

const GITHUB_COPY = [
  ...FAILURE_KINDS.map((kind) => describeGithubAuthFailure(kind).message),
  ...MODAL_COPY,
];

const translatedLanguages = languages
  .map((language) => language.code)
  .filter((code) => code !== DEFAULT_UI_LANGUAGE);

describe("GitHub file-picker copy in the UI translation catalogs", () => {
  it("covers every language the app offers", () => {
    expect(translatedLanguages.length).toBeGreaterThan(20);
  });

  describe.each(translatedLanguages)("%s", (code) => {
    const catalog = getStaticUiTranslations(code);

    it("carries every GitHub string", () => {
      const missing = GITHUB_COPY.filter(
        (source) => !catalog[source] && !catalog[normalizeSourceText(source)],
      );

      expect(missing).toEqual([]);
    });

    it("does not leave any of them as the English source", () => {
      const untranslated = GITHUB_COPY.filter(
        (source) =>
          (catalog[source] ?? catalog[normalizeSourceText(source)]) === source,
      );

      expect(untranslated).toEqual([]);
    });
  });
});
