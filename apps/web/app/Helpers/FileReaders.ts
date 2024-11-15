import { remark } from "remark";
import mammoth from "mammoth";
import Papa from "papaparse";
import pdfToText from "react-pdftotext";

const sanitizeContent = (content: string): string =>
  content.replace(/[{}]/g, "");

// Helper function to read text files
export const readAsText = (file: File) =>
  new Promise<{ filename: string; content: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const sanitized = sanitizeContent(reader.result as string);
      resolve({ filename: file.name, content: sanitized });
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });

// Helper function to read PDF files using react-pdftotext
export const readPdf = async (
  file: File,
): Promise<{ filename: string; content: string }> => {
  try {
    const content = await pdfToText(file); // Extract text using react-pdftotext
    return { filename: file.name, content };
  } catch (error: unknown) {
    throw new Error(`Error reading PDF: ${error as string}`);
  }
};

// Helper function to read and parse Markdown files using remark
export const readMarkdown = (file: File) =>
  new Promise<{ filename: string; content: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const markdownContent = reader.result as string;
        const parsedMarkdown = await remark().process(markdownContent); // Parse markdown content using remark
        const sanitized = sanitizeContent(String(parsedMarkdown));
        resolve({ filename: file.name, content: sanitized });
      } catch (error) {
        reject(`Error parsing markdown file: ${error as string}`);
      }
    };
    reader.onerror = () => reject("Error reading the file.");
    reader.readAsText(file); // Read file as text
  });

// Helper function to read DOCX files
export const readDocx = (file: File) =>
  new Promise<{ filename: string; content: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await mammoth.extractRawText({
          arrayBuffer: reader.result as ArrayBuffer,
        });
        const sanitized = sanitizeContent(result.value);
        resolve({ filename: file.name, content: sanitized });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });

// Helper function to read CSV files
export const readCsv = (file: File) =>
  new Promise<{ filename: string; content: string }>((resolve, reject) => {
    Papa.parse(file, {
      complete: (results: { data: any }) => {
        const content = JSON.stringify(results.data); // Convert CSV to JSON or raw string
        const sanitized = sanitizeContent(content);
        resolve({ filename: file.name, content: sanitized });
      },
      error: reject,
    });
  });
