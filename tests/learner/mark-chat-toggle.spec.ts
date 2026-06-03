/**
 * MarkChat open/close toggle (learner role).
 *
 * The learner Header renders <MarkChatToggleButton role="learner" />
 * (apps/web/app/learner/(components)/Header.tsx). The button calls
 * useChatbot().toggle() (apps/web/hooks/useChatbot.ts), flipping `isOpen`.
 * LayoutContent always mounts <MarkChat /> for non-/admin routes
 * (apps/web/components/LayoutContent.tsx), and MarkChat renders its panel only
 * while useChatbot().isOpen is true (AnimatePresence guard in
 * apps/web/app/chatbot/components/MarkChat.tsx). When open the panel header
 * shows an <h2>Mark AI Assistant</h2> and a close (X) button that calls the
 * same toggle.
 *
 * This spec asserts ONLY the open/close behavior of the panel — never message
 * content (sending a message hits /api/markChat/stream, which is out of scope
 * and non-deterministic). The toggle button carries title="Open Mark AI
 * Assistant", giving a stable, non-translatable locator.
 *
 * Note: useChatbot only persists `isMuted` (partialize), so `isOpen` is false
 * on every fresh load — each test starts closed.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/e2e-test";

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

// The panel header heading only exists while the chat is open.
function panelHeading(page: Page) {
  return page.getByRole("heading", { name: "Mark AI Assistant", level: 2 });
}

// The toggle button in the learner header (title is the stable, code-defined id).
function toggleButton(page: Page) {
  return page.getByTitle("Open Mark AI Assistant").first();
}

test.describe("Learner - MarkChat toggle", () => {
  test.beforeEach(async ({ page, assignmentIds }) => {
    await page.goto(`/learner/${assignmentIds.learner.id}?lang=en`);
    await dismissLanguageModalIfPresent(page);
  });

  test("chat panel is closed by default and the toggle button is visible", async ({
    page,
  }) => {
    await expect(toggleButton(page)).toBeVisible({ timeout: 15_000 });
    await expect(panelHeading(page)).toHaveCount(0);
  });

  test("clicking the toggle opens the MarkChat panel", async ({ page }) => {
    await toggleButton(page).click();
    await expect(panelHeading(page)).toBeVisible({ timeout: 10_000 });
    // The assistant greeting (seeded in useMarkChatStore) confirms the chat body
    // mounted, not just the header.
    await expect(
      page.getByText("How can I help you with your assignment today?"),
    ).toBeVisible();
  });

  test("clicking the panel close (X) button closes the MarkChat panel", async ({
    page,
  }) => {
    await toggleButton(page).click();
    await expect(panelHeading(page)).toBeVisible({ timeout: 10_000 });

    // The close button sits in the panel header next to the heading; it is the
    // first button after the "Mark AI Assistant" title.
    const panelHeader = page
      .locator("div")
      .filter({ has: panelHeading(page) })
      .first();
    await panelHeader.getByRole("button").first().click();

    await expect(panelHeading(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test("the toggle re-opens the panel after it was closed", async ({
    page,
  }) => {
    // open
    await toggleButton(page).click();
    await expect(panelHeading(page)).toBeVisible({ timeout: 10_000 });

    // close via the header X
    const panelHeader = page
      .locator("div")
      .filter({ has: panelHeading(page) })
      .first();
    await panelHeader.getByRole("button").first().click();
    await expect(panelHeading(page)).toHaveCount(0, { timeout: 10_000 });

    // re-open via the toggle button
    await toggleButton(page).click();
    await expect(panelHeading(page)).toBeVisible({ timeout: 10_000 });
  });
});
