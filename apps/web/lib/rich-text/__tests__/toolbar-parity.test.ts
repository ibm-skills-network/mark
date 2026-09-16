/**
 * @jest-environment jsdom
 */

import {
  FULL_TOOLBAR_GROUPS,
  LEARNER_TOOLBAR_GROUPS,
  TOOLBAR_ACTIONS,
  type ToolbarItemId,
} from "../toolbar-config";

/**
 * The controls the previous editor offered, transcribed from its configuration
 * before it was removed:
 *
 *   full    = [header], [bold italic underline strike], [blockquote code-block],
 *             [ordered bullet], [sub super], [indent -1 +1], [rtl],
 *             [color background], [align], [link image video], [clean]
 *   learner = [bold italic underline], [ordered bullet], [link], [clean]
 *
 * Losing a control in the rewrite is invisible until an author goes looking for
 * a button that used to be there, so the two sets are compared directly.
 */
const PREVIOUS_FULL: ToolbarItemId[][] = [
  ["heading"],
  ["bold", "italic", "underline", "strike"],
  ["blockquote", "codeBlock"],
  ["orderedList", "bulletList"],
  ["subscript", "superscript"],
  ["outdent", "indent"],
  ["rtl"],
  ["color", "backgroundColor"],
  ["align"],
  ["link", "image", "video"],
  ["clearFormatting"],
];

const PREVIOUS_LEARNER: ToolbarItemId[][] = [
  ["bold", "italic", "underline"],
  ["orderedList", "bulletList"],
  ["link"],
  ["clearFormatting"],
];

describe("toolbar parity", () => {
  it("offers the same full toolbar, in the same groups and order", () => {
    expect(FULL_TOOLBAR_GROUPS).toEqual(PREVIOUS_FULL);
  });

  it("offers the same learner toolbar", () => {
    expect(LEARNER_TOOLBAR_GROUPS).toEqual(PREVIOUS_LEARNER);
  });

  it("gives the learner a strict subset of the full toolbar", () => {
    const full = new Set(FULL_TOOLBAR_GROUPS.flat());
    for (const item of LEARNER_TOOLBAR_GROUPS.flat()) {
      expect(full.has(item)).toBe(true);
    }
  });

  it("has a behaviour defined for every simple control", () => {
    // Controls that open a picker (heading, colour, align, link, image, video)
    // are driven by their own components rather than a single action.
    const withPickers = new Set<ToolbarItemId>([
      "heading",
      "color",
      "backgroundColor",
      "align",
      "link",
      "image",
      "video",
    ]);

    for (const item of FULL_TOOLBAR_GROUPS.flat()) {
      if (withPickers.has(item)) continue;
      expect(
        TOOLBAR_ACTIONS[item as keyof typeof TOOLBAR_ACTIONS],
      ).toBeDefined();
    }
  });
});
