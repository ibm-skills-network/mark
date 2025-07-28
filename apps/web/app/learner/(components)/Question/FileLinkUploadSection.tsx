import { QuestionStore, QuestionType, ResponseType } from "@/config/types";
import { learnerFileResponse, useLearnerStore } from "@/stores/learner";
import { useState } from "react";
import FileUploadSection from "./FileUploadSection";
import URLQuestion from "./UrlQuestion";

interface FileLinkUploadSectionProps {
  questionId: number;
  questionType: QuestionType;
  responseType: ResponseType;
  question: QuestionStore;
  onModeChange: (
    mode: "file" | "link",
    data: learnerFileResponse[] | string,
    questionId: number,
  ) => void;
}

const FileLinkUploadSection = ({
  questionId,
  questionType,
  responseType,
  question,
  onModeChange,
}: FileLinkUploadSectionProps) => {
  const [isFileUpload, setIsFileUpload] = useState(true);
  const [files, setFiles] = useState<learnerFileResponse[]>([]);
  const [url, setUrl] = useState<string>("");
  const removeFileUpload = useLearnerStore((state) => state.removeFileUpload);
  const toggleUploadType = (type: "file" | "link") => {
    setIsFileUpload(type === "file");
    if (type === "file") onModeChange("file", files, questionId);
    else onModeChange("link", url, questionId);
  };

  const handleFileChange = (updatedFiles: learnerFileResponse[]) => {
    setFiles(updatedFiles);
    if (isFileUpload) onModeChange("file", updatedFiles, questionId);
  };

  const handleUrlChange = (updatedUrl: string) => {
    setUrl(updatedUrl);
    if (!isFileUpload) onModeChange("link", updatedUrl, questionId);
  };

  return (
    <div className="relative overflow-y-auto max-h-[80vh] w-full px-6 py-2">
      <div className="flex justify-end items-center gap-x-4">
        <div className="flex items-center  bg-violet-600 m-2 border-2 border-violet-600 rounded-lg text-white ">
          <button
            type="button"
            onClick={() => toggleUploadType("file")}
            className={`px-4 py-2 rounded-l-md transition-colors ${
              isFileUpload
                ? "bg-violet-600 text-white "
                : "bg-white text-violet-700 hover:bg-gray-50"
            }`}
          >
            File Upload
          </button>
          <button
            type="button"
            onClick={() => toggleUploadType("link")}
            className={`px-4 py-2 rounded-r-md transition-colors ${
              !isFileUpload
                ? "bg-violet-600 text-white "
                : "bg-white text-violet-700 hover:bg-gray-50"
            }`}
          >
            Link Upload
          </button>
        </div>
      </div>

      {isFileUpload ? (
        <FileUploadSection
          question={question}
          responseType={responseType}
          onFileChange={handleFileChange}
          removeFileUpload={removeFileUpload}
        />
      ) : (
        <URLQuestion question={question} onUrlChange={handleUrlChange} />
      )}
    </div>
  );
};

export default FileLinkUploadSection;
