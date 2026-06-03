/**
 * UI internationalization (RouteUiTranslator) on the learner surface.
 *
 * The learner layout mounts <RouteUiTranslator scopeSelector="#learner-route-root" />
 * (apps/web/app/learner/layout.tsx). That component:
 *   - reads the `uiLang` query param; if it is a SUPPORTED code
 *     (apps/web/public/languages.json) it becomes the active UI language,
 *     persists it to localStorage["ui-language"], and flips
 *     document.documentElement.lang;
 *   - walks the DOM under the scope (+ the #dropdown-portal) and rewrites
 *     translatable text nodes using the static maps in
 *     apps/web/lib/static-ui-translations/<code>/translations.json;
 *   - listens for the "ui-language-changed" CustomEvent (dispatched by
 *     setStoredUiLanguage in apps/web/lib/ui-language.ts) so an in-app language
 *     switch mutates the page live WITHOUT a reload;
 *   - falls back to the stored language (or DEFAULT_UI_LANGUAGE = "en") when the
 *     query param is missing or unsupported.
 *
 * We assert against GROUND-TRUTH French strings pulled from
 * apps/web/lib/static-ui-translations/fr/translations.json — these are stable,
 * distinctive labels rendered on the learner assignment-overview page:
 *   "Time Limit"      -> "Limite de temps"
 *   "Passing Grade"   -> "Note de passage"
 *   "Grading Criteria"-> "Critères de notation"
 *
 * Role: learner (this dir runs under the learner-* projects, whose storageState
 * is learner@example.com / pw-group). The shared `assignmentIds.learner.id`
 * assignment is the canonical seeded overview used by the other learner specs.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/e2e-test";

// Ground truth from apps/web/lib/static-ui-translations/fr/translations.json.
const FR = {
  TIME_LIMIT: "Limite de temps",
  PASSING_GRADE: "Note de passage",
  GRADING_CRITERIA: "Critères de notation",
} as const;

// English source labels (apps/web learner overview).
const EN = {
  TIME_LIMIT: "Time Limit",
  PASSING_GRADE: "Passing Grade",
  GRADING_CRITERIA: "Grading Criteria",
} as const;

/**
 * The first-visit language modal ("Please pick one of the available languages")
 * can intercept the overview; dismiss it if present (benign when absent).
 */
async function dismissLanguageModalIfPresent(page: Page) {
  const modalTitle = page.getByText(
    "Please pick one of the available languages",
  );
  await modalTitle.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {
    return null;
  });
  if (!(await modalTitle.isVisible().catch(() => false))) {
    return;
  }
  const modal = page.locator("div.fixed.inset-0.z-50").filter({
    has: modalTitle,
  });
  const confirmButton = modal.getByRole("button", { name: "Confirm" });
  if (await confirmButton.isEnabled().catch(() => false)) {
    await confirmButton.click();
  }
  await modalTitle.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {
    return null;
  });
}

test.describe("Learner - UI i18n (RouteUiTranslator)", () => {
  test("?uiLang=fr renders a known label translated and flips <html lang> to fr", async ({
    page,
    assignmentIds,
  }) => {
    // lang=en keeps the assignment CONTENT in English so only the UI chrome
    // (uiLang) is what changes — isolating the RouteUiTranslator behavior.
    await page.goto(`/learner/${assignmentIds.learner.id}?lang=en&uiLang=fr`);
    await dismissLanguageModalIfPresent(page);

    // The document language attribute flips to the active UI language.
    await expect(page.locator("html")).toHaveAttribute("lang", "fr", {
      timeout: 15_000,
    });

    // Distinctive French labels are rendered in place of their English source.
    await expect(page.getByText(FR.TIME_LIMIT)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(FR.PASSING_GRADE)).toBeVisible();
    await expect(page.getByText(FR.GRADING_CRITERIA)).toBeVisible();

    // And the English source labels are no longer present (they were rewritten).
    await expect(page.getByText(EN.TIME_LIMIT, { exact: true })).toHaveCount(0);
    await expect(page.getByText(EN.PASSING_GRADE, { exact: true })).toHaveCount(
      0,
    );
  });

  test("default (no uiLang) renders English UI and <html lang>=en", async ({
    page,
    assignmentIds,
  }) => {
    await page.goto(`/learner/${assignmentIds.learner.id}?lang=en`);
    await dismissLanguageModalIfPresent(page);

    await expect(page.locator("html")).toHaveAttribute("lang", "en", {
      timeout: 15_000,
    });
    await expect(page.getByText(EN.TIME_LIMIT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // The French translation must NOT leak into the default English render.
    await expect(page.getByText(FR.TIME_LIMIT)).toHaveCount(0);
  });

  test("an UNSUPPORTED uiLang falls back to English (no translation, lang=en)", async ({
    page,
    assignmentIds,
  }) => {
    // "xx-NOPE" is not in public/languages.json -> isSupportedUiLanguage=false
    // -> RouteUiTranslator falls back to the stored/default language (en).
    await page.goto(
      `/learner/${assignmentIds.learner.id}?lang=en&uiLang=xx-NOPE`,
    );
    await dismissLanguageModalIfPresent(page);

    await expect(page.locator("html")).toHaveAttribute("lang", "en", {
      timeout: 15_000,
    });
    await expect(page.getByText(EN.TIME_LIMIT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(FR.TIME_LIMIT)).toHaveCount(0);
  });

  test("switching language live via the ui-language-changed event mutates text without reload and persists", async ({
    page,
    assignmentIds,
  }) => {
    // Start in English.
    await page.goto(`/learner/${assignmentIds.learner.id}?lang=en`);
    await dismissLanguageModalIfPresent(page);
    await expect(page.getByText(EN.TIME_LIMIT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Drive the SAME code path the in-app language switcher uses:
    // setStoredUiLanguage() writes localStorage["ui-language"] and dispatches the
    // "ui-language-changed" CustomEvent that RouteUiTranslator subscribes to.
    await page.evaluate(() => {
      window.localStorage.setItem("ui-language", "fr");
      window.dispatchEvent(
        new CustomEvent("ui-language-changed", { detail: "fr" }),
      );
    });

    // Live mutation (no navigation): the French label appears and <html lang>
    // flips, all without a reload.
    await expect(page.getByText(FR.TIME_LIMIT)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    // Persistence: a reload (no query param) restores French from localStorage.
    await page.reload();
    await dismissLanguageModalIfPresent(page);
    await expect(page.getByText(FR.TIME_LIMIT)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    // Switch back to English live and confirm the original text is restored.
    await page.evaluate(() => {
      window.localStorage.setItem("ui-language", "en");
      window.dispatchEvent(
        new CustomEvent("ui-language-changed", { detail: "en" }),
      );
    });
    await expect(page.getByText(EN.TIME_LIMIT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(FR.TIME_LIMIT)).toHaveCount(0);
  });
});
