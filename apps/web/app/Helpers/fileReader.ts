/* eslint-disable */

import mammoth from "mammoth";
import Papa, { ParseResult } from "papaparse";
import pdfToText from "react-pdftotext";
import { remark } from "remark";

// Base file content interface.
export interface FileContent {
  filename: string;
  content: string;
  questionId: number;
}

// Extended interface to support binary files via a Blob.
export interface ExtendedFileContent extends FileContent {
  blob?: Blob;
}

// Utility to escape curly braces.
const escapeCurlyBraces = (content: string): string =>
  content.replace(/{/g, "\\{").replace(/}/g, "\\}");

// Sanitize content based on file extension.
const sanitizeContent = (content: string, extension: string): string => {
  const needsEscaping = ["txt", "docx", "md", "csv", "pptx", "pdf"].includes(
    extension,
  );
  return needsEscaping ? escapeCurlyBraces(content) : content;
};

// Helper function that reads a File as an ArrayBuffer and then decodes it to text.
const readFileAsTextFromBuffer = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        const text = new TextDecoder("utf-8").decode(buffer);
        resolve(text);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

/**
 * Reads a plain text file.
 */
export const readAsText = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  readFileAsTextFromBuffer(file).then((text) => {
    const sanitized = sanitizeContent(text, "txt");
    return { filename: file.name, content: sanitized, questionId };
  });

/**
 * Reads a PDF file using react-pdftotext.
 */
export const readPdf = async (
  file: File,
  questionId: number,
): Promise<FileContent> => {
  try {
    // pdfToText accepts a File object directly.
    const content = await pdfToText(file);
    return { filename: file.name, content, questionId };
  } catch (error: unknown) {
    throw new Error(`Error reading PDF: ${String(error)}`);
  }
};

/**
 * Reads a Markdown file using remark.
 */
export const readMarkdown = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  readFileAsTextFromBuffer(file).then(async (text) => {
    try {
      const parsedMarkdown = await remark().process(text);
      const sanitized = sanitizeContent(String(parsedMarkdown), "md");
      return { filename: file.name, content: sanitized, questionId };
    } catch (error) {
      throw new Error(`Error parsing markdown file: ${String(error)}`);
    }
  });

/**
 * Reads a DOCX file using mammoth.
 */
export const readDocx = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await mammoth.extractRawText({
          arrayBuffer: reader.result as ArrayBuffer,
        });
        const sanitized = sanitizeContent(result.value, "docx");
        resolve({ filename: file.name, content: sanitized, questionId });
      } catch (error) {
        reject(`Error reading DOCX file: ${String(error)}`);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

/**
 * Reads a CSV file by decoding the ArrayBuffer to text, then parsing it with PapaParse.
 */
export const readCsv = (file: File, questionId: number): Promise<FileContent> =>
  readFileAsTextFromBuffer(file).then((text) => {
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        complete: (results: ParseResult<unknown>) => {
          const content = JSON.stringify(results.data);
          const sanitized = sanitizeContent(content, "csv");
          resolve({ filename: file.name, content: sanitized, questionId });
        },
        error: reject,
      });
    });
  });

/**
 * Reads a Jupyter Notebook (.ipynb) file, including cell outputs, with debug logging.
 */
export const readIpynb = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  readFileAsTextFromBuffer(file).then((text) => {
    try {
      const notebook = JSON.parse(text);
      const cellContents = (notebook.cells as Array<any>)
        .map((cell, index) => {
          let content = "";

          if (cell.source) {
            content += Array.isArray(cell.source)
              ? cell.source.join("")
              : cell.source;
          }

          if (cell.outputs) {
            console.log(
              `Cell #${index} outputs:`,
              JSON.stringify(cell.outputs, null, 2),
            );
          }

          if (cell.outputs && Array.isArray(cell.outputs)) {
            const outputText = cell.outputs
              .map((output) => {
                if (output.text) {
                  return Array.isArray(output.text)
                    ? output.text.join("")
                    : output.text;
                }
                if (output.data && output.data["text/plain"]) {
                  return Array.isArray(output.data["text/plain"])
                    ? output.data["text/plain"].join("")
                    : output.data["text/plain"];
                }
                if (output.output_type === "stream" && output.text) {
                  return Array.isArray(output.text)
                    ? output.text.join("")
                    : output.text;
                }
                if (output.output_type === "error") {
                  return output.ename + ": " + output.evalue;
                }
                return "";
              })
              .filter((out) => out.length > 0)
              .join("\n");

            if (outputText) {
              content += `\n\n[Output]:\n${outputText}`;
            }
          }

          return content;
        })
        .filter((content) => content.length > 0)
        .join("\n\n");

      const sanitized = sanitizeContent(cellContents, "ipynb");
      return { filename: file.name, content: sanitized, questionId };
    } catch (error) {
      console.error("Error parsing notebook:", error);
      throw new Error(`Error parsing Jupyter Notebook: ${String(error)}`);
    }
  });

export const readPptx = async (
  file: File,
  questionId: number,
): Promise<FileContent> => {
  try {
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    const sanitized = sanitizeContent(result.value, "pptx");
    console.log("PPTX content:", sanitized);
    return { filename: file.name, content: sanitized, questionId };
  } catch (error) {
    throw new Error(`Error reading PowerPoint: ${String(error)}`);
  }
};

/**
 * Reads plain text files (e.g. code files) using the ArrayBuffer approach.
 */
export const readPlainText = (
  file: File,
  questionId: number,
  extension: string,
): Promise<FileContent> =>
  readFileAsTextFromBuffer(file).then((text) => {
    const sanitized = sanitizeContent(text, extension);
    return { filename: file.name, content: sanitized, questionId };
  });

/**
 * Main readFile function that routes to the appropriate helper based on file extension.
 */
export const readFile = async (
  file: File,
  questionId: number,
): Promise<ExtendedFileContent> => {
  // supported file types txt, pdf, md, docx, csv, pptx, ipynb, py, js, sh, html, css, sql, ts, tsx
  const extension = file.name.split(".").pop()?.toLowerCase();
  console.log("Reading file with extension:", extension);
  switch (extension) {
    case "txt":
      return readAsText(file, questionId);
    case "pdf":
      return readPdf(file, questionId);
    case "md":
      return readMarkdown(file, questionId);
    case "docx":
      return readDocx(file, questionId);
    case "csv":
      return readCsv(file, questionId);
    case "pptx":
      return readPptx(file, questionId);
    case "ipynb":
      return readIpynb(file, questionId);
    // For code and other text-based files:
    case "py":
    case "js":
    case "sh":
    case "html":
    case "css":
    case "sql":
    case "tsx":
    case "ts":
      return readPlainText(file, questionId, extension);
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
};
