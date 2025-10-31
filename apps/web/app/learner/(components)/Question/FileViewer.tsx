import FeedbackFormatter from "@/components/FeedbackFormatter";
import { IconX } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Prism, SyntaxHighlighterProps } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";

const SyntaxHighlighter =
  Prism as unknown as typeof React.Component<SyntaxHighlighterProps>;

interface FileViewerProps {
  file: {
    filename: string;
    content: string;
    blob: Blob;
  };
  onClose: () => void;
}

const FileViewer = ({ file, onClose }: FileViewerProps) => {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [file]);

  const extension: string =
    file.filename.split(".").pop()?.toLowerCase().toString() || "";
  const renderContent = () => {
    switch (extension) {
      case "txt":
      case "md":
      case "csv":
      case "ipynb":
      case "docx":
      case "pptx":
      case "pdf":
        return (
          <FeedbackFormatter className="text-sm whitespace-pre-wrap bg-gray-100 p-4 rounded-md text-gray-600">
            {file.content}
          </FeedbackFormatter>
        );

      case "py":
      case "js":
      case "ts":
      case "tsx":
      case "html":
      case "css":
      case "sql":
      case "sh":
      case "yaml":
      case "json":
      case "xml":
      case "yml":
        return (
          <SyntaxHighlighter language={extension} style={tomorrow}>
            {file.content}
          </SyntaxHighlighter>
        );

      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "svg":
        return (
          <div className="flex justify-center">
            <img
              src={file.content}
              alt={file.filename}
              className="max-w-full max-h-[80vh] object-contain rounded-md"
            />
          </div>
        );

      default:
        return (
          <FeedbackFormatter className="whitespace-pre-wrap p-4">
            Unsupported file type: {extension}
          </FeedbackFormatter>
        );
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white p-6 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">
            File Content Preview: {file.filename}
          </h2>
          <button onClick={onClose} aria-label="Close">
            <IconX size={20} className="text-red-500" />
          </button>
        </div>
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-violet-600"></div>
          </div>
        ) : (
          renderContent()
        )}
      </div>
    </div>
  );
};

export default FileViewer;
