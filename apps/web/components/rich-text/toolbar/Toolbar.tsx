"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  ArrowLeftRight,
  Bold,
  Code2,
  Indent,
  Italic,
  List,
  ListOrdered,
  Outdent,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";
import type { FC, ReactNode } from "react";

import type { ToolbarMode } from "@/lib/rich-text/extensions";
import {
  HEADING_LEVELS,
  TEXT_ALIGNMENTS,
  TOOLBAR_ACTIONS,
  TOOLBAR_GROUPS_BY_MODE,
  type ToolbarItemId,
} from "@/lib/rich-text/toolbar-config";

import {
  ColorPopover,
  ImagePopover,
  LinkPopover,
  VideoPopover,
} from "./popovers";
import ToolbarButton from "./ToolbarButton";

/** Icon and accessible name for every control driven by `TOOLBAR_ACTIONS`. */
const BUTTON_PRESENTATION: Record<
  keyof typeof TOOLBAR_ACTIONS,
  { label: string; icon: ReactNode }
> = {
  bold: { label: "Bold", icon: <Bold className="h-4 w-4" aria-hidden /> },
  italic: { label: "Italic", icon: <Italic className="h-4 w-4" aria-hidden /> },
  underline: {
    label: "Underline",
    icon: <Underline className="h-4 w-4" aria-hidden />,
  },
  strike: {
    label: "Strikethrough",
    icon: <Strikethrough className="h-4 w-4" aria-hidden />,
  },
  blockquote: {
    label: "Blockquote",
    icon: <Quote className="h-4 w-4" aria-hidden />,
  },
  codeBlock: {
    label: "Code block",
    icon: <Code2 className="h-4 w-4" aria-hidden />,
  },
  orderedList: {
    label: "Numbered list",
    icon: <ListOrdered className="h-4 w-4" aria-hidden />,
  },
  bulletList: {
    label: "Bulleted list",
    icon: <List className="h-4 w-4" aria-hidden />,
  },
  subscript: {
    label: "Subscript",
    icon: <Subscript className="h-4 w-4" aria-hidden />,
  },
  superscript: {
    label: "Superscript",
    icon: <Superscript className="h-4 w-4" aria-hidden />,
  },
  outdent: {
    label: "Decrease indent",
    icon: <Outdent className="h-4 w-4" aria-hidden />,
  },
  indent: {
    label: "Increase indent",
    icon: <Indent className="h-4 w-4" aria-hidden />,
  },
  rtl: {
    label: "Right to left",
    icon: <ArrowLeftRight className="h-4 w-4" aria-hidden />,
  },
  clearFormatting: {
    label: "Clear formatting",
    icon: <RemoveFormatting className="h-4 w-4" aria-hidden />,
  },
};

/**
 * `shrink-0` and an explicit width because the toolbar is a wrapping flex row:
 * left to itself a native select is squeezed until its own label is clipped.
 *
 * `py-0` is load-bearing. A global form reset puts 8px of vertical padding on
 * `select`, which inside a 28px box leaves 10px of content for a 20px line and
 * crops the label's lower half — visible only at high resolution.
 */
const SELECT_CLASS =
  "h-7 shrink-0 rounded border border-gray-200 bg-transparent px-2 py-0 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300";

/**
 * The editor's toolbar.
 *
 * Which controls appear, and in which groups, is data in `toolbar-config.ts`
 * rather than markup here, so the set is comparable with the previous editor's
 * at a glance and a test can assert it. This file supplies only presentation.
 *
 * Every control's pressed and disabled state comes from a single
 * `useEditorState` selector. Reading `editor.isActive(...)` inline instead
 * would re-render the whole row on each keystroke, for each button.
 */
const Toolbar: FC<{ editor: Editor; mode: ToolbarMode }> = ({
  editor,
  mode,
}) => {
  const groups = TOOLBAR_GROUPS_BY_MODE[mode];

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      actions: Object.fromEntries(
        Object.entries(TOOLBAR_ACTIONS).map(([id, action]) => [
          id,
          {
            isActive: action.isActive(current),
            isDisabled: action.isDisabled(current),
          },
        ]),
      ) as Record<
        keyof typeof TOOLBAR_ACTIONS,
        { isActive: boolean; isDisabled: boolean }
      >,
      headingLevel:
        HEADING_LEVELS.find((level) =>
          current.isActive("heading", { level }),
        ) ?? null,
      alignment:
        TEXT_ALIGNMENTS.find((alignment) =>
          current.isActive({ textAlign: alignment }),
        ) ?? null,
      isLinkActive: current.isActive("link"),
      isColorActive: Boolean(current.getAttributes("textStyle").color),
      isBackgroundActive: Boolean(
        current.getAttributes("textStyle").backgroundColor,
      ),
    }),
  });

  const renderItem = (id: ToolbarItemId) => {
    switch (id) {
      case "heading": {
        return (
          <select
            key={id}
            aria-label="Paragraph style"
            title="Paragraph style"
            className={`${SELECT_CLASS} w-[7.5rem]`}
            value={state.headingLevel ? String(state.headingLevel) : "p"}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "p") {
                editor.chain().focus().setParagraph().run();
                return;
              }
              editor
                .chain()
                .focus()
                .setHeading({
                  level: Number(next) as (typeof HEADING_LEVELS)[number],
                })
                .run();
            }}
          >
            <option value="p">Normal</option>
            {HEADING_LEVELS.map((level) => (
              <option key={level} value={level}>
                Heading {level}
              </option>
            ))}
          </select>
        );
      }

      case "align": {
        return (
          <select
            key={id}
            aria-label="Text alignment"
            title="Text alignment"
            className={`${SELECT_CLASS} w-[6rem]`}
            value={state.alignment ?? "left"}
            onChange={(event) =>
              editor.chain().focus().setTextAlign(event.target.value).run()
            }
          >
            {TEXT_ALIGNMENTS.map((alignment) => (
              <option key={alignment} value={alignment}>
                {alignment[0].toUpperCase() + alignment.slice(1)}
              </option>
            ))}
          </select>
        );
      }

      case "color":
        return (
          <ColorPopover
            key={id}
            editor={editor}
            kind="color"
            isActive={state.isColorActive}
          />
        );

      case "backgroundColor":
        return (
          <ColorPopover
            key={id}
            editor={editor}
            kind="backgroundColor"
            isActive={state.isBackgroundActive}
          />
        );

      case "link":
        return (
          <LinkPopover key={id} editor={editor} isActive={state.isLinkActive} />
        );

      case "image":
        return <ImagePopover key={id} editor={editor} />;

      case "video":
        return <VideoPopover key={id} editor={editor} />;

      default: {
        const action = TOOLBAR_ACTIONS[id];
        const presentation = BUTTON_PRESENTATION[id];
        const itemState = state.actions[id];

        return (
          <ToolbarButton
            key={id}
            label={presentation.label}
            isActive={itemState.isActive}
            isDisabled={itemState.isDisabled}
            onClick={() => action.run(editor)}
          >
            {presentation.icon}
          </ToolbarButton>
        );
      }
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="rich-text-toolbar mb-1 flex flex-wrap items-center gap-1 rounded border border-gray-200 p-1 dark:border-gray-600"
    >
      {groups.map((group, index) => (
        <div
          key={group.join("-")}
          className={`flex items-center gap-1 ${
            index < groups.length - 1
              ? "border-r border-gray-200 pr-1 dark:border-gray-600"
              : ""
          }`}
        >
          {group.map((id) => renderItem(id))}
        </div>
      ))}
    </div>
  );
};

export default Toolbar;
