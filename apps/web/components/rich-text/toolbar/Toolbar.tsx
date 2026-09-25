"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import type { FC } from "react";

import type { ToolbarMode } from "@/lib/rich-text/extensions";
import {
  TOOLBAR_CONTROLS,
  TOOLBAR_GROUPS_BY_MODE,
  type ToolbarItemId,
} from "@/lib/rich-text/toolbar-config";

import { ColorPopover, UrlPopover } from "./popovers";
import ToolbarButton from "./ToolbarButton";

/**
 * `shrink-0` and an explicit width because the toolbar is a wrapping flex row:
 * left to itself a native select is squeezed until its own label is clipped.
 *
 * `py-0` is load-bearing. A global form reset puts 8px of vertical padding on
 * `select`, which inside a 28px box leaves 10px of content for a 20px line and
 * crops the label's lower half — visible only at high resolution.
 */
const SELECT_CLASS =
  "h-7 w-[7.5rem] shrink-0 rounded border border-gray-200 bg-transparent px-2 py-0 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300";

/**
 * The editor's toolbar.
 *
 * Which controls exist, what they do and how they look are all one table in
 * `toolbar-config.ts`. This file only maps the four `kind`s onto components, so
 * adding a control never means editing this file.
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
  const visible = groups.flat();

  /**
   * Re-render the row only when something a control displays actually changes.
   *
   * The selector collapses every visible control's state into one string, which
   * `useEditorState` compares; the controls then read from `editor` directly at
   * render. Reading inline *without* this would re-render every button on every
   * keystroke, and holding a typed snapshot object instead only added a cast.
   */
  useEditorState({
    editor,
    selector: ({ editor: current }) =>
      visible
        .map((id) => {
          const control = TOOLBAR_CONTROLS[id];
          switch (control.kind) {
            case "button":
              return `${control.isActive(current)}:${control.isDisabled(current)}`;
            case "select":
              return control.value(current);
            case "color":
              return String(control.isActive(current));
            case "url":
              return `${control.isActive?.(current) ?? false}:${control.current?.(current) ?? ""}`;
          }
        })
        .join("|"),
  });

  const renderControl = (id: ToolbarItemId) => {
    const control = TOOLBAR_CONTROLS[id];

    switch (control.kind) {
      case "button":
        return (
          <ToolbarButton
            key={id}
            label={control.label}
            icon={control.icon}
            isActive={control.isActive(editor)}
            isDisabled={control.isDisabled(editor)}
            onClick={() => control.run(editor)}
          />
        );

      case "select":
        return (
          <select
            key={id}
            aria-label={control.label}
            title={control.label}
            className={SELECT_CLASS}
            value={control.value(editor)}
            onChange={(event) => control.set(editor, event.target.value)}
          >
            {control.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case "color":
        return (
          <ColorPopover
            key={id}
            label={control.label}
            icon={control.icon}
            isActive={control.isActive(editor)}
            clearLabel={control.clearLabel}
            onPick={(color) => control.apply(editor, color)}
            onClear={() => control.clear(editor)}
          />
        );

      case "url":
        return (
          <UrlPopover
            key={id}
            label={control.label}
            icon={control.icon}
            placeholder={control.placeholder}
            submitLabel={control.submitLabel}
            isActive={control.isActive?.(editor) ?? false}
            initialValue={control.current?.(editor) ?? ""}
            onSubmit={(url) => control.submit(editor, url)}
            onRemove={
              control.remove && control.isActive?.(editor)
                ? () => control.remove?.(editor)
                : undefined
            }
            removeLabel={control.removeLabel}
          />
        );
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
          {group.map((id) => renderControl(id))}
        </div>
      ))}
    </div>
  );
};

export default Toolbar;
