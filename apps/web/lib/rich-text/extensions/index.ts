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

import { RichTextLimits, type RichTextCounts } from "./rich-text-limits";
import { BlockFormatting } from "./block-formatting";
import { ImagePolicy, type ImagePolicyOptions } from "./image-policy";
import { Video } from "./video";
import { lowlight } from "../lowlight";

export type ToolbarMode = "full" | "learner";

export interface RichTextExtensionOptions {
  mode: ToolbarMode;
  placeholder: string;
  maxWords?: number | null;
  maxCharacters?: number | null;
  onCount?: (counts: RichTextCounts) => void;
  getLimits?: () => { maxWords?: number | null; maxCharacters?: number | null };
  getImagePolicy?: ImagePolicyOptions["getImagePolicy"];
}

export function createRichTextExtensions({
  mode,
  placeholder,
  maxWords,
  maxCharacters,
  onCount,
  getLimits,
  getImagePolicy,
}: RichTextExtensionOptions): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      codeBlock: false,

      trailingNode: false,

      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      },
    }),

    CodeBlockLowlight.configure({
      lowlight,

      defaultLanguage: null,
    }),

    TextStyle,
    Color,
    BackgroundColor,

    TextAlign.configure({
      types: ["heading", "paragraph", "listItem", "blockquote", "codeBlock"],
      alignments: ["left", "center", "right", "justify"],
    }),

    Subscript,
    Superscript,

    Image.configure({ allowBase64: true, inline: true }),
    ImagePolicy.configure({ getImagePolicy }),

    TableKit.configure({ table: { resizable: mode === "full" } }),

    Video,
    BlockFormatting,
    Placeholder.configure({ placeholder }),
  ];

  extensions.push(
    RichTextLimits.configure({ maxWords, maxCharacters, onCount, getLimits }),
  );

  return extensions;
}
