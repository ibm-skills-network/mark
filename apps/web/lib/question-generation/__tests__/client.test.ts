import { AssignmentTypeEnum, QuestionGenerationPayload } from "@/config/types";
import { getJobStatus, uploadFiles } from "@/lib/talkToBackend";
import {
  pollQuestionGenerationJob,
  startQuestionGenerationJob,
} from "../client";

jest.mock("@/lib/talkToBackend", () => ({
  uploadFiles: jest.fn(),
  getJobStatus: jest.fn(),
}));

describe("question-generation client helpers", () => {
  const mockUploadFiles = uploadFiles as jest.MockedFunction<typeof uploadFiles>;
  const mockGetJobStatus = getJobStatus as jest.MockedFunction<
    typeof getJobStatus
  >;

  const payload: QuestionGenerationPayload = {
    assignmentId: 1,
    assignmentType: AssignmentTypeEnum.PRACTICE,
    questionsToGenerate: {
      multipleChoice: 1,
      multipleSelect: 0,
      textResponse: 0,
      trueFalse: 0,
      url: 0,
      upload: 0,
      linkFile: 0,
      responseTypes: {
        TEXT: "OTHER",
        URL: "OTHER",
        UPLOAD: "OTHER",
        LINK_FILE: "OTHER",
      },
    },
    fileContents: [],
    learningObjectives: "Understand core concepts",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("startQuestionGenerationJob", () => {
    it("returns jobId when backend starts a generation job", async () => {
      mockUploadFiles.mockResolvedValue({ success: true, jobId: 321 });

      await expect(startQuestionGenerationJob(payload)).resolves.toBe(321);
      expect(mockUploadFiles).toHaveBeenCalledWith(payload);
    });

    it("throws when backend does not return a jobId", async () => {
      mockUploadFiles.mockResolvedValue({ success: false });

      await expect(startQuestionGenerationJob(payload)).rejects.toThrow(
        "Failed to upload files",
      );
    });
  });

  describe("pollQuestionGenerationJob", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it("polls status updates until completion", async () => {
      mockGetJobStatus
        .mockResolvedValueOnce({
          status: "In Progress",
          progress: "Generating...",
          progressPercentage: "50",
        })
        .mockResolvedValueOnce({
          status: "Completed",
          progress: "Done",
          progressPercentage: "100",
          questions: [],
        });

      const onUpdate = jest.fn();
      const onCompleted = jest.fn();
      const onFailed = jest.fn();
      const onError = jest.fn();

      const stop = pollQuestionGenerationJob({
        jobId: 123,
        intervalMs: 2500,
        onUpdate,
        onCompleted,
        onFailed,
        onError,
      });

      await jest.advanceTimersByTimeAsync(2500);
      await jest.advanceTimersByTimeAsync(2500);

      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ status: "Completed" }),
      );
      expect(onFailed).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();

      stop();
    });

    it("stops and calls onFailed when job fails", async () => {
      mockGetJobStatus.mockResolvedValue({
        status: "Failed",
        progress: "Failed",
        progressPercentage: "50",
      });

      const onUpdate = jest.fn();
      const onCompleted = jest.fn();
      const onFailed = jest.fn();
      const onError = jest.fn();

      pollQuestionGenerationJob({
        jobId: 456,
        intervalMs: 2500,
        onUpdate,
        onCompleted,
        onFailed,
        onError,
      });

      await jest.advanceTimersByTimeAsync(2500);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onFailed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "Failed" }),
      );
      expect(onCompleted).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it("calls onError when status fetch fails", async () => {
      mockGetJobStatus.mockResolvedValue(undefined);

      const onUpdate = jest.fn();
      const onCompleted = jest.fn();
      const onFailed = jest.fn();
      const onError = jest.fn();

      pollQuestionGenerationJob({
        jobId: 789,
        intervalMs: 2500,
        onUpdate,
        onCompleted,
        onFailed,
        onError,
      });

      await jest.advanceTimersByTimeAsync(2500);

      expect(onUpdate).not.toHaveBeenCalled();
      expect(onCompleted).not.toHaveBeenCalled();
      expect(onFailed).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });
});
