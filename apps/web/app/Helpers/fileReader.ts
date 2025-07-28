/* eslint-disable */

import JSZip from "jszip";
import mammoth from "mammoth";
import Papa, { ParseResult } from "papaparse";
import pdfToText from "react-pdftotext";
import { remark } from "remark";
import * as XLSX from "xlsx";

/**
 * Reads an Excel file (XLSX or XLS) using SheetJS.
 */
export const readExcel = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const workbook = XLSX.read(reader.result, {
          type: "array",
          cellStyles: true,
          cellFormula: true,
          cellDates: true,
          cellNF: true,
          sheetStubs: true,
        });
        const result = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          return {
            sheetName,
            data: jsonData,
          };
        });

        const content = JSON.stringify(result);
        const sanitized = sanitizeContent(
          content,
          file.name.split(".").pop() || "",
        );
        resolve({ filename: file.name, content: sanitized, questionId });
      } catch (error) {
        reject(`Error reading Excel file: ${String(error)}`);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
const escapeCurlyBraces = (content: string): string =>
  content.replace(/{/g, "\\{").replace(/}/g, "\\}");

const sanitizeContent = (content: string, extension: string): string => {
  const needsEscaping = ["txt", "docx", "md", "csv", "pptx", "pdf"].includes(
    extension,
  );
  return needsEscaping ? escapeCurlyBraces(content) : content;
};
interface FileContent {
  filename: string;
  content: string;
  questionId: number;
}

export interface ExtendedFileContent extends FileContent {
  blob?: Blob;
  url?: string;
  extension?: string;
  metadata?: Record<string, any>;
  type?: string;
  arrayBuffer?: ArrayBuffer;
}

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
      throw new Error(`Error parsing Jupyter Notebook: ${String(error)}`);
    }
  });

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
 * Reads a PPTX file (PowerPoint) by extracting only the text from each slide.
 *
 * @param file - The PPTX file to be processed.
 * @param questionId - An associated question ID.
 * @returns A Promise that resolves to a FileContent object containing the extracted text.
 */
export const readPptx = async (
  file: File,
  questionId: number,
): Promise<FileContent> => {
  try {
    const zip = await JSZip.loadAsync(file);

    const slideFilenames = Object.keys(zip.files).filter((filename) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(filename),
    );

    slideFilenames.sort((a, b) => {
      const matchA = a.match(/slide(\d+)\.xml/);
      const matchB = b.match(/slide(\d+)\.xml/);
      const numA = matchA ? parseInt(matchA[1], 10) : 0;
      const numB = matchB ? parseInt(matchB[1], 10) : 0;
      return numA - numB;
    });

    let presentationText = "";

    for (const slideFilename of slideFilenames) {
      try {
        const slideXml = await zip.file(slideFilename)?.async("string");
        if (slideXml) {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(slideXml, "application/xml");

          const textElements = xmlDoc.getElementsByTagName("a:t");
          let slideText = "";
          for (let i = 0; i < textElements.length; i++) {
            if (textElements[i].textContent) {
              slideText += textElements[i].textContent + " ";
            }
          }
          slideText = slideText.trim();

          if (slideText) {
            presentationText += slideText + "\n\n";
          }
        }
      } catch (err) {}
    }

    const sanitized = sanitizeContent(presentationText, "pptx");

    return { filename: file.name, content: sanitized, questionId };
  } catch (error) {
    throw new Error(`Error reading PowerPoint: ${error}`);
  }
};
/**
 * Reads an image file and returns a FileContent object.
 * The file content is set to the image’s base64 data URL.
 */
export const readImage = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        filename: file.name,
        content: reader.result as string,
        questionId,
      });
    };
    reader.onerror = reject;

    reader.readAsDataURL(file);
  });

/**
 * Main readFile function that routes to the appropriate helper based on file extension.
 */
export const readFile = async (
  file: File,
  questionId: number,
): Promise<ExtendedFileContent> => {
  const extension = file.name.split(".").pop()?.toLowerCase();
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
    case "xlsx":
    case "xls":
      return readExcel(file, questionId);

    case "py":
    case "js":
    case "sh":
    case "html":
    case "css":
    case "sql":
    case "tsx":
    case "ts":
      return readPlainText(file, questionId, extension);

    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "svg":
      return readImage(file, questionId);
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
};
