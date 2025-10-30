import React from "react";
import { IconX, IconCheck, IconCopy } from "@tabler/icons-react";
import { formatFileSize, getFileExtension } from "./utils/fileUtils";
import { getFileIcon } from "./FileExplorer";
import { FileObject } from "../../stores/fileStore";

interface FilePropertiesProps {
  file: FileObject;
  onClose: () => void;
}

const FileProperties: React.FC<FilePropertiesProps> = ({ file, onClose }) => {
  const [copySuccess, setCopySuccess] = React.useState<string | null>(null);

  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(field);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  };

  const renderField = (label: string, value: string, fieldName: string) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-500 mb-1">
        {label}
      </label>
      <div className="flex items-center">
        <div className="flex-1 bg-gray-50 p-2 rounded border border-gray-200 text-sm break-all">
          {value}
        </div>
        <button
          onClick={() => copyToClipboard(value, fieldName)}
          className="ml-2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
          title="Copy to clipboard"
        >
          {copySuccess === fieldName ? (
            <IconCheck size={18} className="text-green-500" />
          ) : (
            <IconCopy size={18} />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">File Properties</h3>
          <button
            className="text-gray-400 hover:text-gray-600"
            onClick={onClose}
          >
            <IconX size={20} />
          </button>
        </div>

        <div className="file-info mb-6">
          <div className="flex items-center mb-4">
            {getFileIcon(file, 32)}
            <div className="ml-3">
              <h4 className="font-medium">{file.fileName}</h4>
              <p className="text-sm text-gray-500">
                {getFileExtension(file.fileName).toUpperCase()} File
              </p>
            </div>
          </div>

          {renderField("File Name", file.fileName, "fileName")}
          {renderField("Location", file.path || "/", "path")}

          <div className="grid grid-cols-2 gap-4">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-500 mb-1">
                Size
              </label>
              <div className="bg-gray-50 p-2 rounded border border-gray-200 text-sm">
                {formatFileSize(file.fileSize)}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-500 mb-1">
                Type
              </label>
              <div className="bg-gray-50 p-2 rounded border border-gray-200 text-sm">
                {file.fileType ||
                  `${getFileExtension(file.fileName).toUpperCase()} File`}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              Created
            </label>
            <div className="bg-gray-50 p-2 rounded border border-gray-200 text-sm">
              {formatDate(file.createdAt)}
            </div>
          </div>

          {renderField("Object Key", file.cosKey || "", "cosKey")}

          {file.id && renderField("File ID", file.id, "id")}
        </div>

        <div className="flex justify-end">
          <button
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileProperties;
