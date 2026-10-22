/** Shared inventory, not an extension-based permission to grade. Backend source
 * authorization, actual signature checks and evidence sufficiency remain required.
 * Canonical extraction is opt-in; legacy availability is retained during rollout.
 */
export type ArtifactEvidenceCapability = "text" | "visual" | "structured";
export type ArtifactFormat =
  | "pdf"
  | "spreadsheet"
  | "notebook"
  | "archive"
  | "image"
  | "presentation"
  | "url"
  | "document"
  | "text"
  | "repository";
export interface ArtifactFormatCapability {
  readonly format: ArtifactFormat;
  readonly extensions: readonly string[];
  readonly canonicalAccepted: boolean;
  readonly previewable: boolean;
  readonly extractable: boolean;
  readonly evidence: readonly ArtifactEvidenceCapability[];
  readonly gradeability: "requires-evidence-gate" | "unsupported";
  readonly parserDependency: string;
  readonly limitations: readonly string[];
}

// Canonical acceptance is deliberately disabled in the shared default inventory.
// An enabled, tested adapter is selected by the server's rollout policy. Clients
// must fetch that effective capability policy instead of enabling by extension.
export const artifactFormatCapabilities: readonly ArtifactFormatCapability[] = [
  {
    format: "pdf",
    extensions: [".pdf"],
    canonicalAccepted: false,
    previewable: true,
    extractable: false,
    evidence: ["text", "visual"],
    gradeability: "requires-evidence-gate",
    parserDependency: "pdfjs-dist",
    limitations: [
      "Text extraction cannot establish visual evidence completeness.",
    ],
  },
  {
    format: "spreadsheet",
    extensions: [".xlsx", ".xls", ".csv", ".ods"],
    canonicalAccepted: false,
    previewable: true,
    extractable: false,
    evidence: ["text", "structured", "visual"],
    gradeability: "requires-evidence-gate",
    parserDependency: "node-xlsx",
    limitations: [
      "Charts, formulas and sparse cell positions require explicit accounting.",
    ],
  },
  {
    format: "notebook",
    extensions: [".ipynb"],
    canonicalAccepted: false,
    previewable: true,
    extractable: false,
    evidence: ["text", "structured", "visual"],
    gradeability: "requires-evidence-gate",
    parserDependency: "JSON",
    limitations: [
      "Notebook code is never executed; outputs require separate accounting.",
    ],
  },
  {
    format: "archive",
    extensions: [".zip", ".tar", ".gz"],
    canonicalAccepted: false,
    previewable: false,
    extractable: false,
    evidence: ["text", "structured"],
    gradeability: "requires-evidence-gate",
    parserDependency: "bounded archive reader",
    limitations: [
      "Each archive variant needs a declared adapter; nested and binary members may be unsupported.",
    ],
  },
  {
    format: "image",
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff", ".svg"],
    canonicalAccepted: false,
    previewable: true,
    extractable: false,
    evidence: ["visual"],
    gradeability: "requires-evidence-gate",
    parserDependency: "sharp",
    limitations: [
      "Visual reference is not OCR or an interpretation of image contents.",
    ],
  },
  {
    format: "presentation",
    extensions: [".pptx", ".ppt", ".mp4", ".webm"],
    canonicalAccepted: false,
    previewable: true,
    extractable: false,
    evidence: ["text", "visual"],
    gradeability: "requires-evidence-gate",
    parserDependency: "bounded OOXML reader / media pipeline",
    limitations: [
      "Slide text does not cover layout, charts, speech or body language.",
    ],
  },
  {
    format: "url",
    extensions: [],
    canonicalAccepted: false,
    previewable: false,
    extractable: false,
    evidence: ["text", "visual"],
    gradeability: "requires-evidence-gate",
    parserDependency: "authorized bounded fetch",
    limitations: [
      "Remote fetch requires network authorization and original/resolved identity tracking.",
    ],
  },
  {
    format: "document",
    extensions: [".docx", ".doc", ".odt", ".rtf"],
    canonicalAccepted: false,
    previewable: true,
    extractable: false,
    evidence: ["text", "visual"],
    gradeability: "requires-evidence-gate",
    parserDependency: "mammoth / format-specific adapter",
    limitations: [
      "Text extraction cannot prove image, equation or layout completeness.",
    ],
  },
  {
    format: "text",
    extensions: [
      ".txt",
      ".md",
      ".json",
      ".py",
      ".js",
      ".ts",
      ".java",
      ".c",
      ".cpp",
      ".html",
      ".css",
    ],
    canonicalAccepted: false,
    previewable: true,
    extractable: false,
    evidence: ["text"],
    gradeability: "requires-evidence-gate",
    parserDependency: "strict UTF-8 decoder",
    limitations: ["Code is retained as source and never executed."],
  },
  {
    format: "repository",
    extensions: [],
    canonicalAccepted: false,
    previewable: false,
    extractable: false,
    evidence: ["text", "structured"],
    gradeability: "requires-evidence-gate",
    parserDependency: "authorized repository resolver",
    limitations: ["A URL alone is not an immutable repository snapshot."],
  },
];
