import type { Extensions } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Image } from "@tiptap/extension-image";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import {
  BackgroundColor,
  Color,
  TextStyle,
} from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { StarterKit } from "@tiptap/starter-kit";

import {
  RichTextLimits,
  type RichTextCounts,
} from "./extensions/rich-text-limits";
import { TextDirection } from "./extensions/text-direction";
import { Video } from "./extensions/video";
import { lowlight } from "./lowlight";

export type ToolbarMode = "full" | "learner";

export interface RichTextExtensionOptions {
  mode: ToolbarMode;
  placeholder: string;
  maxWords?: number | null;
  maxCharacters?: number | null;
  onCount?: (counts: RichTextCounts) => void;
}

export function createRichTextExtensions({
  mode,
  placeholder,
  maxWords,
  maxCharacters,
  onCount,
}: RichTextExtensionOptions): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      // Replaced below by the highlighting variant. Leaving both registered
      // gives two nodes claiming the same name and a schema that will not build.
      codeBlock: false,
      // Off by default this appends an empty paragraph to every document, so
      // merely loading stored content would make it differ from what is saved
      // and mark untouched fields as edited.
      trailingNode: false,
      // Bundled here, so it must be configured through the kit rather than
      // registered separately.
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      },
    }),

    CodeBlockLowlight.configure({
      lowlight,
      // `null` rather than "plain": an unregistered language name is written
      // back into storage as a meaningless class and warns at render time.
      defaultLanguage: null,
    }),

    // Colour arrives as `style="color: …"` on a span. `Highlight` would not
    // do — it reads and writes `<mark>`, which stored content never contains.
    TextStyle,
    Color,
    BackgroundColor,

    TextAlign.configure({
      types: ["heading", "paragraph"],
      alignments: ["left", "center", "right", "justify"],
    }),

    Subscript,
    Superscript,

    // Pasted images were stored inline as data URIs. Without this they are
    // dropped on load, silently.
    Image.configure({ allowBase64: true }),

    TableKit.configure({ table: { resizable: mode === "full" } }),

    Video,
    TextDirection,
    Placeholder.configure({ placeholder }),
  ];

  if ((maxWords && maxWords > 0) || (maxCharacters && maxCharacters > 0)) {
    extensions.push(
      RichTextLimits.configure({ maxWords, maxCharacters, onCount }),
    );
  }

  return extensions;
}
