import type { Editor } from "@tiptap/core";

import type { ToolbarMode } from "./extensions";

export type ToolbarItemId =
  | "heading"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "blockquote"
  | "codeBlock"
  | "orderedList"
  | "bulletList"
  | "subscript"
  | "superscript"
  | "outdent"
  | "indent"
  | "rtl"
  | "color"
  | "backgroundColor"
  | "align"
  | "link"
  | "image"
  | "video"
  | "clearFormatting";

/**
 * The previous editor's toolbars, control for control and group for group.
 *
 * Kept as data so the two are comparable at a glance and a test can assert the
 * set directly. Losing a control here is the kind of regression nobody notices
 * until an author goes looking for a button that used to exist.
 *
 * Previously:
 *   full    = header, bold/italic/underline/strike, blockquote/code-block,
 *             ordered/bullet list, sub/super, indent -1/+1, rtl,
 *             colour/background, align, link/image/video, clean
 *   learner = bold/italic/underline, ordered/bullet list, link, clean
 */
export const FULL_TOOLBAR_GROUPS: ToolbarItemId[][] = [
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

export const LEARNER_TOOLBAR_GROUPS: ToolbarItemId[][] = [
  ["bold", "italic", "underline"],
  ["orderedList", "bulletList"],
  ["link"],
  ["clearFormatting"],
];

export const TOOLBAR_GROUPS_BY_MODE: Record<ToolbarMode, ToolbarItemId[][]> = {
  full: FULL_TOOLBAR_GROUPS,
  learner: LEARNER_TOOLBAR_GROUPS,
};

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export const TEXT_ALIGNMENTS = ["left", "center", "right", "justify"] as const;

/**
 * The previous editor's default palette, so an author opens the colour picker
 * and sees the grid they already know.
 */
export const COLOR_SWATCHES = [
  "#000000",
  "#e60000",
  "#ff9900",
  "#ffff00",
  "#008a00",
  "#0066cc",
  "#9933ff",
  "#ffffff",
  "#facccc",
  "#ffebcc",
  "#ffffcc",
  "#cce8cc",
  "#cce0f5",
  "#ebd6ff",
  "#bbbbbb",
  "#f06666",
  "#ffc266",
  "#ffff66",
  "#66b966",
  "#66a3e0",
  "#c285ff",
  "#888888",
  "#a10000",
  "#b26b00",
  "#b2b200",
  "#006100",
  "#0047b2",
  "#6b24b2",
  "#444444",
  "#5c0000",
  "#663d00",
  "#666600",
  "#003700",
  "#002966",
  "#3d1466",
];

export interface ToolbarAction {
  isActive: (editor: Editor) => boolean;
  isDisabled: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const chain = (editor: Editor) => editor.chain().focus();

/**
 * Indent and outdent apply only inside a list.
 *
 * The previous editor also indented bare paragraphs, which this cannot
 * reproduce; the button is disabled outside a list rather than doing nothing
 * when pressed. No stored content relies on it — the 25 paragraphs that did are
 * handled by the shared normalizer, which drops the indent and reports it.
 */
export const TOOLBAR_ACTIONS: Record<
  Exclude<
    ToolbarItemId,
    | "heading"
    | "color"
    | "backgroundColor"
    | "align"
    | "link"
    | "image"
    | "video"
  >,
  ToolbarAction
> = {
  bold: {
    isActive: (editor) => editor.isActive("bold"),
    isDisabled: (editor) => !editor.can().toggleBold(),
    run: (editor) => chain(editor).toggleBold().run(),
  },
  italic: {
    isActive: (editor) => editor.isActive("italic"),
    isDisabled: (editor) => !editor.can().toggleItalic(),
    run: (editor) => chain(editor).toggleItalic().run(),
  },
  underline: {
    isActive: (editor) => editor.isActive("underline"),
    isDisabled: (editor) => !editor.can().toggleUnderline(),
    run: (editor) => chain(editor).toggleUnderline().run(),
  },
  strike: {
    isActive: (editor) => editor.isActive("strike"),
    isDisabled: (editor) => !editor.can().toggleStrike(),
    run: (editor) => chain(editor).toggleStrike().run(),
  },
  blockquote: {
    isActive: (editor) => editor.isActive("blockquote"),
    isDisabled: (editor) => !editor.can().toggleBlockquote(),
    run: (editor) => chain(editor).toggleBlockquote().run(),
  },
  codeBlock: {
    isActive: (editor) => editor.isActive("codeBlock"),
    isDisabled: (editor) => !editor.can().toggleCodeBlock(),
    run: (editor) => chain(editor).toggleCodeBlock().run(),
  },
  orderedList: {
    isActive: (editor) => editor.isActive("orderedList"),
    isDisabled: (editor) => !editor.can().toggleOrderedList(),
    run: (editor) => chain(editor).toggleOrderedList().run(),
  },
  bulletList: {
    isActive: (editor) => editor.isActive("bulletList"),
    isDisabled: (editor) => !editor.can().toggleBulletList(),
    run: (editor) => chain(editor).toggleBulletList().run(),
  },
  subscript: {
    isActive: (editor) => editor.isActive("subscript"),
    isDisabled: (editor) => !editor.can().toggleSubscript(),
    run: (editor) => chain(editor).toggleSubscript().run(),
  },
  superscript: {
    isActive: (editor) => editor.isActive("superscript"),
    isDisabled: (editor) => !editor.can().toggleSuperscript(),
    run: (editor) => chain(editor).toggleSuperscript().run(),
  },
  outdent: {
    isActive: () => false,
    isDisabled: (editor) => !editor.can().liftListItem("listItem"),
    run: (editor) => chain(editor).liftListItem("listItem").run(),
  },
  indent: {
    isActive: () => false,
    isDisabled: (editor) => !editor.can().sinkListItem("listItem"),
    run: (editor) => chain(editor).sinkListItem("listItem").run(),
  },
  rtl: {
    isActive: (editor) => editor.isActive({ dir: "rtl" }),
    isDisabled: () => false,
    run: (editor) => {
      if (editor.isActive({ dir: "rtl" })) {
        chain(editor).unsetTextDirection().run();
      } else {
        chain(editor).setTextDirection("rtl").run();
      }
    },
  },
  clearFormatting: {
    isActive: () => false,
    isDisabled: () => false,
    run: (editor) => chain(editor).unsetAllMarks().clearNodes().run(),
  },
};
