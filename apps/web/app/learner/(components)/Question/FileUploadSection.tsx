// FileUploadSection.js
import { readFile } from "@/app/Helpers/fileReader";
import MarkdownViewer from "@/components/MarkdownViewer";
import { QuestionType } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";
import { IconCloudUpload, IconEye, IconX } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";

const MAX_CHAR_LIMIT = 40000;

interface FileUploadSectionProps {
  questionId: number;
  questionType: QuestionType;
}

const FileUploadSection = ({
  questionId,
  questionType,
}: FileUploadSectionProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [currentFileContent, setCurrentFileContent] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);

  const getFileUpload = useLearnerStore((state) => state.getFileUpload);
  const setFileUpload = useLearnerStore((state) => state.setFileUpload);
  const deleteFile = useLearnerStore((state) => state.deleteFile);

  useEffect(() => {
    const storedFiles = getFileUpload(questionId);
    if (storedFiles) {
      setFiles(
        storedFiles.map((file) => new File([file.content], file.filename)),
      );
    }
  }, [questionId]);

  const onDrop = async (acceptedFiles: File[]) => {
    const newFiles = [...files, ...acceptedFiles];
    setFiles(newFiles);

    try {
      const fileContents = await Promise.all(
        acceptedFiles.map(async (file) => {
          const result = await readFile(file, questionId);
          return {
            filename: file.name,
            content: truncateContent(result.content),
            questionId,
          };
        }),
      );
      setFileUpload(fileContents, questionId); // Merge new files with existing ones in store
    } catch (error) {
      setError(error as string);
    }
  };

  const truncateContent = (content: string) => {
    return content.length > MAX_CHAR_LIMIT
      ? content.substring(0, MAX_CHAR_LIMIT) + "..."
      : content;
  };

  const showFileContent = async (file: File) => {
    try {
      const result = await readFile(file, questionId);
      setCurrentFileContent(result.content);
      setShowContent(true);
    } catch (error) {
      setError("Failed to load file content.");
    }
  };

  const closePreview = () => {
    setShowContent(false);
    setCurrentFileContent(null);
  };

  const handleDeleteFile = (file: File) => {
    const updatedFiles = files.filter((f) => f.name !== file.name);
    setFiles(updatedFiles);

    // Update the store
    deleteFile(file, questionId);
  };

  const getAcceptedFileTypes = (questionType: QuestionType) => {
    switch (questionType) {
      case "CODE":
        return {
          "text/x-python": [".py"],
          "application/javascript": [".js"],
          "application/x-typescript": [".ts"],
          "application/x-tsx": [".tsx"],
          "application/x-shellscript": [".sh"],
          "text/html": [".html"],
          "text/css": [".css"],
          "application/sql": [".sql"],
          "text/markdown": [".md"],
          "application/x-ipynb+json": [".ipynb"],
        };
      case "IMAGES":
        return {
          "image/jpeg": [".jpg", ".jpeg"],
          "image/png": [".png"],
          "image/gif": [".gif"],
          "image/svg+xml": [".svg"],
        };
      case "UPLOAD":
        return {
          "text/plain": [".txt"],
          "application/pdf": [".pdf"],
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            [".docx"],
          "application/vnd.ms-excel": [".xls", ".xlsx"],
          "text/csv": [".csv"],
          "text/markdown": [".md"],
          "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            [".pptx"],
          "application/x-ipynb+json": [".ipynb"],
        };
      default:
        return {}; // No files allowed by default
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: getAcceptedFileTypes(questionType),
    multiple: true,
  });

  return (
    <motion.div
      className="relative overflow-y-auto max-h-[80vh] w-full px-6 py-2"
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 50, opacity: 0 }}
    >
      <div {...getRootProps()} className="w-full">
        <motion.div
          whileHover={{ scale: 1.02 }}
          className={`flex flex-col items-center justify-center border-2 border-dashed p-6 rounded-md cursor-pointer transition-colors ${
            isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-300"
          }`}
        >
          <input {...getInputProps()} />
          <IconCloudUpload size={50} className="text-gray-500 mb-4" />
          {isDragActive ? (
            <p className="text-blue-500">Drop the files here...</p>
          ) : (
            <p className="text-gray-500">
              Drag & drop some files here, or click to select files
            </p>
          )}
        </motion.div>
      </div>

      <div className="mt-4">
        {files.length > 0 ? (
          <ul className="text-gray-600">
            {files.map((file) => (
              <li
                className="flex items-center justify-between bg-gray-100 rounded-md px-3 py-2 mb-2"
                key={file.name}
              >
                <div className="flex items-center justify-between w-full">
                  <span>{file.name}</span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => showFileContent(file)}
                      className="text-blue-500 hover:text-blue-600"
                      aria-label={`Preview file ${file.name}`}
                    >
                      <IconEye size={20} />
                    </button>
                    <button
                      onClick={() => handleDeleteFile(file)}
                      className="text-red-500 hover:text-red-600"
                      aria-label={`Remove file ${file.name}`}
                    >
                      <IconX size={20} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No files uploaded yet.</p>
        )}
      </div>

      {/* Modal for file content preview */}
      {showContent && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">File Content Preview</h2>
            <MarkdownViewer className="text-sm whitespace-pre-wrap bg-gray-100 p-4 rounded-md text-gray-600">
              {currentFileContent}
            </MarkdownViewer>
            <button
              onClick={closePreview}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default FileUploadSection;
