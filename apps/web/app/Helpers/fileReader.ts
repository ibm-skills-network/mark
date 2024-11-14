import mammoth from "mammoth";
import Papa, { ParseResult } from "papaparse";
import pdfToText from "react-pdftotext";
import { remark } from "remark";

const escapeCurlyBraces = (content: string): string =>
  content.replace(/{/g, "\\{").replace(/}/g, "\\}");

const sanitizeContent = (content: string, extension: string): string => {
  // Escape curly braces for non-code files to avoid LLM prompt issues
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

// Helper function to read text-based files as plain text
export const readAsText = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const sanitized = sanitizeContent(reader.result as string, "txt");
      resolve({ filename: file.name, content: sanitized, questionId });
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });

// Helper function to read PDF files using react-pdftotext
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

// Helper function to read and parse Markdown files using remark
export const readMarkdown = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const markdownContent = reader.result as string;
        const parsedMarkdown = await remark().process(markdownContent);
        const sanitized = sanitizeContent(String(parsedMarkdown), "md");
        resolve({ filename: file.name, content: sanitized, questionId });
      } catch (error) {
        reject(`Error parsing markdown file: ${String(error)}`);
      }
    };
    reader.onerror = () => reject("Error reading the file.");
    reader.readAsText(file);
  });

// Helper function to read DOCX files
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

// Helper function to read CSV files
export const readCsv = (file: File, questionId: number): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    Papa.parse(file, {
      complete: (results: ParseResult<unknown>) => {
        const content = JSON.stringify(results.data);
        const sanitized = sanitizeContent(content, "csv");
        resolve({ filename: file.name, content: sanitized, questionId });
      },
      error: reject,
    });
  });
export const readIpynb = (
  file: File,
  questionId: number,
): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const notebook: {
          cells: Array<{
            cell_type: string;
            source: string | string[];
          }>;
        } = JSON.parse(reader.result as string) as {
          cells: Array<{
            cell_type: string;
            source: string | string[];
          }>;
        };
        const cellContents = (
          notebook.cells as Array<{
            cell_type: string;
            source: string | string[];
          }>
        )
          .map((cell) => {
            if (cell.cell_type === "code" || cell.cell_type === "markdown") {
              if (Array.isArray(cell.source)) {
                return cell.source.join("");
              } else if (typeof cell.source === "string") {
                return cell.source;
              }
            }
            return "";
          })
          .filter((content) => content.length > 0) // Filter out any empty cells
          .join("\n\n");
        const sanitized = sanitizeContent(cellContents, "ipynb");
        resolve({
          filename: file.name,
          content: JSON.stringify(sanitized),
          questionId,
        });
      } catch (error) {
        console.error("Error parsing notebook:", error);
        reject(`Error parsing Jupyter Notebook: ${String(error)}`);
      }
    };

    reader.onerror = () => {
      console.error("File reading error:", reader.error);
      reject(`File reading error: ${reader.error?.message || "Unknown error"}`);
    };

    reader.readAsText(file);
  });

// Helper function to read PPTX files
export const readPptx = async (
  file: File,
  questionId: number,
): Promise<FileContent> => {
  try {
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    const sanitized = sanitizeContent(result.value, "pptx");
    return { filename: file.name, content: sanitized, questionId };
  } catch (error) {
    throw new Error(`Error reading PowerPoint: ${String(error)}`);
  }
};

// Helper function to read plain text files
export const readPlainText = (
  file: File,
  questionId: number,
  extenstion: string,
): Promise<FileContent> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const sanitized = sanitizeContent(reader.result as string, extenstion);
      resolve({ filename: file.name, content: sanitized, questionId });
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });

export const readFile = async (
  file: File,
  questionId: number,
): Promise<FileContent> => {
  // supported file types: txt, pdf, md, docx, csv, pptx, ipynb, py, js, sh, html, css, sql, tsx
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
