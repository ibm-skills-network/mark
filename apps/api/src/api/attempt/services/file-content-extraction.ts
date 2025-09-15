/* eslint-disable */
import * as crypto from "crypto";
import { Readable } from "node:stream";
import * as path from "path";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import csv from "csv-parser";
import * as mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { S3Service } from "src/api/files/services/s3.service";
import * as unzipper from "unzipper";
import * as XLSX from "xlsx";
import { parseStringPromise } from "xml2js";
import { LearnerFileUpload } from "../common/interfaces/attempt.interface";

export interface ExtractedFileContent {
  filename: string;
  content: string;
  fileType: string;
  extractedText?: string;
  metadata?: {
    size: number;
    encoding?: string;
    language?: string;
    pageCount?: number;
    slideCount?: number;
    hasNotes?: boolean;
    cellCount?: number;
    outputCount?: number;
    fileCount?: number;
    mimeType?: string;
    hash?: string;
  };
}

interface PDFData {
  numpages: number;
  text: string;
  version: string;
  info: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface XMLNode {
  [key: string]: unknown;
  "a:t"?: string | string[] | XMLNode | XMLNode[];
}

interface JupyterNotebook {
  cells: JupyterCell[];
  metadata?: {
    kernelspec?: {
      name: string;
      display_name: string;
    };
    language_info?: {
      name: string;
      version?: string;
      codemirror_mode?: string | Record<string, unknown>;
      file_extension?: string;
      mimetype?: string;
      pygments_lexer?: string;
      nbconvert_exporter?: string;
    };
  };
  nbformat?: number;
  nbformat_minor?: number;
}

interface JupyterCell {
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  outputs?: JupyterOutput[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
}

interface JupyterOutput {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  name?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  execution_count?: number;
}

@Injectable()
export class FileContentExtractionService {
  private readonly logger = new Logger(FileContentExtractionService.name);
  private readonly MAX_CONTENT_LENGTH = 500_000;
  private readonly CHUNK_SIZE = 10_000;
  private readonly BINARY_SAMPLE_SIZE = 5000;

  private readonly mimeTypeMap: Record<string, string[]> = {
    "text/plain": ["txt", "log", "md", "markdown", "rst", "asc", "text"],
    "application/json": ["json", "jsonl", "geojson", "topojson"],
    "application/xml": ["xml", "xsl", "xsd", "svg", "rss", "atom", "plist"],
    "text/html": ["html", "htm", "xhtml", "shtml"],
    "text/css": ["css", "scss", "sass", "less"],
    "application/javascript": ["js", "mjs", "jsx", "ts", "tsx"],
    "application/pdf": ["pdf"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      "docx",
    ],
    "application/msword": ["doc"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
      "xlsx",
    ],
    "application/vnd.ms-excel": ["xls"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ["pptx"],
    "application/vnd.ms-powerpoint": ["ppt"],
    "text/csv": ["csv", "tsv"],
    "application/zip": ["zip", "zipx"],
    "application/x-tar": ["tar"],
    "application/gzip": ["gz", "gzip"],
    "application/x-7z-compressed": ["7z"],
    "application/x-rar-compressed": ["rar"],
    "image/jpeg": ["jpg", "jpeg", "jpe"],
    "image/png": ["png"],
    "image/gif": ["gif"],
    "image/bmp": ["bmp"],
    "image/webp": ["webp"],
    "image/svg+xml": ["svg"],
    "audio/mpeg": ["mp3"],
    "audio/wav": ["wav"],
    "video/mp4": ["mp4", "m4v"],
    "video/mpeg": ["mpeg", "mpg"],
    "application/x-sqlite3": ["db", "sqlite", "sqlite3"],
    "application/x-ipynb+json": ["ipynb"],
  };

  constructor(private readonly s3Service: S3Service) {}

  async extractContentFromFiles(
    learnerFiles: LearnerFileUpload[],
  ): Promise<ExtractedFileContent[]> {
    this.logger.debug(`Starting extraction for ${learnerFiles.length} files`);

    const extractedFiles = await Promise.all(
      learnerFiles.map(async (file) => {
        try {
          this.logger.debug(
            `Processing file: ${file.filename} (${file.fileType})`,
          );
          const startTime = Date.now();

          const result = await this.extractSingleFileContent(file);

          const duration = Date.now() - startTime;
          this.logger.debug(
            `Extracted ${file.filename} in ${duration}ms, ` +
              `content length: ${result.content.length} chars`,
          );

          return result;
        } catch (error) {
          this.logger.error(
            `Failed to extract content from ${file.filename}:`,
            error,
          );

          return {
            filename: file.filename,
            content:
              `[ERROR extracting ${file.filename}: ${
                error instanceof Error ? error.message : "Unknown error"
              }]\n` +
              `File type: ${file.fileType}\n` +
              `This file could not be processed, but it exists in the submission.`,
            fileType: file.fileType,
            metadata: { size: 0 },
          };
        }
      }),
    );

    this.logger.debug(
      `Extraction complete. Successfully processed ${extractedFiles.length} files`,
    );
    return extractedFiles;
  }

  private async extractSingleFileContent(
    file: LearnerFileUpload,
  ): Promise<ExtractedFileContent> {
    if (
      file.content &&
      file.content !== "InCos" &&
      file.content.trim().length > 0
    ) {
      this.logger.debug(`Using existing content for ${file.filename}`);
      return {
        filename: file.filename,
        content: this.sanitizeAndTruncate(file.content),
        fileType: file.fileType,
        metadata: {
          size: file.content.length,
          mimeType: file.fileType,
        },
      };
    }

    const fileContent = await this.downloadFileFromCOS(file.bucket, file.key);
    this.logger.debug(
      `Downloaded ${file.filename}: ${fileContent.length} bytes`,
    );

    const hash = crypto
      .createHash("sha256")
      .update(fileContent)
      .digest("hex")
      .substring(0, 16);

    const extractedContent = await this.extractTextFromBuffer(
      fileContent,
      file.filename,
      file.fileType,
    );

    return {
      filename: file.filename,
      content: this.sanitizeAndTruncate(extractedContent.text),
      fileType: file.fileType,
      extractedText: extractedContent.extractedText,
      metadata: {
        size: fileContent.length,
        encoding: extractedContent.encoding,
        language: extractedContent.detectedLanguage,
        mimeType: file.fileType,
        hash: hash,
        ...extractedContent.additionalMetadata,
      },
    };
  }

  private async downloadFileFromCOS(
    bucket: string,
    key: string,
  ): Promise<Buffer> {
    try {
      this.logger.debug(`Downloading from COS: ${bucket}/${key}`);

      const result = await this.s3Service.getObject({
        Bucket: bucket,
        Key: key,
      });

      if (result.Body instanceof Buffer) {
        return result.Body;
      } else if (result.Body) {
        const chunks: Uint8Array[] = [];
        const stream = result.Body as NodeJS.ReadableStream;

        return new Promise((resolve, reject) => {
          stream.on("data", (chunk) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          stream.on("end", () => resolve(Buffer.concat(chunks)));
          stream.on("error", reject);
        });
      } else {
        throw new Error("No file content received from COS");
      }
    } catch (error) {
      this.logger.error(
        `Failed to download file from COS: ${bucket}/${key}`,
        error,
      );
      throw new BadRequestException(`Could not retrieve file: ${key}`);
    }
  }

  private async extractTextFromBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<{
    text: string;
    extractedText?: string;
    encoding?: string;
    detectedLanguage?: string;
    additionalMetadata?: Record<string, number | boolean>;
  }> {
    const fileExtension = filename.split(".").pop()?.toLowerCase() || "";
    this.logger.debug(
      `Extracting from ${filename} (type: ${mimeType}, ext: ${fileExtension}, size: ${buffer.length})`,
    );

    try {
      const result = await this.extractByExtension(
        buffer,
        filename,
        fileExtension,
      );
      if (result) return result;

      const mimeResult = await this.extractByMimeType(
        buffer,
        filename,
        mimeType,
      );
      if (mimeResult) return mimeResult;

      return await this.extractWithFallback(buffer, filename);
    } catch (error) {
      this.logger.warn(`Primary extraction failed for ${filename}:`, error);
      return await this.extractWithFallback(buffer, filename);
    }
  }

  private async extractByExtension(
    buffer: Buffer,
    filename: string,
    extension: string,
  ): Promise<{
    text: string;
    extractedText?: string;
    encoding?: string;
    additionalMetadata?: Record<string, number | boolean>;
  } | null> {
    switch (extension) {
      case "ipynb":
        return await this.extractJupyterNotebook(buffer, filename);

      case "pdf":
        return await this.extractPDFText(buffer);
      case "docx":
        return await this.extractWordText(buffer);
      case "doc":
        return await this.extractLegacyWordText(buffer);
      case "odt":
        return await this.extractODTText(buffer);
      case "rtf":
        return await this.extractRTFText(buffer);

      case "xlsx":
      case "xls":
        return await this.extractExcelText(buffer);
      case "csv":
      case "tsv":
        return await this.extractCSVText(
          buffer,
          extension === "tsv" ? "\t" : ",",
        );
      case "ods":
        return await this.extractODSText(buffer);

      case "pptx":
        return await this.extractPowerPointText(buffer);
      case "ppt":
        return await this.extractLegacyPowerPointText(buffer);
      case "odp":
        return await this.extractODPText(buffer);

      case "zip":
      case "zipx":
        return await this.extractArchiveContent(buffer, filename, "zip");
      case "tar":
      case "gz":
      case "tgz":
        return await this.extractArchiveContent(buffer, filename, "tar");
      case "7z":
        return await this.extractArchiveContent(buffer, filename, "7z");
      case "rar":
        return await this.extractArchiveContent(buffer, filename, "rar");

      case "json":
      case "jsonl":
      case "geojson":
        return await this.extractJSONContent(buffer);
      case "xml":
      case "svg":
      case "plist":
        return await this.extractXMLContent(buffer);
      case "yaml":
      case "yml":
        return await this.extractYAMLContent(buffer);
      case "toml":
        return await this.extractTOMLContent(buffer);
      case "ini":
      case "cfg":
      case "conf":
        return await this.extractConfigContent(buffer);

      case "sql":
        return this.extractPlainText(buffer);
      case "db":
      case "sqlite":
      case "sqlite3":
        return await this.extractSQLiteContent(buffer, filename);

      case "log":
      case "out":
      case "err":
        return await this.extractLogContent(buffer);

      case "js":
      case "jsx":
      case "ts":
      case "tsx":
      case "mjs":
      case "cjs":
      case "py":
      case "pyw":
      case "pyi":
      case "java":
      case "class":
      case "jar":
      case "cpp":
      case "cc":
      case "cxx":
      case "c":
      case "h":
      case "hpp":
      case "cs":
      case "vb":
      case "php":
      case "rb":
      case "go":
      case "rs":
      case "swift":
      case "kt":
      case "kts":
      case "scala":
      case "clj":
      case "cljs":
      case "dart":
      case "lua":
      case "r":
      case "R":
      case "m":
      case "mm":
      case "pl":
      case "pm":
      case "sh":
      case "bash":
      case "zsh":
      case "fish":
      case "ps1":
      case "psm1":
      case "bat":
      case "cmd":
      case "asm":
      case "s":
      case "f":
      case "f90":
      case "f95":
      case "pas":
      case "pp":
      case "elm":
      case "ex":
      case "exs":
      case "erl":
      case "hrl":
      case "nim":
      case "v":
      case "zig":
      case "jl":
      case "coffee":
      case "ls":
        return await this.extractSourceCode(buffer, extension);

      case "html":
      case "htm":
      case "xhtml":
      case "shtml":
        return await this.extractHTMLContent(buffer);
      case "css":
      case "scss":
      case "sass":
      case "less":
      case "styl":
        return this.extractPlainText(buffer);
      case "vue":
      case "svelte":
        return await this.extractComponentFile(buffer, extension);

      case "txt":
      case "md":
      case "markdown":
      case "rst":
      case "asciidoc":
      case "adoc":
      case "tex":
      case "latex":
        return this.extractPlainText(buffer);

      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "bmp":
      case "tiff":
      case "webp":
      case "ico":
      case "heic":
      case "heif":
        return await this.extractImageMetadata(buffer, filename);

      case "mp3":
      case "wav":
      case "flac":
      case "ogg":
      case "m4a":
      case "mp4":
      case "avi":
      case "mov":
      case "wmv":
      case "flv":
      case "mkv":
      case "webm":
        return await this.extractMediaMetadata(buffer, filename);

      case "eml":
        return await this.extractEmailContent(buffer);
      case "msg":
        return await this.extractOutlookMessage(buffer);
      case "ics":
      case "vcs":
        return await this.extractCalendarContent(buffer);
      case "vcf":
        return await this.extractVCardContent(buffer);

      default:
        return null;
    }
  }

  private async extractByMimeType(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<{
    text: string;
    extractedText?: string;
    encoding?: string;
    additionalMetadata?: Record<string, number | boolean>;
  } | null> {
    for (const [mime, extensions] of Object.entries(this.mimeTypeMap)) {
      if (mimeType.includes(mime)) {
        const result = await this.extractByExtension(
          buffer,
          filename,
          extensions[0],
        );
        if (result) return result;
      }
    }

    if (mimeType.startsWith("text/")) {
      return this.extractPlainText(buffer);
    }

    if (mimeType.includes("json")) {
      return await this.extractJSONContent(buffer);
    }

    if (mimeType.includes("xml")) {
      return await this.extractXMLContent(buffer);
    }

    return null;
  }

  private async extractWithFallback(
    buffer: Buffer,
    filename: string,
  ): Promise<{
    text: string;
    extractedText?: string;
    encoding?: string;
    additionalMetadata?: Record<string, number | boolean>;
  }> {
    this.logger.debug(`Using fallback extraction for ${filename}`);

    const strategies = [
      async () => {
        try {
          const jsonContent = JSON.parse(buffer.toString("utf8"));
          return {
            text: JSON.stringify(jsonContent, null, 2),
            encoding: "utf8",
            extractedText: "Detected as JSON",
          };
        } catch {
          return null;
        }
      },

      async () => {
        try {
          const xmlString = buffer.toString("utf8");
          if (xmlString.includes("<?xml") || xmlString.includes("<html")) {
            const parsed = await parseStringPromise(xmlString);
            return {
              text: JSON.stringify(parsed, null, 2),
              encoding: "utf8",
              extractedText: "Detected as XML/HTML",
            };
          }
        } catch {
          return null;
        }
      },

      async () => {
        const result = this.extractPlainText(buffer);
        if (result.text && !result.text.includes("[BINARY")) {
          return result;
        }
        return null;
      },

      async () => {
        const strings = this.extractStringsFromBinary(buffer);
        if (strings.length > 0) {
          return {
            text: `[BINARY FILE: ${filename}]\nExtracted strings:\n${strings.join(
              "\n",
            )}`,
            encoding: "binary",
            extractedText: `Found ${strings.length} text strings`,
          };
        }
        return null;
      },

      async () => {
        const analysis = this.analyzeBinaryStructure(buffer);
        return {
          text: `[BINARY FILE: ${filename}]\n${analysis}`,
          encoding: "binary",
          extractedText: "Binary structure analysis",
        };
      },
    ];

    for (const strategy of strategies) {
      const result = await strategy();
      if (result) {
        return result;
      }
    }

    return {
      text:
        `[UNRECOGNIZED FILE: ${filename}]\n` +
        `Size: ${this.formatFileSize(buffer.length)}\n` +
        `First 100 bytes (hex): ${buffer.slice(0, 100).toString("hex")}\n` +
        `File signature: ${this.getFileSignature(buffer)}`,
      encoding: "unknown",
    };
  }

  private extractStringsFromBinary(buffer: Buffer): string[] {
    const strings: string[] = [];
    let currentString = "";
    const minLength = 4;

    for (let i = 0; i < Math.min(buffer.length, this.BINARY_SAMPLE_SIZE); i++) {
      const byte = buffer[i];

      if (byte >= 32 && byte <= 126) {
        currentString += String.fromCharCode(byte);
      } else {
        if (currentString.length >= minLength) {
          strings.push(currentString);
        }
        currentString = "";
      }
    }

    if (currentString.length >= minLength) {
      strings.push(currentString);
    }

    return strings
      .filter((s) => {
        const uniqueChars = new Set(s).size;
        return uniqueChars > 1 && s.length / uniqueChars < 10;
      })
      .slice(0, 100);
  }

  private analyzeBinaryStructure(buffer: Buffer): string {
    const analysis: string[] = [];

    analysis.push(`File signature: ${this.getFileSignature(buffer)}`);

    const entropy = this.calculateEntropy(buffer.slice(0, 1024));
    analysis.push(`Entropy (first 1KB): ${entropy.toFixed(2)} bits`);

    if (entropy > 7.5) {
      analysis.push("High entropy suggests compressed or encrypted content");
    } else if (entropy < 3) {
      analysis.push("Low entropy suggests structured or sparse data");
    }

    const charDist = this.analyzeCharacterDistribution(
      buffer.slice(0, this.BINARY_SAMPLE_SIZE),
    );
    analysis.push(`Character distribution: ${charDist}`);

    const patterns = this.findCommonPatterns(buffer);
    if (patterns.length > 0) {
      analysis.push(`Common patterns found: ${patterns.join(", ")}`);
    }

    return analysis.join("\n");
  }

  private getFileSignature(buffer: Buffer): string {
    if (buffer.length < 4) return "Too small for signature";

    const sig = buffer.slice(0, 4).toString("hex").toUpperCase();

    const signatures: Record<string, string> = {
      "25504446": "PDF",
      "504B0304": "ZIP/Office",
      "504B0506": "ZIP (empty)",
      "504B0708": "ZIP (spanned)",
      "89504E47": "PNG",
      FFD8FFE0: "JPEG",
      FFD8FFE1: "JPEG",
      "47494638": "GIF",
      "49492A00": "TIFF (little-endian)",
      "4D4D002A": "TIFF (big-endian)",
      "424D": "BMP",
      "52494646": "RIFF (WAV/AVI)",
      "1F8B": "GZIP",
      "425A68": "BZIP2",
      "377ABCAF": "7-Zip",
      "52617221": "RAR",
      CAFEBABE: "Java Class",
      "4D5A": "DOS/Windows Executable",
      "7F454C46": "ELF (Linux Executable)",
      FEEDFACE: "Mach-O (32-bit)",
      FEEDFACF: "Mach-O (64-bit)",
      D0CF11E0: "MS Office (old)",
      "53514C69": "SQLite",
    };

    for (const [key, type] of Object.entries(signatures)) {
      if (sig.startsWith(key)) {
        return `${sig} (${type})`;
      }
    }

    return sig;
  }

  private calculateEntropy(buffer: Buffer): number {
    const freq = new Array(256).fill(0);

    for (let i = 0; i < buffer.length; i++) {
      freq[buffer[i]]++;
    }

    let entropy = 0;
    const len = buffer.length;

    for (let i = 0; i < 256; i++) {
      if (freq[i] > 0) {
        const p = freq[i] / len;
        entropy -= p * Math.log2(p);
      }
    }

    return entropy;
  }

  private analyzeCharacterDistribution(buffer: Buffer): string {
    let printable = 0;
    let control = 0;
    let extended = 0;
    let nullBytes = 0;

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if (byte === 0) nullBytes++;
      else if (byte >= 32 && byte <= 126) printable++;
      else if (byte < 32 || byte === 127) control++;
      else extended++;
    }

    const total = buffer.length;
    return (
      `${((printable / total) * 100).toFixed(1)}% printable, ` +
      `${((control / total) * 100).toFixed(1)}% control, ` +
      `${((extended / total) * 100).toFixed(1)}% extended, ` +
      `${((nullBytes / total) * 100).toFixed(1)}% null`
    );
  }

  private findCommonPatterns(buffer: Buffer): string[] {
    const patterns: string[] = [];
    const sample = buffer.slice(0, Math.min(buffer.length, 1024));

    const sequences = new Map<string, number>();
    const seqLength = 4;

    for (let i = 0; i <= sample.length - seqLength; i++) {
      const seq = sample.slice(i, i + seqLength).toString("hex");
      sequences.set(seq, (sequences.get(seq) || 0) + 1);
    }

    const sorted = Array.from(sequences.entries())
      .filter(([_, count]) => count > 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [seq, count] of sorted) {
      if (seq !== "00000000") {
        patterns.push(`0x${seq} (${count}x)`);
      }
    }

    return patterns;
  }

  private async extractJupyterNotebook(
    buffer: Buffer,
    filename: string,
  ): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
    additionalMetadata: { cellCount: number; outputCount: number };
  }> {
    try {
      this.logger.debug(`Parsing Jupyter notebook: ${filename}`);

      const notebookContent = buffer.toString("utf8");
      const notebook: JupyterNotebook = JSON.parse(notebookContent);

      this.logger.debug(
        `Notebook format: v${notebook.nbformat}.${notebook.nbformat_minor}, ` +
          `Cells: ${notebook.cells?.length || 0}`,
      );

      let extractedText = "";
      let cellCount = 0;
      let outputCount = 0;

      extractedText += `=== JUPYTER NOTEBOOK: ${filename} ===\n`;
      extractedText += `Format: ${notebook.nbformat}.${notebook.nbformat_minor}\n`;
      extractedText += `Total Cells: ${notebook.cells?.length || 0}\n`;

      if (notebook.metadata) {
        extractedText += `Language: ${
          notebook.metadata.language_info?.name || "Unknown"
        }\n`;
        extractedText += `Kernel: ${
          notebook.metadata.kernelspec?.display_name || "Unknown"
        }\n`;
      }
      extractedText += "\n";

      for (const [index, cell] of (notebook.cells || []).entries()) {
        cellCount++;
        this.logger.debug(
          `Processing cell ${index + 1}: type=${cell.cell_type}, ` +
            `outputs=${cell.outputs?.length || 0}`,
        );

        extractedText += `\n=== CELL ${
          index + 1
        } [${cell.cell_type.toUpperCase()}]`;
        if (cell.execution_count) {
          extractedText += ` [${cell.execution_count}]`;
        }
        extractedText += " ===\n";

        if (cell.metadata && Object.keys(cell.metadata).length > 0) {
          extractedText += `Metadata: ${JSON.stringify(cell.metadata)}\n`;
        }

        const source = Array.isArray(cell.source)
          ? cell.source.join("")
          : cell.source || "";

        extractedText += source;
        if (!source.endsWith("\n")) extractedText += "\n";

        if (
          cell.cell_type === "code" &&
          cell.outputs &&
          cell.outputs.length > 0
        ) {
          extractedText += "\n--- OUTPUT ---\n";

          for (const [outIdx, output] of cell.outputs.entries()) {
            outputCount++;

            if (outIdx > 0) extractedText += "\n";

            switch (output.output_type) {
              case "stream": {
                const text = Array.isArray(output.text)
                  ? output.text.join("")
                  : output.text || "";
                extractedText += `[${output.name || "stdout"}]:\n${text}`;
                break;
              }

              case "execute_result": {
                extractedText += `[Execute Result`;
                if (output.execution_count) {
                  extractedText += ` #${output.execution_count}`;
                }
                extractedText += `]:\n`;

                if (output.data) {
                  extractedText += this.extractJupyterOutputData(output.data);
                }
                break;
              }

              case "error": {
                extractedText += `[ERROR: ${output.ename}]\n`;
                extractedText += `${output.evalue}\n`;
                if (output.traceback && output.traceback.length > 0) {
                  extractedText += "\nTraceback:\n";
                  for (const line of output.traceback) {
                    extractedText += this.stripAnsiCodes(line) + "\n";
                  }
                }
                break;
              }

              case "display_data": {
                extractedText += "[Display Data]:\n";
                if (output.data) {
                  extractedText += this.extractJupyterOutputData(output.data);
                }
                break;
              }

              default:
                extractedText += `[Unknown output type: ${output.output_type}]\n`;
            }
          }
        }

        extractedText += "\n";
      }

      this.logger.debug(
        `Extracted ${cellCount} cells with ${outputCount} outputs ` +
          `(${extractedText.length} chars)`,
      );

      return {
        text: extractedText,
        extractedText: extractedText,
        encoding: "utf8",
        additionalMetadata: {
          cellCount,
          outputCount,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to parse Jupyter notebook: ${filename}`, error);

      try {
        const rawText = buffer.toString("utf8");
        const lines = rawText.split("\n");
        let fallbackText = `[JUPYTER NOTEBOOK - FALLBACK EXTRACTION: ${filename}]\n\n`;

        let inSource = false;
        let inOutput = false;

        for (const line of lines) {
          if (line.includes('"source":')) inSource = true;
          if (line.includes('"outputs":')) inOutput = true;

          if (
            inSource ||
            inOutput ||
            line.includes('"cell_type"') ||
            line.includes('"output_type"') ||
            line.includes('"text":') ||
            line.includes('"data":')
          ) {
            fallbackText += line + "\n";
          }

          if (line.includes("},")) {
            inSource = false;
            inOutput = false;
          }
        }

        return {
          text: fallbackText,
          extractedText: fallbackText,
          encoding: "utf8",
          additionalMetadata: { cellCount: 0, outputCount: 0 },
        };
      } catch {
        throw error;
      }
    }
  }

  private extractJupyterOutputData(data: Record<string, unknown>): string {
    let result = "";

    const mimePreference = [
      "text/plain",
      "text/markdown",
      "text/html",
      "text/latex",
      "application/json",
      "application/javascript",
      "image/png",
      "image/jpeg",
      "image/svg+xml",
    ];

    for (const mime of mimePreference) {
      if (data[mime]) {
        const content = data[mime];

        if (
          mime.startsWith("text/") ||
          mime === "application/json" ||
          mime === "application/javascript"
        ) {
          const text = Array.isArray(content)
            ? content.join("")
            : String(content);
          result += `[${mime}]:\n${text}\n`;
        } else if (mime.startsWith("image/")) {
          result += `[${mime}]: <image data present>\n`;
        } else {
          result += `[${mime}]: <binary data present>\n`;
        }
      }
    }

    for (const [mime, content] of Object.entries(data)) {
      if (!mimePreference.includes(mime)) {
        if (typeof content === "string" || Array.isArray(content)) {
          const text = Array.isArray(content) ? content.join("") : content;
          result += `[${mime}]:\n${text}\n`;
        } else {
          result += `[${mime}]: <data present>\n`;
        }
      }
    }

    return result;
  }

  private extractPresentationMetadata(parsed: any): string {
    let metadata = "";

    try {
      const presentation = parsed?.["p:presentation"];
      if (presentation) {
        if (presentation["p:sldIdLst"]) {
          metadata += "Slide Order: Defined\n";
        }

        if (presentation["p:sldSz"]) {
          const size = presentation["p:sldSz"][0]?.$;
          if (size) {
            metadata += `Slide Size: ${size.cx}x${size.cy}\n`;
          }
        }
      }
    } catch (error) {
      this.logger.debug("Could not extract presentation metadata");
    }

    return metadata;
  }

  private async extractLegacyPowerPointText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    additionalMetadata: { slideCount: number };
  }> {
    try {
      const strings = this.extractStringsFromBinary(buffer);
      const slideCount = Math.max(1, Math.floor(strings.length / 10));

      return {
        text: `[LEGACY PPT FILE]\nExtracted text fragments:\n${strings.join(
          "\n",
        )}`,
        extractedText: strings.join("\n"),
        additionalMetadata: { slideCount },
      };
    } catch (error) {
      throw new Error(`Legacy PPT extraction failed: ${error}`);
    }
  }

  private async extractODPText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    additionalMetadata: { slideCount: number };
  }> {
    try {
      const zip = await unzipper.Open.buffer(buffer);
      let content = "";
      let slideCount = 0;

      for (const entry of zip.files) {
        if (entry.path === "content.xml") {
          const xmlBuffer = await entry.buffer();
          const xmlString = xmlBuffer.toString("utf8");
          const parsed = await parseStringPromise(xmlString);

          const result = this.extractODPContent(parsed);
          content = result.content;
          slideCount = result.slideCount;
          break;
        }
      }

      return {
        text: `=== ODP PRESENTATION ===\n${content}`,
        extractedText: content,
        additionalMetadata: { slideCount },
      };
    } catch (error) {
      throw new Error(`ODP extraction failed: ${error}`);
    }
  }

  private extractODPContent(node: any): {
    content: string;
    slideCount: number;
  } {
    let content = "";
    let slideCount = 0;

    const extractPage = (page: any, pageNum: number): void => {
      content += `\n=== SLIDE ${pageNum} ===\n`;
      slideCount++;

      const extractText = (n: any): string => {
        let text = "";

        if (typeof n === "string") {
          text += n;
        } else if (n && typeof n === "object") {
          if (n["text:p"] || n["text:h"] || n["text:span"]) {
            for (const key in n) {
              if (key.startsWith("text:")) {
                const value = n[key];
                if (Array.isArray(value)) {
                  text += value.map((v) => extractText(v)).join(" ");
                } else {
                  text += extractText(value);
                }
              }
            }
          } else {
            for (const key in n) {
              if (n[key]) text += extractText(n[key]);
            }
          }
        } else if (Array.isArray(n)) {
          text += n.map((item) => extractText(item)).join(" ");
        }

        return text;
      };

      content += extractText(page).trim() + "\n";
    };

    const findPages = (n: any): void => {
      if (n?.["office:body"]?.["office:presentation"]?.["draw:page"]) {
        const pages = n["office:body"]["office:presentation"]["draw:page"];
        const pageArray = Array.isArray(pages) ? pages : [pages];

        for (let i = 0; i < pageArray.length; i++) {
          extractPage(pageArray[i], i + 1);
        }
      } else if (typeof n === "object") {
        for (const key in n) {
          if (n[key]) findPages(n[key]);
        }
      }
    };

    findPages(node);

    return { content, slideCount };
  }

  private async extractArchiveContent(
    buffer: Buffer,
    filename: string,
    type: "zip" | "tar" | "7z" | "rar",
  ): Promise<{
    text: string;
    extractedText: string;
    additionalMetadata: { fileCount: number };
  }> {
    try {
      let fileList: string[] = [];
      let extractedContent = `=== ARCHIVE: ${filename} (${type.toUpperCase()}) ===\n`;

      if (type === "zip") {
        try {
          const zip = await unzipper.Open.buffer(buffer);

          extractedContent += `Total files: ${zip.files.length}\n\n`;
          extractedContent += "--- FILE LISTING ---\n";

          for (const entry of zip.files) {
            const size = entry.uncompressedSize || 0;
            extractedContent += `${entry.path} (${this.formatFileSize(
              size,
            )})\n`;
            fileList.push(entry.path);

            if (this.isTextFile(entry.path) && size < 100000) {
              try {
                const fileBuffer = await entry.buffer();
                const textResult = this.extractPlainText(fileBuffer);
                if (textResult.text && !textResult.text.includes("[BINARY")) {
                  extractedContent += `\n--- CONTENT: ${entry.path} ---\n`;
                  extractedContent += textResult.text.substring(0, 1000);
                  if (textResult.text.length > 1000) {
                    extractedContent += "\n[...truncated...]";
                  }
                  extractedContent += "\n";
                }
              } catch {
                // Skip files that can't be extracted
              }
            }
          }
        } catch (error) {
          extractedContent += `Error reading archive: ${error}\n`;
          extractedContent += `Archive size: ${this.formatFileSize(
            buffer.length,
          )}\n`;
        }
      } else {
        extractedContent += `Archive type: ${type}\n`;
        extractedContent += `Size: ${this.formatFileSize(buffer.length)}\n`;
        extractedContent += `\nNote: Full extraction for ${type} archives requires additional libraries.\n`;

        const possibleFilenames = this.extractStringsFromBinary(buffer).filter(
          (s) => s.includes(".") && s.length < 100 && /^[\w\-./\\]+$/.test(s),
        );

        if (possibleFilenames.length > 0) {
          extractedContent += "\nPossible files detected:\n";
          for (const fname of possibleFilenames.slice(0, 50)) {
            extractedContent += `- ${fname}\n`;
          }
        }
      }

      return {
        text: extractedContent,
        extractedText: extractedContent,
        additionalMetadata: { fileCount: fileList.length },
      };
    } catch (error) {
      throw new Error(`Archive extraction failed: ${error}`);
    }
  }

  private isTextFile(filename: string): boolean {
    const textExtensions = [
      "txt",
      "md",
      "json",
      "xml",
      "html",
      "css",
      "js",
      "ts",
      "py",
      "java",
      "c",
      "cpp",
      "h",
      "cs",
      "php",
      "rb",
      "go",
      "rs",
      "sh",
      "yaml",
      "yml",
      "toml",
      "ini",
      "conf",
      "log",
      "csv",
      "sql",
    ];

    const ext = filename.split(".").pop()?.toLowerCase();
    return textExtensions.includes(ext || "");
  }

  private async extractJSONContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const jsonString = buffer.toString("utf8");
      const parsed = JSON.parse(jsonString);

      const formatted = JSON.stringify(parsed, null, 2);

      let summary = "=== JSON DATA ===\n";
      summary += `Type: ${Array.isArray(parsed) ? "Array" : "Object"}\n`;

      if (Array.isArray(parsed)) {
        summary += `Length: ${parsed.length}\n`;
      } else {
        summary += `Keys: ${Object.keys(parsed).length}\n`;
        summary += `Top-level keys: ${Object.keys(parsed)
          .slice(0, 10)
          .join(", ")}`;
        if (Object.keys(parsed).length > 10) {
          summary += "...";
        }
        summary += "\n";
      }

      summary += "\n--- CONTENT ---\n";

      return {
        text: summary + formatted,
        extractedText: formatted,
        encoding: "utf8",
      };
    } catch (error) {
      try {
        const lines = buffer
          .toString("utf8")
          .split("\n")
          .filter((line) => line.trim());
        const objects = lines.map((line) => JSON.parse(line));

        return {
          text: `=== JSONL DATA ===\nLines: ${
            objects.length
          }\n\n${JSON.stringify(objects, null, 2)}`,
          extractedText: JSON.stringify(objects, null, 2),
          encoding: "utf8",
        };
      } catch {
        throw new Error(`JSON parsing failed: ${error}`);
      }
    }
  }

  private async extractXMLContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const xmlString = buffer.toString("utf8");
      const parsed = await parseStringPromise(xmlString, {
        explicitArray: false,
        mergeAttrs: true,
        normalize: true,
        normalizeTags: true,
      });

      const textContent = this.extractTextFromXML(parsed);

      let result = "=== XML DOCUMENT ===\n";
      result += `Root element: ${Object.keys(parsed)[0]}\n\n`;
      result += "--- TEXT CONTENT ---\n";
      result += textContent + "\n\n";
      result += "--- STRUCTURE ---\n";
      result += JSON.stringify(parsed, null, 2);

      return {
        text: result,
        extractedText: textContent,
        encoding: "utf8",
      };
    } catch (error) {
      throw new Error(`XML parsing failed: ${error}`);
    }
  }

  private async extractYAMLContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const yamlString = buffer.toString("utf8");

      let result = "=== YAML DOCUMENT ===\n\n";
      result += yamlString;

      const lines = yamlString.split("\n");
      const keys = lines
        .filter((line) => line.match(/^[a-zA-Z_][\w]*:/))
        .map((line) => line.split(":")[0].trim());

      if (keys.length > 0) {
        result =
          `=== YAML DOCUMENT ===\nTop-level keys: ${keys.join(", ")}\n\n` +
          yamlString;
      }

      return {
        text: result,
        extractedText: yamlString,
        encoding: "utf8",
      };
    } catch (error) {
      throw new Error(`YAML extraction failed: ${error}`);
    }
  }

  private async extractTOMLContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const tomlString = buffer.toString("utf8");

      const sections = tomlString.match(/^\[[\w.]+\]/gm) || [];

      let result = "=== TOML DOCUMENT ===\n";
      if (sections.length > 0) {
        result += `Sections: ${sections.join(", ")}\n\n`;
      }
      result += tomlString;

      return {
        text: result,
        extractedText: tomlString,
        encoding: "utf8",
      };
    } catch (error) {
      throw new Error(`TOML extraction failed: ${error}`);
    }
  }

  private async extractConfigContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    const content = this.extractPlainText(buffer);

    let configType = "CONFIG";
    if (content.text.includes("[") && content.text.includes("]")) {
      configType = "INI";
    }

    return {
      text: `=== ${configType} FILE ===\n\n${content.text}`,
      extractedText: content.text,
      encoding: content.encoding,
    };
  }

  private async extractSQLiteContent(
    buffer: Buffer,
    filename: string,
  ): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const header = buffer.slice(0, 16).toString("latin1");
      if (!header.startsWith("SQLite format 3")) {
        throw new Error("Not a valid SQLite database");
      }

      let result = `=== SQLITE DATABASE: ${filename} ===\n`;
      result += `Size: ${this.formatFileSize(buffer.length)}\n`;
      result += `Version: SQLite format 3\n\n`;

      const strings = this.extractStringsFromBinary(buffer);
      const tableNames = strings
        .filter(
          (s) =>
            s.startsWith("CREATE TABLE") ||
            s.startsWith("CREATE INDEX") ||
            s.match(/^[a-zA-Z_]\w*$/),
        )
        .slice(0, 50);

      if (tableNames.length > 0) {
        result += "Possible tables/indexes:\n";
        for (const name of tableNames) {
          result += `- ${name}\n`;
        }
      }

      result += "\nNote: Full SQLite extraction requires sqlite3 library.\n";

      return {
        text: result,
        extractedText: result,
        encoding: "binary",
      };
    } catch (error) {
      throw new Error(`SQLite extraction failed: ${error}`);
    }
  }

  private async extractLogContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    const textResult = this.extractPlainText(buffer);
    const lines = textResult.text.split("\n");

    let result = "=== LOG FILE ===\n";
    result += `Total lines: ${lines.length}\n`;

    const timestampFormats = [
      /^\d{4}-\d{2}-\d{2}/,
      /^\[\d{4}-\d{2}-\d{2}/,
      /^\d{2}\/\d{2}\/\d{4}/,
      /^\w{3}\s+\d{1,2}/,
    ];

    let formatDetected = false;
    for (const format of timestampFormats) {
      if (lines.some((line) => format.test(line))) {
        result += `Format: Structured log with timestamps\n`;
        formatDetected = true;
        break;
      }
    }

    if (!formatDetected) {
      result += `Format: Unstructured\n`;
    }

    const levels = {
      ERROR: 0,
      WARN: 0,
      INFO: 0,
      DEBUG: 0,
      TRACE: 0,
    };

    for (const line of lines) {
      const upperLine = line.toUpperCase();
      for (const level of Object.keys(levels)) {
        if (upperLine.includes(level)) {
          levels[level as keyof typeof levels]++;
        }
      }
    }

    const hasLevels = Object.values(levels).some((count) => count > 0);
    if (hasLevels) {
      result += "\nLog levels found:\n";
      for (const [level, count] of Object.entries(levels)) {
        if (count > 0) {
          result += `- ${level}: ${count}\n`;
        }
      }
    }

    result += "\n--- CONTENT ---\n";
    result += textResult.text;

    return {
      text: result,
      extractedText: textResult.text,
      encoding: textResult.encoding,
    };
  }

  private async extractSourceCode(
    buffer: Buffer,
    extension: string,
  ): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    const textResult = this.extractPlainText(buffer);

    const languageMap: Record<string, string> = {
      js: "JavaScript",
      jsx: "JavaScript (React)",
      ts: "TypeScript",
      tsx: "TypeScript (React)",
      py: "Python",
      java: "Java",
      cpp: "C++",
      c: "C",
      cs: "C#",
      php: "PHP",
      rb: "Ruby",
      go: "Go",
      rs: "Rust",
      swift: "Swift",
      kt: "Kotlin",
      scala: "Scala",
      r: "R",
      m: "MATLAB/Objective-C",
      sh: "Shell Script",
      ps1: "PowerShell",
    };

    const language = languageMap[extension] || extension.toUpperCase();

    let result = `=== SOURCE CODE (${language}) ===\n`;

    const lines = textResult.text.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    const commentLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      );
    });

    result += `Lines: ${lines.length} (${nonEmptyLines.length} non-empty)\n`;
    result += `Comment lines: ${commentLines.length}\n`;
    result += `Encoding: ${textResult.encoding}\n`;

    const imports = lines
      .filter(
        (line) =>
          line.match(/^(import|from|include|require|use)\s/) ||
          line.match(/^#include/),
      )
      .slice(0, 10);

    if (imports.length > 0) {
      result += `\nImports/Dependencies:\n`;
      for (const imp of imports) {
        result += `- ${imp.trim()}\n`;
      }
    }

    result += `\n--- CODE ---\n`;
    result += textResult.text;

    return {
      text: result,
      extractedText: textResult.text,
      encoding: textResult.encoding,
    };
  }

  private async extractHTMLContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const htmlString = buffer.toString("utf8");

      const textContent = htmlString
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const title = htmlString.match(/<title>(.*?)<\/title>/i)?.[1] || "";
      const metaTags = [...htmlString.matchAll(/<meta\s+[^>]*>/gi)];

      let result = "=== HTML DOCUMENT ===\n";
      if (title) result += `Title: ${title}\n`;

      if (metaTags.length > 0) {
        result += `\nMeta tags: ${metaTags.length}\n`;
      }

      result += "\n--- TEXT CONTENT ---\n";
      result += textContent;

      result += "\n\n--- RAW HTML ---\n";
      result += htmlString;

      return {
        text: result,
        extractedText: textContent,
        encoding: "utf8",
      };
    } catch (error) {
      throw new Error(`HTML extraction failed: ${error}`);
    }
  }

  private async extractComponentFile(
    buffer: Buffer,
    type: string,
  ): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    const content = buffer.toString("utf8");

    let result = `=== ${type.toUpperCase()} COMPONENT ===\n\n`;

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const templateMatch = content.match(
      /<template[^>]*>([\s\S]*?)<\/template>/i,
    );
    const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/i);

    if (scriptMatch) {
      result += "--- SCRIPT ---\n";
      result += scriptMatch[1].trim() + "\n\n";
    }

    if (templateMatch) {
      result += "--- TEMPLATE ---\n";
      result += templateMatch[1].trim() + "\n\n";
    }

    if (styleMatch) {
      result += "--- STYLE ---\n";
      result += styleMatch[1].trim() + "\n\n";
    }

    if (!scriptMatch && !templateMatch && !styleMatch) {
      result += content;
    }

    return {
      text: result,
      extractedText: content,
      encoding: "utf8",
    };
  }

  private async extractImageMetadata(
    buffer: Buffer,
    filename: string,
  ): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    let result = `=== IMAGE FILE: ${filename} ===\n`;
    result += `Size: ${this.formatFileSize(buffer.length)}\n`;
    result += `Format: ${path.extname(filename).substring(1).toUpperCase()}\n`;

    const signature = this.getFileSignature(buffer);
    result += `Signature: ${signature}\n`;

    if (filename.toLowerCase().endsWith(".png")) {
      if (buffer.length > 24) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        result += `Dimensions: ${width}x${height}\n`;
      }
    }

    result +=
      "\nNote: OCR not implemented. Install tesseract.js for text extraction from images.\n";

    return {
      text: result,
      extractedText: result,
      encoding: "binary",
    };
  }

  private async extractMediaMetadata(
    buffer: Buffer,
    filename: string,
  ): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    const extension = path.extname(filename).substring(1).toUpperCase();
    let result = `=== ${extension} MEDIA FILE: ${filename} ===\n`;
    result += `Size: ${this.formatFileSize(buffer.length)}\n`;
    result += `Signature: ${this.getFileSignature(buffer)}\n`;

    if (filename.toLowerCase().endsWith(".mp3")) {
      const id3v1 = buffer.slice(-128);
      if (id3v1.slice(0, 3).toString() === "TAG") {
        result += "\nID3v1 Tags found:\n";
        result += `Title: ${id3v1
          .slice(3, 33)
          .toString()
          .replace(/\0/g, "")
          .trim()}\n`;
        result += `Artist: ${id3v1
          .slice(33, 63)
          .toString()
          .replace(/\0/g, "")
          .trim()}\n`;
        result += `Album: ${id3v1
          .slice(63, 93)
          .toString()
          .replace(/\0/g, "")
          .trim()}\n`;
        result += `Year: ${id3v1.slice(93, 97).toString()}\n`;
      }
    }

    const strings = this.extractStringsFromBinary(
      buffer.slice(0, 10000),
    ).filter((s) => s.length > 5 && s.length < 100);

    if (strings.length > 0) {
      result += "\nPossible metadata:\n";
      for (const str of strings.slice(0, 20)) {
        result += `- ${str}\n`;
      }
    }

    return {
      text: result,
      extractedText: result,
      encoding: "binary",
    };
  }

  private async extractEmailContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const emailString = buffer.toString("utf8");
      const lines = emailString.split("\n");

      let result = "=== EMAIL MESSAGE ===\n";
      let headers = "";
      let body = "";
      let inBody = false;

      for (const line of lines) {
        if (!inBody && line.trim() === "") {
          inBody = true;
          continue;
        }

        if (inBody) {
          body += line + "\n";
        } else {
          headers += line + "\n";

          if (line.startsWith("From:")) {
            result += `From: ${line.substring(5).trim()}\n`;
          } else if (line.startsWith("To:")) {
            result += `To: ${line.substring(3).trim()}\n`;
          } else if (line.startsWith("Subject:")) {
            result += `Subject: ${line.substring(8).trim()}\n`;
          } else if (line.startsWith("Date:")) {
            result += `Date: ${line.substring(5).trim()}\n`;
          }
        }
      }

      result += "\n--- BODY ---\n";
      result += body;

      return {
        text: result,
        extractedText: body,
        encoding: "utf8",
      };
    } catch (error) {
      throw new Error(`Email extraction failed: ${error}`);
    }
  }

  private async extractOutlookMessage(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    const strings = this.extractStringsFromBinary(buffer);

    let result = "=== OUTLOOK MESSAGE ===\n";

    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
    const emails = strings.join(" ").match(emailPattern) || [];

    if (emails.length > 0) {
      result += `Email addresses found: ${[...new Set(emails)].join(", ")}\n`;
    }

    result += "\nExtracted text:\n";
    result += strings.filter((s) => s.length > 10).join("\n");

    return {
      text: result,
      extractedText: strings.join("\n"),
      encoding: "binary",
    };
  }

  private async extractCalendarContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const icsString = buffer.toString("utf8");
      const lines = icsString.split(/\r?\n/);

      let result = "=== CALENDAR FILE ===\n";
      let events = 0;
      let currentEvent: any = {};

      for (const line of lines) {
        if (line.startsWith("BEGIN:VEVENT")) {
          events++;
          currentEvent = {};
        } else if (line.startsWith("END:VEVENT")) {
          if (Object.keys(currentEvent).length > 0) {
            result += `\n--- EVENT ${events} ---\n`;
            for (const [key, value] of Object.entries(currentEvent)) {
              result += `${key}: ${value}\n`;
            }
          }
        } else if (line.includes(":")) {
          const [key, ...valueParts] = line.split(":");
          const value = valueParts.join(":");

          if (key === "SUMMARY") currentEvent.Summary = value;
          else if (key === "DTSTART") currentEvent.Start = value;
          else if (key === "DTEND") currentEvent.End = value;
          else if (key === "LOCATION") currentEvent.Location = value;
          else if (key === "DESCRIPTION") currentEvent.Description = value;
        }
      }

      result += `\nTotal events: ${events}\n`;

      return {
        text: result,
        extractedText: icsString,
        encoding: "utf8",
      };
    } catch (error) {
      throw new Error(`Calendar extraction failed: ${error}`);
    }
  }

  private async extractVCardContent(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    encoding: string;
  }> {
    try {
      const vcfString = buffer.toString("utf8");
      const lines = vcfString.split(/\r?\n/);

      let result = "=== VCARD FILE ===\n";
      let contacts = 0;
      let currentContact: any = {};

      for (const line of lines) {
        if (line.startsWith("BEGIN:VCARD")) {
          contacts++;
          currentContact = {};
        } else if (line.startsWith("END:VCARD")) {
          if (Object.keys(currentContact).length > 0) {
            result += `\n--- CONTACT ${contacts} ---\n`;
            for (const [key, value] of Object.entries(currentContact)) {
              result += `${key}: ${value}\n`;
            }
          }
        } else if (line.includes(":")) {
          const [key, ...valueParts] = line.split(":");
          const value = valueParts.join(":");

          if (key === "FN") currentContact.Name = value;
          else if (key.startsWith("TEL")) currentContact.Phone = value;
          else if (key.startsWith("EMAIL")) currentContact.Email = value;
          else if (key === "ORG") currentContact.Organization = value;
          else if (key.startsWith("ADR")) currentContact.Address = value;
        }
      }

      result += `\nTotal contacts: ${contacts}\n`;

      return {
        text: result,
        extractedText: vcfString,
        encoding: "utf8",
      };
    } catch (error) {
      throw new Error(`vCard extraction failed: ${error}`);
    }
  }

  private extractTextFromXML(node: XMLNode): string {
    let text = "";

    const extract = (currentNode: unknown): void => {
      if (typeof currentNode === "string") {
        text += currentNode + " ";
      } else if (typeof currentNode === "object" && currentNode !== null) {
        const objectNode = currentNode as XMLNode;

        if (objectNode["a:t"]) {
          const textNode = objectNode["a:t"];
          if (Array.isArray(textNode)) {
            for (const t of textNode) {
              extract(t);
            }
          } else {
            extract(textNode);
          }
        }

        if (objectNode["t"]) {
          extract(objectNode["t"]);
        }

        for (const key of Object.keys(objectNode)) {
          if (key !== "$" && objectNode[key]) {
            const value = objectNode[key];
            if (Array.isArray(value)) {
              for (const item of value) {
                extract(item);
              }
            } else {
              extract(value);
            }
          }
        }
      }
    };

    extract(node);
    return text.trim();
  }

  private sanitizeAndTruncate(content: string): string {
    let sanitized = content
      .replace(/\0/g, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
      .replace(/[\x7F-\x9F]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

    sanitized = this.stripAnsiCodes(sanitized);

    try {
      sanitized = sanitized.normalize("NFKC");
    } catch {
      this.logger.debug("Failed to normalize unicode");
    }

    sanitized = sanitized
      .replace(/â€™/g, "'")
      .replace(/â€œ/g, '"')
      .replace(/â€/g, '"')
      .replace(/â€¦/g, "...")
      .replace(/â€"/g, "—")
      .replace(/â€"/g, "–");

    sanitized = sanitized
      .replace(/[ \t]{3,}/g, "  ")
      .replace(/\n{4,}/g, "\n\n\n");

    if (sanitized.length > this.CHUNK_SIZE) {
      this.logger.debug(
        `Large content: ${sanitized.length} chars from ${content.length} original chars`,
      );
    }

    if (sanitized.length <= this.MAX_CONTENT_LENGTH) {
      return sanitized;
    }

    const truncatePoint = this.MAX_CONTENT_LENGTH - 200;
    let breakPoint = truncatePoint;

    const paragraphBreak = sanitized.lastIndexOf("\n\n", truncatePoint);
    if (paragraphBreak > truncatePoint * 0.8) {
      breakPoint = paragraphBreak;
    } else {
      const sentenceBreak = sanitized.lastIndexOf(". ", truncatePoint);
      if (sentenceBreak > truncatePoint * 0.8) {
        breakPoint = sentenceBreak + 1;
      }
    }

    const truncated = sanitized.slice(0, breakPoint);
    const remaining = sanitized.length - breakPoint;

    return (
      truncated +
      `\n\n[TRUNCATED: Showing ${breakPoint} of ${sanitized.length} characters. ` +
      `${remaining} characters omitted for LLM context limit.]`
    );
  }

  private formatFileSize(bytes: number): string {
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    return `${size.toFixed(2)} ${sizes[i]}`;
  }

  private stripAnsiCodes(text: string): string {
    return text
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/\u001b\[[0-9]*[A-Za-z]/g, "")
      .replace(/\u001b\]8;;.*?\u001b\\/g, "")
      .replace(/\u001b\[[?][0-9;]*[hl]/g, "")
      .replace(/\u001b\[[0-9;]*[HfJ]/g, "")
      .replace(/\u0008/g, "");
  }

  private extractPlainText(buffer: Buffer): {
    text: string;
    encoding: string;
  } {
    if (buffer.length >= 3) {
      if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return { text: buffer.toString("utf8", 3), encoding: "utf8-bom" };
      }
      if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return { text: buffer.toString("utf16le", 2), encoding: "utf16le-bom" };
      }
      if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        return {
          text: buffer.swap16().toString("utf16le", 2),
          encoding: "utf16be-bom",
        };
      }
    }

    const encodings: BufferEncoding[] = ["utf8", "utf16le", "latin1", "ascii"];

    for (const encoding of encodings) {
      try {
        const text = buffer.toString(encoding);

        const replacements = (text.match(/\uFFFD/g) || []).length;
        const threshold = Math.max(10, buffer.length * 0.01);

        if (replacements <= threshold) {
          if (encoding === "utf8") {
            let valid = true;
            for (let i = 0; i < buffer.length; i++) {
              const byte = buffer[i];
              if (byte >= 0x80) {
                if ((byte & 0xe0) === 0xc0) {
                  if (
                    i + 1 >= buffer.length ||
                    (buffer[i + 1] & 0xc0) !== 0x80
                  ) {
                    valid = false;
                    break;
                  }
                  i += 1;
                } else if ((byte & 0xf0) === 0xe0) {
                  if (
                    i + 2 >= buffer.length ||
                    (buffer[i + 1] & 0xc0) !== 0x80 ||
                    (buffer[i + 2] & 0xc0) !== 0x80
                  ) {
                    valid = false;
                    break;
                  }
                  i += 2;
                } else if ((byte & 0xf8) === 0xf0) {
                  if (
                    i + 3 >= buffer.length ||
                    (buffer[i + 1] & 0xc0) !== 0x80 ||
                    (buffer[i + 2] & 0xc0) !== 0x80 ||
                    (buffer[i + 3] & 0xc0) !== 0x80
                  ) {
                    valid = false;
                    break;
                  }
                  i += 3;
                }
              }
            }
            if (valid) {
              return { text, encoding };
            }
          } else {
            return { text, encoding };
          }
        }
      } catch {
        continue;
      }
    }

    let asciiText = "";
    let lastWasPrintable = false;

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];

      if (
        (byte >= 32 && byte <= 126) ||
        byte === 9 ||
        byte === 10 ||
        byte === 13
      ) {
        asciiText += String.fromCharCode(byte);
        lastWasPrintable = true;
      } else if (lastWasPrintable) {
        asciiText += " ";
        lastWasPrintable = false;
      }
    }

    if (asciiText.trim().length > buffer.length * 0.1) {
      return {
        text: asciiText,
        encoding: "ascii-extracted",
      };
    }

    return {
      text: `[BINARY CONTENT: ${buffer.length} bytes, no text found]`,
      encoding: "binary",
    };
  }

  private async extractPDFText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    additionalMetadata: { pageCount: number };
  }> {
    try {
      const data = (await pdfParse(buffer, {
        max: 0,
        version: "v2.0.550",
      })) as PDFData;

      let extractedText = `=== PDF DOCUMENT ===\n`;
      extractedText += `Pages: ${data.numpages}\n`;

      if (data.info?.Title) extractedText += `Title: ${data.info.Title}\n`;
      if (data.info?.Author) extractedText += `Author: ${data.info.Author}\n`;
      if (data.info?.Subject)
        extractedText += `Subject: ${data.info.Subject}\n`;
      if (data.info?.Creator)
        extractedText += `Creator: ${data.info.Creator}\n`;

      extractedText += `\n--- CONTENT ---\n`;
      extractedText += data.text;

      this.logger.debug(`Extracted ${data.numpages} pages from PDF`);

      return {
        text: extractedText,
        extractedText: extractedText,
        additionalMetadata: {
          pageCount: data.numpages,
        },
      };
    } catch (error) {
      const errorMessage =
        typeof error === "object" && error !== null && "message" in error
          ? (error as { message: string }).message
          : String(error);

      this.logger.error(`PDF extraction failed: ${errorMessage}`);

      const textMatches = buffer.toString("latin1").match(/BT[\s\S]*?ET/g);
      if (textMatches && textMatches.length > 0) {
        let fallbackText = "[PDF - FALLBACK EXTRACTION]\n";
        for (const match of textMatches) {
          const text = match
            .replace(/BT|ET/g, "")
            .replace(/\\[0-9]{3}/g, "")
            .replace(/[^\x20-\x7E\n]/g, " ");
          if (text.trim()) {
            fallbackText += text + "\n";
          }
        }
        return {
          text: fallbackText,
          extractedText: fallbackText,
          additionalMetadata: { pageCount: 0 },
        };
      }

      throw new Error(`PDF extraction failed: ${errorMessage}`);
    }
  }

  private async extractWordText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
  }> {
    try {
      const result = await mammoth.extractRawText({ buffer });

      let extractedText = "=== WORD DOCUMENT ===\n\n";
      extractedText += result.value;

      if (result.messages && result.messages.length > 0) {
        this.logger.debug(
          `Word extraction messages: ${JSON.stringify(result.messages)}`,
        );
      }

      return {
        text: extractedText,
        extractedText: extractedText,
      };
    } catch (error) {
      const errorMessage =
        typeof error === "object" && error !== null && "message" in error
          ? (error as { message: string }).message
          : String(error);
      throw new Error(`Word extraction failed: ${errorMessage}`);
    }
  }

  private async extractLegacyWordText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
  }> {
    try {
      try {
        const result = await mammoth.extractRawText({ buffer });
        if (result.value && result.value.trim().length > 0) {
          return {
            text: `=== LEGACY WORD DOCUMENT ===\n\n${result.value}`,
            extractedText: result.value,
          };
        }
      } catch {
        // Continue with fallback
      }

      let text = "";
      const str = buffer.toString("binary");

      const textPattern = /[\x20-\x7E\r\n\t]{20,}/g;
      const matches = str.match(textPattern);

      if (matches) {
        text = matches
          .filter((match) => {
            const hexCount = (match.match(/[0-9A-Fa-f]{8,}/g) || []).length;
            return hexCount < match.length / 10;
          })
          .join("\n");
      }

      return {
        text: `[LEGACY DOC FILE]\n${text || "Unable to extract text"}`,
        extractedText: text,
      };
    } catch {
      return {
        text: `[LEGACY DOC FILE: Extraction failed]`,
        extractedText: "",
      };
    }
  }

  private async extractODTText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
  }> {
    try {
      const zip = await unzipper.Open.buffer(buffer);
      let content = "";

      for (const entry of zip.files) {
        if (entry.path === "content.xml") {
          const xmlBuffer = await entry.buffer();
          const xmlString = xmlBuffer.toString("utf8");
          const parsed = await parseStringPromise(xmlString);

          content = this.extractTextFromODT(parsed);
          break;
        }
      }

      return {
        text: `=== ODT DOCUMENT ===\n\n${content}`,
        extractedText: content,
      };
    } catch (error) {
      throw new Error(`ODT extraction failed: ${error}`);
    }
  }

  private extractTextFromODT(node: any): string {
    let text = "";

    const extract = (n: any): void => {
      if (typeof n === "string") {
        text += n;
      } else if (n && typeof n === "object") {
        if (n["text:p"]) {
          const paragraphs = Array.isArray(n["text:p"])
            ? n["text:p"]
            : [n["text:p"]];
          for (const p of paragraphs) {
            extract(p);
            text += "\n";
          }
        }

        if (n["text:h"]) {
          const headers = Array.isArray(n["text:h"])
            ? n["text:h"]
            : [n["text:h"]];
          for (const h of headers) {
            extract(h);
            text += "\n\n";
          }
        }

        if (n["text:span"]) {
          extract(n["text:span"]);
        }

        for (const key in n) {
          if (key !== "$" && n[key]) {
            extract(n[key]);
          }
        }
      } else if (Array.isArray(n)) {
        for (const item of n) {
          extract(item);
        }
      }
    };

    extract(node);
    return text.trim();
  }

  private async extractRTFText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
  }> {
    try {
      const rtfString = buffer.toString("latin1");

      let text = rtfString
        .replace(/\{\\[^{}]*\}/g, "")
        .replace(/\\[a-z]+[0-9-]* ?/gi, "")
        .replace(/[{}]/g, "")
        .replace(/\\'([0-9a-f]{2})/gi, (match, hex) => {
          return String.fromCharCode(parseInt(hex, 16));
        })
        .replace(/\s+/g, " ")
        .trim();

      return {
        text: `=== RTF DOCUMENT ===\n\n${text}`,
        extractedText: text,
      };
    } catch (error) {
      throw new Error(`RTF extraction failed: ${error}`);
    }
  }

  private async extractExcelText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    additionalMetadata: { sheetCount: number };
  }> {
    try {
      const workbook = XLSX.read(buffer, {
        type: "buffer",
        cellText: true,
        cellDates: true,
        cellNF: true,
        cellStyles: true,
        cellFormula: true,
        sheetStubs: true,
        password: undefined,
      });

      let allText = "=== EXCEL WORKBOOK ===\n";
      const sheetNames = workbook.SheetNames;
      allText += `Total Sheets: ${sheetNames.length}\n\n`;

      for (const sheetName of sheetNames) {
        const worksheet = workbook.Sheets[sheetName];

        allText += `\n=== SHEET: ${sheetName} ===\n`;

        const range = worksheet["!ref"]
          ? XLSX.utils.decode_range(worksheet["!ref"])
          : null;
        if (range) {
          allText += `Range: ${worksheet["!ref"]} (${
            range.e.r - range.s.r + 1
          } rows × ${range.e.c - range.s.c + 1} cols)\n\n`;
        }

        const csvText = XLSX.utils.sheet_to_csv(worksheet, {
          blankrows: true,
          skipHidden: false,
          rawNumbers: false,
          strip: false,
          FS: "\t",
        });

        if (csvText.trim()) {
          allText += csvText + "\n";
        } else {
          allText += "[Empty sheet]\n";
        }

        const formulas: string[] = [];
        for (const cell in worksheet) {
          if (cell[0] === "!") continue;
          const cellData = worksheet[cell];
          if (cellData.f) {
            formulas.push(`${cell}: ${cellData.f}`);
          }
        }

        if (formulas.length > 0) {
          allText += "\n--- FORMULAS ---\n";
          allText += formulas.join("\n") + "\n";
        }

        if (worksheet["!comments"]) {
          allText += "\n--- COMMENTS ---\n";
          for (const cell in worksheet["!comments"]) {
            const comment = worksheet["!comments"][cell];
            allText += `${cell}: ${comment.t || comment}\n`;
          }
        }
      }

      if (workbook.Props) {
        allText += "\n=== DOCUMENT PROPERTIES ===\n";
        for (const [key, value] of Object.entries(workbook.Props)) {
          if (value) allText += `${key}: ${value}\n`;
        }
      }

      this.logger.debug(`Extracted ${sheetNames.length} sheets from Excel`);

      return {
        text: allText.trim(),
        extractedText: allText.trim(),
        additionalMetadata: {
          sheetCount: sheetNames.length,
        },
      };
    } catch (error) {
      const errorMessage =
        typeof error === "object" && error !== null && "message" in error
          ? (error as { message: string }).message
          : String(error);
      throw new Error(`Excel extraction failed: ${errorMessage}`);
    }
  }

  private async extractODSText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    additionalMetadata: { sheetCount: number };
  }> {
    try {
      const zip = await unzipper.Open.buffer(buffer);
      let content = "";
      let sheetCount = 0;

      for (const entry of zip.files) {
        if (entry.path === "content.xml") {
          const xmlBuffer = await entry.buffer();
          const xmlString = xmlBuffer.toString("utf8");
          const parsed = await parseStringPromise(xmlString);

          const result = this.extractODSContent(parsed);
          content = result.content;
          sheetCount = result.sheetCount;
          break;
        }
      }

      return {
        text: `=== ODS SPREADSHEET ===\n${content}`,
        extractedText: content,
        additionalMetadata: { sheetCount },
      };
    } catch (error) {
      throw new Error(`ODS extraction failed: ${error}`);
    }
  }

  private extractODSContent(node: any): {
    content: string;
    sheetCount: number;
  } {
    let content = "";
    let sheetCount = 0;

    const extractTable = (table: any, tableName: string): void => {
      content += `\n=== SHEET: ${tableName} ===\n`;
      sheetCount++;

      if (table["table:table-row"]) {
        const rows = Array.isArray(table["table:table-row"])
          ? table["table:table-row"]
          : [table["table:table-row"]];

        for (const row of rows) {
          const cells: string[] = [];

          if (row["table:table-cell"]) {
            const cellNodes = Array.isArray(row["table:table-cell"])
              ? row["table:table-cell"]
              : [row["table:table-cell"]];

            for (const cell of cellNodes) {
              let cellText = "";

              if (cell["text:p"]) {
                const paragraphs = Array.isArray(cell["text:p"])
                  ? cell["text:p"]
                  : [cell["text:p"]];
                cellText = paragraphs
                  .map((p: any) => (typeof p === "string" ? p : p._ || ""))
                  .join(" ");
              }

              const repeat = parseInt(
                cell.$?.["table:number-columns-repeated"] || "1",
              );
              for (let i = 0; i < repeat; i++) {
                cells.push(cellText);
              }
            }
          }

          if (cells.some((cell) => cell.trim())) {
            content += cells.join("\t") + "\n";
          }
        }
      }
    };

    const findTables = (n: any): void => {
      if (n?.["office:body"]?.["office:spreadsheet"]?.["table:table"]) {
        const tables = n["office:body"]["office:spreadsheet"]["table:table"];
        const tableArray = Array.isArray(tables) ? tables : [tables];

        for (const table of tableArray) {
          const tableName = table.$?.["table:name"] || `Sheet${sheetCount + 1}`;
          extractTable(table, tableName);
        }
      } else if (typeof n === "object") {
        for (const key in n) {
          if (n[key]) findTables(n[key]);
        }
      }
    };

    findTables(node);

    return { content, sheetCount };
  }

  private async extractCSVText(
    buffer: Buffer,
    delimiter: string = ",",
  ): Promise<{
    text: string;
    extractedText: string;
  }> {
    return new Promise((resolve, reject) => {
      const results: string[] = [];
      const stream = Readable.from(buffer);
      let rowCount = 0;
      let headers: string[] = [];

      stream
        .pipe(
          csv({
            separator: delimiter,
            strict: false,
            maxRowBytes: 1048576,
          }),
        )
        .on("headers", (hdrs: string[]) => {
          headers = hdrs;
          results.push(`=== CSV DATA ===`);
          results.push(`Columns: ${headers.join(", ")}`);
          results.push(`Delimiter: "${delimiter}"`);
          results.push("");
        })
        .on("data", (data: Record<string, string>) => {
          rowCount++;
          if (rowCount === 1) {
            results.push("--- DATA ---");
          }

          const row =
            headers.length > 0
              ? headers.map((h) => `${h}: ${data[h] || ""}`).join(" | ")
              : Object.entries(data)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" | ");

          results.push(row);
        })
        .on("end", () => {
          results.push("");
          results.push(`Total rows: ${rowCount}`);

          this.logger.debug(`Extracted ${rowCount} rows from CSV`);
          resolve({
            text: results.join("\n"),
            extractedText: results.join("\n"),
          });
        })
        .on("error", (error: Error) => {
          this.logger.warn(`CSV parsing error: ${error.message}`);

          try {
            const text = buffer.toString("utf8");
            const lines = text.split(/\r?\n/);
            const fallbackText =
              `=== CSV DATA (Fallback) ===\n` +
              `Delimiter: "${delimiter}"\n\n` +
              lines.join("\n");

            resolve({
              text: fallbackText,
              extractedText: fallbackText,
            });
          } catch {
            reject(new Error(`CSV extraction failed: ${error.message}`));
          }
        });
    });
  }

  private async extractPowerPointText(buffer: Buffer): Promise<{
    text: string;
    extractedText: string;
    additionalMetadata: { slideCount: number; hasNotes: boolean };
  }> {
    try {
      const zip = await unzipper.Open.buffer(buffer);
      const slides = new Map<number, string>();
      const notes = new Map<number, string>();
      let presentationData = "";

      for (const entry of zip.files) {
        if (entry.path === "ppt/presentation.xml") {
          const content = await entry.buffer();
          const xmlString = content.toString("utf8");
          const parsed = await parseStringPromise(xmlString);
          presentationData = this.extractPresentationMetadata(parsed);
        }
      }

      for (const entry of zip.files) {
        if (/ppt\/slides\/slide(\d+)\.xml$/.test(entry.path)) {
          const match = entry.path.match(/slide(\d+)\.xml$/);
          const slideNum = match ? parseInt(match[1]) : 0;

          const content = await entry.buffer();
          const xmlString = content.toString("utf8");
          const parsed = await parseStringPromise(xmlString);
          const slideText = this.extractTextFromXML(parsed);

          if (slideText) {
            slides.set(slideNum, slideText);
          }
        }

        if (/ppt\/notesSlides\/notesSlide(\d+)\.xml$/.test(entry.path)) {
          const match = entry.path.match(/notesSlide(\d+)\.xml$/);
          const slideNum = match ? parseInt(match[1]) : 0;

          const content = await entry.buffer();
          const xmlString = content.toString("utf8");
          const parsed = await parseStringPromise(xmlString);
          const notesText = this.extractTextFromXML(parsed);

          if (notesText) {
            notes.set(slideNum, notesText);
          }
        }
      }

      let allText = "=== POWERPOINT PRESENTATION ===\n";
      if (presentationData) {
        allText += presentationData + "\n";
      }
      allText += `Total Slides: ${slides.size}\n`;
      allText += `Slides with Notes: ${notes.size}\n\n`;

      const maxSlide = Math.max(...slides.keys(), ...notes.keys());

      for (let i = 1; i <= maxSlide; i++) {
        if (slides.has(i)) {
          allText += `\n=== SLIDE ${i} ===\n`;
          allText += slides.get(i) + "\n";

          if (notes.has(i)) {
            allText += `\n--- NOTES ---\n`;
            allText += notes.get(i) + "\n";
          }
        }
      }

      this.logger.debug(
        `Extracted ${slides.size} slides with ${notes.size} note pages`,
      );

      return {
        text: allText,
        extractedText: allText,
        additionalMetadata: {
          slideCount: slides.size,
          hasNotes: notes.size > 0,
        },
      };
    } catch (error) {
      const errorMessage =
        typeof error === "object" && error !== null && "message" in error
          ? (error as { message: string }).message
          : String(error);
      throw new Error(`PowerPoint extraction failed: ${errorMessage}`);
    }
  }
}
