/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

import {
  FULL_TOOLBAR_GROUPS,
  LEARNER_TOOLBAR_GROUPS,
} from "@/lib/rich-text/toolbar-config";

import RichTextEditor from "../rich-text/RichTextEditor";

/**
 * These cover the editor's two load-bearing behaviours on mount: what it does
 * to the string it is given, and what it does *not* send back.
 *
 * Mounting a real editor is deliberate. The interesting failures are in how
 * stored markup meets the schema, and a mocked editor cannot show that. No
 * layout is needed for any of it, so jsdom having none does not matter.
 *
 * What the schema does to each stored shape is not retested here — that is
 * `lib/rich-text/__tests__/schema-round-trip.test.ts`, which covers it per
 * shape rather than once through a mounted component.
 */
const editableHtml = () => screen.getByTestId("rich-text-editor").innerHTML;

describe("RichTextEditor", () => {
  it("sanitizes the incoming value before it reaches the document", async () => {
    render(
      <RichTextEditor
        value={
          '<p>safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'
        }
        setValue={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    });

    expect(editableHtml()).toContain("safe");
    expect(editableHtml()).not.toMatch(/onerror/i);
    expect(editableHtml()).not.toMatch(/<script/i);
  });

  it("does not report a change for content it only loaded", async () => {
    // The editor re-serialises what it parsed, so its HTML differs from almost
    // every stored legacy value. If loading a page reported that as an edit,
    // autosave would rewrite every field on open — and because the translation
    // cache compares HTML byte-for-byte, each rewrite re-bills a translation in
    // every supported language for content nobody touched.
    const setValue = jest.fn();

    render(
      <RichTextEditor
        value={'<ol><li data-list="bullet">Alpha</li></ol>'}
        setValue={setValue}
      />,
    );

    await waitFor(() => {
      expect(editableHtml()).toContain("Alpha");
    });

    expect(setValue).not.toHaveBeenCalled();
  });

  it.each([
    ["full" as const, FULL_TOOLBAR_GROUPS],
    ["learner" as const, LEARNER_TOOLBAR_GROUPS],
  ])(
    "renders a control for every item configured in the %s toolbar",
    async (mode, groups) => {
      // `toolbar-config.ts` is the record of which controls the previous
      // editor offered. This asserts the toolbar actually renders all of
      // them: a missing branch in the component would otherwise drop a
      // control silently, and losing one is invisible until an author goes
      // looking for a button that used to be there.
      render(
        <RichTextEditor
          value="<p>x</p>"
          setValue={jest.fn()}
          toolbarMode={mode}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("toolbar")).toBeInTheDocument();
      });

      expect(
        screen.getByRole("toolbar").querySelectorAll("button, select"),
      ).toHaveLength(groups.flat().length);
    },
  );

  it("seeds the counters from the parsed text, not the raw markup", async () => {
    render(
      <RichTextEditor
        value={"<p>one two three</p>"}
        setValue={jest.fn()}
        maxWords={10}
        maxCharacters={100}
      />,
    );

    // Counting the HTML string would report the tags too: 3 words and 13
    // characters is what was typed. Matched on the container's text because the
    // count is interpolated, so it is several text nodes rather than one.
    const counterText = () =>
      screen.getByTestId("rich-text-editor").closest(".rich-text-editor-shell")
        ?.textContent ?? "";

    await waitFor(() => {
      expect(counterText()).toContain("Words: 3 / 10");
    });
    expect(counterText()).toContain("Characters: 13 / 100");
  });
});
