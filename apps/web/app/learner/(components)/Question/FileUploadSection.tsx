import { QuestionStore, ResponseType } from "@/config/types";
import { getUploadAcceptMap } from "@/lib/upload-accept";
import {
  learnerFileResponse,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import CustomFileViewer from "./FileViewer";
import FileUploader from "@/components/FileUploader";
import InAppBrowserUploadNotice from "./InAppBrowserUploadNotice";

interface FileUploadSectionProps {
  question: QuestionStore;
  responseType: ResponseType;
  onFileChange: (files: learnerFileResponse[], questionId: number) => void;
  removeFileUpload: (file: learnerFileResponse, questionId: number) => void;
}

const FileUploadSection = ({
  question,
  removeFileUpload,
}: FileUploadSectionProps) => {
  const questionId = question.id;
  const questionType = question.type;
  const responseType = question.responseType;
  const [currentFileContent, setCurrentFileContent] = useState<string | null>(
    null,
  );
  const addFileUpload = useLearnerStore((state) => state.addFileUpload);
  const setQuestionUploadStatus = useLearnerStore(
    (state) => state.setQuestionUploadStatus,
  );
  // Whether the latest upload on this question failed, so the submit guard
  // can name it once the uploader goes idle.
  const lastUploadFailedRef = useRef(false);
  const [showContent, setShowContent] = useState(false);
  const learnerFileResponse = useLearnerStore((state) =>
    state.getFileUpload(questionId),
  );
  const activeAttemptId = useLearnerStore((state) => state.activeAttemptId);
  const [fileBlob] = useState<Blob | null>(null);
  const closePreview = () => {
    setShowContent(false);
    setCurrentFileContent(null);
  };
  const [filename] = useState<string>("");
  const assignmentId =
    useLearnerOverviewStore((state) => state.assignmentId) ||
    parseInt(usePathname().split("/")[2]);

  return (
    <motion.div
      className="relative overflow-y-auto max-h-[80vh] w-full p-2"
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 50, opacity: 0 }}
    >
      <div className="flex flex-1">
        <div className="flex flex-col gap-4 pr-4 w-full">
          <InAppBrowserUploadNotice />
          <FileUploader
            key={`file-uploader-${questionId}`}
            uploadType={"learner"}
            attemptId={activeAttemptId ?? undefined}
            context={{
              assignmentId,
              questionId,
            }}
            onUploadComplete={(file: learnerFileResponse) => {
              lastUploadFailedRef.current = false;
              addFileUpload(file, questionId);
            }}
            onDeleteComplete={(key: string) => {
              const fileToDelete = learnerFileResponse.find(
                (file) => file.key === key,
              );
              if (fileToDelete) {
                removeFileUpload(fileToDelete, questionId);
              }
            }}
            onUploadError={() => {
              lastUploadFailedRef.current = true;
            }}
            onUploadStateChange={(isUploading) => {
              if (isUploading) {
                lastUploadFailedRef.current = false;
                setQuestionUploadStatus(questionId, "uploading");
                return;
              }
              setQuestionUploadStatus(
                questionId,
                lastUploadFailedRef.current ? "failed" : null,
              );
            }}
            showUploadedFiles={true}
            uploadedFiles={learnerFileResponse}
            acceptedFileTypes={getUploadAcceptMap(questionType, responseType)}
          />
        </div>
      </div>

      {showContent && (
        <CustomFileViewer
          file={{
            filename,
            content: currentFileContent,
            blob: fileBlob,
          }}
          onClose={closePreview}
        />
      )}
    </motion.div>
  );
};

export default FileUploadSection;
