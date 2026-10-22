import { load } from "cheerio";
import type { ParserDocument, ParserLimits } from "./parser.types";

/** Only processes fetched bytes. Cheerio parses inert markup and never fetches resources. */
export async function extractUrl(
  bytes: Buffer,
  limits: ParserLimits,
  filename: string,
): Promise<ParserDocument> {
  if (bytes.length > limits.expandedBytes) throw new Error("expansion_limit");
  const source = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  const html =
    /\.html?$/i.test(filename) ||
    /^\s*(?:<!doctype html|<html|<head|<body)/i.test(source);
  if (!html)
    return {
      blocks: source
        ? [
            {
              kind: "text",
              text: source,
              location: { lineStart: 1, lineEnd: source.split("\n").length },
            },
          ]
        : [],
      omissions: [],
      expandedBytes: bytes.length,
      empty: !source,
    };
  const $ = load(source);
  const omissions: ParserDocument["omissions"] = [];
  if ($("img,svg,canvas,video,audio,object,embed,iframe,picture").length > 0) {
    omissions.push({
      code: "missing_visual_evidence",
      detail:
        "Linked or embedded visual/media evidence is not fetched or rendered.",
    });
  }
  if (
    $("script").length > 0 ||
    $("[onclick],[onload],[data-reactroot]").length > 0
  ) {
    omissions.push({
      code: "unsupported_feature",
      detail:
        "Dynamic page behavior is not executed; rendered evidence may be missing.",
    });
  }
  if ($("link[rel=stylesheet],style").length > 0)
    omissions.push({
      code: "unsupported_feature",
      detail: "CSS layout and generated content are not rendered.",
    });
  $("script,style,template,noscript").remove();
  const text = $("body").text().trim();
  if (Buffer.byteLength(text) > limits.expandedBytes)
    throw new Error("expansion_limit");
  return {
    blocks: text
      ? [{ kind: "text", text, location: { section: "document-body" } }]
      : [],
    omissions,
    expandedBytes: Buffer.byteLength(text),
    empty: !text && omissions.length === 0,
  };
}
