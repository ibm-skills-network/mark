"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import type { FC } from "react";
import { CODE_BLOCK_LANGUAGES } from "@/lib/rich-text/lowlight";
import { insertImageFiles } from "@/lib/rich-text/insert-image-files";
import { toast } from "sonner";

import type { ToolbarMode } from "@/lib/rich-text/extensions";
import {
  TOOLBAR_CONTROLS,
  TOOLBAR_GROUPS_BY_MODE,
  type ToolbarItemId,
} from "@/lib/rich-text/toolbar-config";

import { ColorPopover, UrlPopover } from "./popovers";
import ToolbarButton from "./ToolbarButton";

// Fixed width and zero vertical padding keep the native select legible.
const SELECT_CLASS =
  "h-7 w-[7.5rem] shrink-0 rounded border border-gray-200 bg-transparent px-2 py-0 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300";

const Toolbar: FC<{
  editor: Editor;
  mode: ToolbarMode;
  blockImages?: boolean;
}> = ({ editor, mode, blockImages = false }) => {
  const groups = TOOLBAR_GROUPS_BY_MODE[mode].map((group) =>
    group.filter((id) => id !== "image" || !blockImages),
  );
  const visible = groups.flat();
  const language =
    (editor.getAttributes("codeBlock").language as string | null) ?? "";
  const languages = [
    ...new Set([...CODE_BLOCK_LANGUAGES, ...(language ? [language] : [])]),
  ];

  // Subscribe to displayed state rather than every keystroke.
  useEditorState({
    editor,
    selector: ({ editor: current }) =>
      `${current.isActive("codeBlock")}:${current.getAttributes("codeBlock").language ?? ""}|` +
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
            onFile={
              id === "image"
                ? (file) => {
                    void insertImageFiles(editor, [file]).catch(() =>
                      toast.error("Unable to read image"),
                    );
                  }
                : undefined
            }
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
      {mode === "full" && editor.isActive("codeBlock") ? (
        <select
          aria-label="Code language"
          className={SELECT_CLASS}
          value={language}
          onChange={(event) =>
            editor
              .chain()
              .focus()
              .updateAttributes("codeBlock", {
                language: event.target.value || null,
              })
              .run()
          }
        >
          <option value="">Plain</option>
          {languages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
};

export default Toolbar;
