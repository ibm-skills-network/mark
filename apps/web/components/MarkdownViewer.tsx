"use client";

/**
 * Kept as the public path for the read-only renderer so the ~15 call sites do
 * not have to change. The implementation lives in components/rich-text.
 */
export { default } from "./rich-text/RichTextViewer";
export type { RichTextViewerProps as MarkdownViewerProps } from "./rich-text/RichTextViewer";
