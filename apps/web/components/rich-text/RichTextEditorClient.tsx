"use client";

import dynamic from "next/dynamic";
import type { RichTextEditorProps } from "./RichTextEditor";

// HTML preparation requires a DOM.
const RichTextEditorClient = dynamic<RichTextEditorProps>(
  () => import("./RichTextEditor"),
  {
    ssr: false,

    loading: () => (
      <div className="flex flex-col">
        <div className="min-h-[100px] rounded border border-gray-200 p-2 dark:border-gray-600" />
      </div>
    ),
  },
);

export default RichTextEditorClient;
