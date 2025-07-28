// components/JupyterNotebookViewer.tsx
import React, { useState, useEffect } from "react";
import { marked } from "marked";
import { IconRefresh } from "@tabler/icons-react";
import { Prism, SyntaxHighlighterProps } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";

const SyntaxHighlighter =
  Prism as unknown as typeof React.Component<SyntaxHighlighterProps>;

interface JupyterNotebookViewerProps {
  content: string;
  className?: string;
}
interface NotebookOutput {
  output_type: "stream" | "execute_result" | "display_data" | "error";
  text?: string[];
  data?: {
    "text/html"?: string | string[];
    "image/png"?: string;
    "image/jpeg"?: string;
    "image/svg+xml"?: string | string[];
    "text/plain"?: string | string[];
    [key: string]: unknown;
  };
  traceback?: string[];
}

interface NotebookCell {
  cell_type: string;
  source: string[] | string;
  execution_count?: number | null;
  outputs?: NotebookOutput[];
  [key: string]: any;
}

interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, any>;
  nbformat: number;
  nbformat_minor: number;
}

export const JupyterNotebookViewer: React.FC<JupyterNotebookViewerProps> = ({
  content,
  className = "",
}) => {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      // Parse the notebook JSON
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsedNotebook: Notebook =
        typeof content === "string" ? JSON.parse(content) : content;

      // Validate basic notebook structure
      if (!parsedNotebook.cells || !Array.isArray(parsedNotebook.cells)) {
        throw new Error("Invalid notebook format: missing cells array");
      }

      setNotebook(parsedNotebook);
      setError(null);
    } catch (err) {
      console.error("Failed to parse notebook:", err);
      setError(
        "Failed to parse the Jupyter notebook file. The file may be corrupted or deleted",
      );
      setNotebook(null);
    } finally {
      setIsLoading(false);
    }
  }, [content]);

  const renderMarkdownCell = (source: string[] | string) => {
    const markdown = Array.isArray(source) ? source.join("") : source;
    const html = marked.parse(markdown) as string;
    return (
      <div
        className="markdown-content py-2"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };

  const renderCodeCell = (cell: NotebookCell) => {
    const source = Array.isArray(cell.source)
      ? cell.source.join("")
      : cell.source;
    const executionCount =
      cell.execution_count !== null ? cell.execution_count : "";

    return (
      <div className="code-cell">
        {/* Input area with execution count */}
        <div className="input-area mb-2">
          <div className="flex items-start">
            <div className="execution-count w-12 text-right pr-2 text-gray-500 font-mono">
              {executionCount !== "" ? `[${executionCount}]:` : "[ ]:"}
            </div>
            <div className="flex-1">
              <SyntaxHighlighter
                language="python"
                style={tomorrow}
                customStyle={{ margin: 0, borderRadius: "0.25rem" }}
              >
                {source}
              </SyntaxHighlighter>
            </div>
          </div>
        </div>

        {/* Output area */}
        {cell.outputs && cell.outputs.length > 0 && (
          <div className="output-area ml-12 mb-4">
            {cell.outputs.map((output, idx) => renderCellOutput(output, idx))}
          </div>
        )}
      </div>
    );
  };

  const renderCellOutput = (output: NotebookOutput, idx: number) => {
    // Handle different output types
    switch (output.output_type) {
      case "stream":
        return (
          <pre
            key={idx}
            className="output-stream bg-gray-100 p-2 rounded text-sm overflow-auto"
          >
            {Array.isArray(output.text) ? output.text.join("") : output.text}
          </pre>
        );

      case "execute_result":
      case "display_data":
        // Try to find the best representation of the data
        if (output.data) {
          // Prefer HTML if available
          if (output.data["text/html"]) {
            return (
              <div
                key={idx}
                className="output-html"
                dangerouslySetInnerHTML={{
                  __html: Array.isArray(output.data["text/html"])
                    ? output.data["text/html"].join("")
                    : output.data["text/html"],
                }}
              />
            );
          }

          // Then try image formats
          if (output.data["image/png"]) {
            return (
              <div key={idx} className="output-image py-2">
                <img
                  src={`data:image/png;base64,${output.data["image/png"]}`}
                  alt="Notebook output"
                  className="max-w-full"
                />
              </div>
            );
          }

          if (output.data["image/jpeg"]) {
            return (
              <div key={idx} className="output-image py-2">
                <img
                  src={`data:image/jpeg;base64,${output.data["image/jpeg"]}`}
                  alt="Notebook output"
                  className="max-w-full"
                />
              </div>
            );
          }

          // SVG
          if (output.data["image/svg+xml"]) {
            return (
              <div
                key={idx}
                className="output-svg py-2"
                dangerouslySetInnerHTML={{
                  __html: Array.isArray(output.data["image/svg+xml"])
                    ? output.data["image/svg+xml"].join("")
                    : output.data["image/svg+xml"],
                }}
              />
            );
          }

          // Fallback to plain text
          if (
            typeof output.data?.["text/plain"] === "string"
              ? output.data["text/plain"]
              : Array.isArray(output.data?.["text/plain"])
                ? output.data["text/plain"].join("")
                : ""
          ) {
            return (
              <pre
                key={idx}
                className="output-text bg-gray-100 p-2 rounded text-sm overflow-auto"
              >
                {Array.isArray(output.data["text/plain"])
                  ? output.data["text/plain"].join("")
                  : output.data["text/plain"]}
              </pre>
            );
          }
        }
        return null;

      case "error":
        return (
          <pre
            key={idx}
            className="output-error bg-red-50 text-red-700 p-2 rounded text-sm overflow-auto"
          >
            {Array.isArray(output.traceback)
              ? output.traceback.join("")
              : output.traceback}
          </pre>
        );

      default:
        return null;
    }
  };

  const renderCell = (cell: NotebookCell, index: number) => {
    return (
      <div key={index} className="notebook-cell border-b border-gray-100 py-2">
        {cell.cell_type === "markdown" && renderMarkdownCell(cell.source)}
        {cell.cell_type === "code" && renderCodeCell(cell)}
        {cell.cell_type !== "markdown" && cell.cell_type !== "code" && (
          <div className="unsupported-cell p-2 text-gray-500">
            Unsupported cell type: {cell.cell_type}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <IconRefresh className="animate-spin h-8 w-8 text-violet-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded">
        <h3 className="font-medium">Error Loading Notebook</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="p-4 bg-yellow-50 text-yellow-800 rounded">
        <h3 className="font-medium">No Notebook Data</h3>
        <p>No notebook data available to display.</p>
      </div>
    );
  }

  return (
    <div className={`jupyter-notebook-viewer ${className}`}>
      {/* Metadata display if needed */}
      {notebook.metadata?.title && (
        <h1 className="text-2xl font-bold mb-4">{notebook.metadata.title}</h1>
      )}

      {/* Render each cell */}
      <div className="notebook-cells">
        {notebook.cells.map((cell, index) => renderCell(cell, index))}
      </div>
    </div>
  );
};
