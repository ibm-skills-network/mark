export interface ParserLimits {
  inputBytes: number;
  expandedBytes: number;
  outputBytes: number;
  pages: number;
  timeoutMs: number;
  heapMb: number;
  rssMb: number;
}
export interface ParserLocation {
  page?: number;
  sheet?: string;
  cell?: string;
  slide?: number;
  notebookCell?: number;
  archivePath?: string;
  lineStart?: number;
  lineEnd?: number;
  section?: string;
  url?: string;
}
export interface ParserDocument {
  blocks: {
    kind: "text" | "code" | "table" | "image" | "chart" | "audio" | "video";
    text?: string;
    resourceRef?: string;
    location: ParserLocation;
  }[];
  omissions: {
    code:
      | "missing_visual_evidence"
      | "unsupported_feature"
      | "truncated_input"
      | "truncated_output"
      | "expansion_limit"
      | "missing_content"
      | "parser_warning";
    location?: ParserLocation;
    detail?: string;
  }[];
  expandedBytes: number;
  resources?: { id: string; mediaType: string; base64: string }[];
  empty?: boolean;
}
