import type { Editor } from "@tiptap/core";
import {
  ArrowLeftRight,
  Baseline,
  Bold,
  Code2,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  Outdent,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Video,
  type LucideIcon,
} from "lucide-react";

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

export type ToolbarControl =
  | {
      kind: "button";
      label: string;
      icon: LucideIcon;
      isActive: (editor: Editor) => boolean;
      isDisabled: (editor: Editor) => boolean;
      run: (editor: Editor) => void;
    }
  | {
      kind: "select";
      label: string;

      options: readonly { value: string; label: string }[];
      value: (editor: Editor) => string;
      set: (editor: Editor, value: string) => void;
    }
  | {
      kind: "color";
      label: string;
      icon: LucideIcon;
      isActive: (editor: Editor) => boolean;
      apply: (editor: Editor, color: string) => void;
      clear: (editor: Editor) => void;
      clearLabel: string;
    }
  | {
      kind: "url";
      label: string;
      icon: LucideIcon;
      placeholder: string;
      submitLabel: string;
      isActive?: (editor: Editor) => boolean;

      current?: (editor: Editor) => string;
      submit: (editor: Editor, url: string) => void;
      remove?: (editor: Editor) => void;
      removeLabel?: string;
    };

const chain = (editor: Editor) => editor.chain().focus();

type ToggleCommand =
  | "toggleBold"
  | "toggleItalic"
  | "toggleUnderline"
  | "toggleStrike"
  | "toggleBlockquote"
  | "toggleCodeBlock"
  | "toggleOrderedList"
  | "toggleBulletList"
  | "toggleSubscript"
  | "toggleSuperscript";

const toggle = (
  label: string,
  icon: LucideIcon,
  name: string,
  command: ToggleCommand,
): ToolbarControl => ({
  kind: "button",
  label,
  icon,
  isActive: (editor) => editor.isActive(name),
  isDisabled: (editor) => !editor.can()[command](),
  run: (editor) => chain(editor)[command]().run(),
});

export const TOOLBAR_CONTROLS: Record<ToolbarItemId, ToolbarControl> = {
  bold: toggle("Bold", Bold, "bold", "toggleBold"),
  italic: toggle("Italic", Italic, "italic", "toggleItalic"),
  underline: toggle("Underline", Underline, "underline", "toggleUnderline"),
  strike: toggle("Strikethrough", Strikethrough, "strike", "toggleStrike"),
  blockquote: toggle("Blockquote", Quote, "blockquote", "toggleBlockquote"),
  codeBlock: toggle("Code block", Code2, "codeBlock", "toggleCodeBlock"),
  orderedList: toggle(
    "Numbered list",
    ListOrdered,
    "orderedList",
    "toggleOrderedList",
  ),
  bulletList: toggle("Bulleted list", List, "bulletList", "toggleBulletList"),
  subscript: toggle("Subscript", Subscript, "subscript", "toggleSubscript"),
  superscript: toggle(
    "Superscript",
    Superscript,
    "superscript",
    "toggleSuperscript",
  ),

  outdent: {
    kind: "button",
    label: "Decrease indent",
    icon: Outdent,
    isActive: () => false,
    isDisabled: (editor) =>
      !editor.can().decreaseIndent() && !editor.can().liftListItem("listItem"),
    run: (editor) => {
      if (editor.can().decreaseIndent()) chain(editor).decreaseIndent().run();
      else chain(editor).liftListItem("listItem").run();
    },
  },
  indent: {
    kind: "button",
    label: "Increase indent",
    icon: Indent,
    isActive: () => false,
    isDisabled: (editor) =>
      !editor.can().sinkListItem("listItem") && !editor.can().increaseIndent(),
    run: (editor) => {
      if (editor.can().sinkListItem("listItem"))
        chain(editor).sinkListItem("listItem").run();
      else chain(editor).increaseIndent().run();
    },
  },

  rtl: {
    kind: "button",
    label: "Right to left",
    icon: ArrowLeftRight,
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
    kind: "button",
    label: "Clear formatting",
    icon: RemoveFormatting,
    isActive: () => false,
    isDisabled: () => false,
    run: (editor) => chain(editor).unsetAllMarks().clearNodes().run(),
  },

  heading: {
    kind: "select",
    label: "Paragraph style",
    options: [
      { value: "p", label: "Normal" },
      ...HEADING_LEVELS.map((level) => ({
        value: String(level),
        label: `Heading ${level}`,
      })),
    ],
    value: (editor) => {
      const level = HEADING_LEVELS.find((candidate) =>
        editor.isActive("heading", { level: candidate }),
      );
      return level ? String(level) : "p";
    },
    set: (editor, value) => {
      if (value === "p") {
        chain(editor).setParagraph().run();
        return;
      }
      chain(editor)
        .setHeading({ level: Number(value) as (typeof HEADING_LEVELS)[number] })
        .run();
    },
  },

  align: {
    kind: "select",
    label: "Text alignment",
    options: TEXT_ALIGNMENTS.map((alignment) => ({
      value: alignment,
      label: alignment[0].toUpperCase() + alignment.slice(1),
    })),
    value: (editor) =>
      TEXT_ALIGNMENTS.find((alignment) =>
        editor.isActive({ textAlign: alignment }),
      ) ?? "left",
    set: (editor, value) => chain(editor).setTextAlign(value).run(),
  },

  color: {
    kind: "color",
    label: "Text colour",
    icon: Baseline,
    isActive: (editor) => Boolean(editor.getAttributes("textStyle").color),
    apply: (editor, color) => chain(editor).setColor(color).run(),
    clear: (editor) => chain(editor).unsetColor().run(),
    clearLabel: "Remove colour",
  },
  backgroundColor: {
    kind: "color",
    label: "Background colour",
    icon: Highlighter,
    isActive: (editor) =>
      Boolean(editor.getAttributes("textStyle").backgroundColor),
    apply: (editor, color) => chain(editor).setBackgroundColor(color).run(),
    clear: (editor) => chain(editor).unsetBackgroundColor().run(),
    clearLabel: "Remove background",
  },

  link: {
    kind: "url",
    label: "Link",
    icon: Link2,
    placeholder: "https://example.com",
    submitLabel: "Apply",
    isActive: (editor) => editor.isActive("link"),
    current: (editor) => (editor.getAttributes("link").href as string) ?? "",
    submit: (editor, url) =>
      chain(editor).extendMarkRange("link").setLink({ href: url }).run(),
    remove: (editor) => chain(editor).extendMarkRange("link").unsetLink().run(),
    removeLabel: "Remove link",
  },
  image: {
    kind: "url",
    label: "Image",
    icon: ImageIcon,
    placeholder: "https://example.com/image.png",
    submitLabel: "Insert",
    submit: (editor, url) => chain(editor).setImage({ src: url }).run(),
  },
  video: {
    kind: "url",
    label: "Video",
    icon: Video,
    placeholder: "https://www.youtube.com/embed/...",
    submitLabel: "Insert",
    submit: (editor, url) => chain(editor).setVideo({ src: url }).run(),
  },
};
