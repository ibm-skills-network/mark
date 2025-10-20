/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable unicorn/no-null */
import { Test, TestingModule } from "@nestjs/testing";
import { firstValueFrom } from "rxjs";
import { PrismaService } from "src/database/prisma.service";
import {
  createMockJob,
  createMockPrismaService,
} from "../__mocks__/ common-mocks";
import { JobStatusServiceV2 } from "../../../services/job-status.service";

describe("JobStatusServiceV2", () => {
  let jobStatusService: JobStatusServiceV2;
  let prismaService: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prismaService = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobStatusServiceV2,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    jobStatusService = module.get<JobStatusServiceV2>(JobStatusServiceV2);
  });

  afterEach(() => {
    jest.clearAllMocks();

    for (const [jobId, subject] of (
      jobStatusService as any
    ).jobStatusStreams.entries()) {
      subject.complete();
      (jobStatusService as any).jobStatusStreams.delete(jobId);
    }

    if (global.setTimeout !== setTimeout) {
      global.setTimeout = setTimeout;
    }

    jest.useRealTimers();
  });

  describe("createJob", () => {
    it("should create a new job", async () => {
      const assignmentId = 1;
      const userId = "author-123";
      const mockJob = createMockJob({ assignmentId, userId }, "Pending");
      prismaService.job.create.mockResolvedValue(mockJob);

      const result = await jobStatusService.createJob(assignmentId, userId);

      expect(prismaService.job.create).toHaveBeenCalledWith({
        data: {
          assignmentId,
          userId,
          status: "Pending",
          progress: "Job created",
        },
      });
      expect(result).toEqual(mockJob);
    });
  });

  describe("createPublishJob", () => {
    it("should create a new publish job", async () => {
      const assignmentId = 1;
      const userId = "author-123";
      const mockJob = createMockJob({ assignmentId, userId }, "In Progress");
      prismaService.publishJob.create.mockResolvedValue(mockJob);

      const result = await jobStatusService.createPublishJob(
        assignmentId,
        userId,
      );

      expect(prismaService.publishJob.create).toHaveBeenCalledWith({
        data: {
          assignmentId,
          userId,
          status: "In Progress",
          progress: "Initializing assignment publishing...",
        },
      });
      expect(result).toEqual(mockJob);
    });
  });

  describe("getJobStatus", () => {
    it("should get job status by ID", async () => {
      const jobId = 1;
      const mockJob = createMockJob({ id: jobId });
      prismaService.job.findUnique.mockResolvedValue(mockJob);

      const result = await jobStatusService.getJobStatus(jobId);

      expect(prismaService.job.findUnique).toHaveBeenCalledWith({
        where: { id: jobId },
      });
      expect(result).toEqual(mockJob);
    });

    it("should return null if job not found", async () => {
      const jobId = 999;
      prismaService.job.findUnique.mockResolvedValue(null);

      const result = await jobStatusService.getJobStatus(jobId);

      expect(prismaService.job.findUnique).toHaveBeenCalledWith({
        where: { id: jobId },
      });
      expect(result).toBeNull();
    });
  });

  describe("getPublishJobStatusStream", () => {
    it("should create and return an observable with initial connection message", async () => {
      const jobId = 1;

      const stream = jobStatusService.getPublishJobStatusStream(jobId);
      const result = await firstValueFrom(stream);

      expect(result).toEqual({
        type: "update",
        data: { message: "Connecting to job status stream..." },
      });
    });

    it("should throw an error if job status stream not found after creation", () => {
      const jobId = 1;

      const originalMapGet = Map.prototype.get;
      Map.prototype.get = jest.fn().mockReturnValue(undefined);

      expect(() => {
        jobStatusService.getPublishJobStatusStream(jobId);
      }).toThrow(`Job status stream for jobId ${jobId} not found.`);

      Map.prototype.get = originalMapGet;
    });

    it("should handle errors in the observable stream", async () => {
      const jobId = 1;
      const errorMessage = "Test error";

      jobStatusService.getPublishJobStatusStream(jobId);
      const subject = (jobStatusService as any).jobStatusStreams.get(jobId);

      jest.spyOn(subject, "next").mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const stream = jobStatusService.getPublishJobStatusStream(jobId);

      const firstEvent = await firstValueFrom(stream);
      expect(firstEvent).toEqual({
        type: "update",
        data: { message: "Connecting to job status stream..." },
      });

      try {
        subject.next({} as MessageEvent);
        fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(errorMessage);
      }
    });
    describe("cleanupJobStream", () => {
      it("should complete and remove a job stream", async () => {
        const jobId = 1;

        jobStatusService.getPublishJobStatusStream(jobId);

        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "complete");

        await jobStatusService.cleanupJobStream(jobId);

        expect(subject.complete).toHaveBeenCalled();
        expect((jobStatusService as any).jobStatusStreams.has(jobId)).toBe(
          false,
        );
      });

      it("should do nothing if job stream does not exist", async () => {
        const jobId = 999;

        (jobStatusService as any).jobStatusStreams.clear();

        await jobStatusService.cleanupJobStream(jobId);

        expect((jobStatusService as any).jobStatusStreams.size).toBe(0);
      });
    });
    // describe("updateJobStatus", () => {
    //   it("should update job status for a regular job", async () => {
    //     const jobId = 1;
    //     const statusUpdate = {
    //       status: "In Progress",
    //       progress: "Processing data",
    //       percentage: 50,
    //     };

    //     prismaService.publishJob.findUnique.mockResolvedValue(null);
    //     prismaService.job.update.mockResolvedValue({
    //       id: jobId,
    //       ...statusUpdate,
    //     } as unknown as Job);

    //     jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

    //     await jobStatusService.updateJobStatus(jobId, statusUpdate);

    //     expect(prismaService.job.update).toHaveBeenCalledWith({
    //       where: { id: jobId },
    //       data: {
    //         status: statusUpdate.status,
    //         progress: statusUpdate.progress,
    //         result: undefined,
    //         updatedAt: expect.any(Date),
    //       },
    //     });
    //     expect(
    //       (jobStatusService as any).emitJobStatusUpdate,
    //     ).toHaveBeenCalledWith(jobId, {
    //       ...statusUpdate,
    //       progress: statusUpdate.progress,
    //       percentage: statusUpdate.percentage,
    //     });
    //   });

    //   it("should update job status for a publish job", async () => {
    //     const jobId = 1;
    //     const statusUpdate = {
    //       status: "In Progress",
    //       progress: "Processing data",
    //       percentage: 50,
    //     };

    //     prismaService.publishJob.findUnique.mockResolvedValue({
    //       id: jobId,
    //     } as Job);
    //     prismaService.publishJob.update.mockResolvedValue({
    //       id: jobId,
    //       ...statusUpdate,
    //     } as unknown as Job);

    //     jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

    //     await jobStatusService.updateJobStatus(jobId, statusUpdate);

    //     expect(prismaService.publishJob.update).toHaveBeenCalledWith({
    //       where: { id: jobId },
    //       data: {
    //         status: statusUpdate.status,
    //         progress: statusUpdate.progress,
    //         percentage: statusUpdate.percentage,
    //         result: undefined,
    //         updatedAt: expect.any(Date),
    //       },
    //     });
    //     expect(
    //       (jobStatusService as any).emitJobStatusUpdate,
    //     ).toHaveBeenCalledWith(jobId, {
    //       ...statusUpdate,
    //       progress: statusUpdate.progress,
    //       percentage: statusUpdate.percentage,
    //     });
    //   });

    //   it("should sanitize progress text that exceeds maximum length", async () => {
    //     const jobId = 1;
    //     const longProgress = "a".repeat(300);
    //     const statusUpdate = {
    //       status: "In Progress",
    //       progress: longProgress,
    //       percentage: 50,
    //     };

    //     prismaService.publishJob.findUnique.mockResolvedValue(null);
    //     prismaService.job.update.mockResolvedValue({
    //       id: jobId,
    //       ...statusUpdate,
    //       progress: longProgress.slice(0, 255),
    //     } as unknown as Job);

    //     await jobStatusService.updateJobStatus(jobId, statusUpdate);

    //     expect(prismaService.job.update).toHaveBeenCalledWith(
    //       expect.objectContaining({
    //         data: expect.objectContaining({
    //           progress: longProgress.slice(0, 255),
    //         }),
    //       }),
    //     );
    //   });

    //   it("should clamp percentage to valid range (0-100)", async () => {
    //     const jobId = 1;
    //     const statusUpdate = {
    //       status: "In Progress",
    //       progress: "Processing data",
    //       percentage: 150,
    //     };

    //     prismaService.publishJob.findUnique.mockResolvedValue(null);
    //     prismaService.job.update.mockResolvedValue({
    //       id: jobId,
    //       ...statusUpdate,
    //       percentage: 100,
    //     } as unknown as Job);

    //     jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

    //     await jobStatusService.updateJobStatus(jobId, statusUpdate);

    //     expect(prismaService.job.update).toHaveBeenCalledWith(
    //       expect.objectContaining({
    //         data: expect.objectContaining({}),
    //       }),
    //     );
    //     expect(
    //       (jobStatusService as any).emitJobStatusUpdate,
    //     ).toHaveBeenCalledWith(
    //       jobId,
    //       expect.objectContaining({
    //         percentage: 100,
    //       }),
    //     );
    //   });
    //   it("should retry database update on failure (up to max retries)", async () => {
    //     const jobId = 1;
    //     const statusUpdate = {
    //       status: "In Progress",
    //       progress: "Processing data",
    //       percentage: 50,
    //     };

    //     prismaService.publishJob.findUnique.mockResolvedValue(null);

    //     prismaService.job.update
    //       .mockRejectedValueOnce(new Error("DB error 1"))
    //       .mockRejectedValueOnce(new Error("DB error 2"))
    //       .mockResolvedValueOnce({
    //         id: jobId,
    //         ...statusUpdate,
    //       } as unknown as Job);

    //     const originalSetTimeout = global.setTimeout;
    //     global.setTimeout = jest.fn((callback) => {
    //       callback();
    //       return {} as NodeJS.Timeout;
    //     });

    //     await jobStatusService.updateJobStatus(jobId, statusUpdate);

    //     expect(prismaService.job.update).toHaveBeenCalledTimes(3);

    //     global.setTimeout = originalSetTimeout;
    //   });
    //   it("should still emit status update even if all DB updates fail", async () => {
    //     const jobId = 1;
    //     const statusUpdate = {
    //       status: "In Progress",
    //       progress: "Processing data",
    //       percentage: 50,
    //     };

    //     prismaService.publishJob.findUnique.mockResolvedValue(null);

    //     prismaService.job.update.mockRejectedValue(new Error("DB error"));

    //     jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");

    //     const originalSetTimeout = global.setTimeout;
    //     global.setTimeout = jest.fn((callback) => {
    //       callback();
    //       return {} as NodeJS.Timeout;
    //     });

    //     await jobStatusService.updateJobStatus(jobId, statusUpdate);

    //     expect(prismaService.job.update).toHaveBeenCalledTimes(3);
    //     expect(
    //       (jobStatusService as any).emitJobStatusUpdate,
    //     ).toHaveBeenCalled();

    //     global.setTimeout = originalSetTimeout;
    //   });

    //   it("should handle errors in the updateJobStatus method", async () => {
    //     const jobId = 1;
    //     const statusUpdate = {
    //       status: "In Progress",
    //       progress: "Processing data",
    //       percentage: 50,
    //     };

    //     prismaService.publishJob.findUnique.mockRejectedValue(
    //       new Error("Catastrophic error"),
    //     );

    //     jest.spyOn(jobStatusService as any, "emitJobStatusUpdate");
    //     jest.spyOn(jobStatusService["logger"], "error");

    //     await jobStatusService.updateJobStatus(jobId, statusUpdate);

    //     expect(jobStatusService["logger"].error).toHaveBeenCalled();
    //     expect(
    //       (jobStatusService as any).emitJobStatusUpdate,
    //     ).toHaveBeenCalledWith(
    //       jobId,
    //       expect.objectContaining({
    //         status: "In Progress",
    //         progress: expect.stringContaining("Update error:"),
    //       }),
    //     );
    //   }
    // );
    // });

    describe("emitJobStatusUpdate (private method)", () => {
      it("should emit update message to subject", async () => {
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        jobStatusService.getPublishJobStatusStream(jobId);

        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "next");

        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        expect(subject.next).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "update",
            data: expect.objectContaining({
              status: statusUpdate.status,
              progress: statusUpdate.progress,
              percentage: statusUpdate.percentage,
            }),
          }),
        );
      });

      it("should emit completion messages when job is completed", async () => {
        const jobId = 1;
        const statusUpdate = {
          status: "Completed",
          progress: "Job completed successfully",
          percentage: 100,
          result: { data: "some result" },
        };

        jobStatusService.getPublishJobStatusStream(jobId);

        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "next");

        jest.useFakeTimers();

        jest.spyOn(jobStatusService, "cleanupJobStream");

        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        expect(subject.next).toHaveBeenCalledTimes(3);
        expect(subject.next).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            type: "finalize",
            data: expect.objectContaining({
              status: "Completed",
              done: true,
            }),
          }),
        );
        expect(subject.next).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            type: "summary",
            data: expect.objectContaining({
              finalStatus: "Completed",
            }),
          }),
        );
        expect(subject.next).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({
            type: "close",
            data: expect.objectContaining({
              message: "Stream completed",
            }),
          }),
        );

        jest.advanceTimersByTime(1000);

        expect(jobStatusService.cleanupJobStream).toHaveBeenCalledWith(jobId);

        jest.useRealTimers();
      });

      it("should emit error messages when job fails", async () => {
        const jobId = 1;
        const statusUpdate = {
          status: "Failed",
          progress: "Job failed due to error",
          percentage: 50,
        };

        jobStatusService.getPublishJobStatusStream(jobId);

        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);
        jest.spyOn(subject, "next");

        jest.useFakeTimers();

        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        expect(subject.next).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            data: expect.objectContaining({
              status: "Failed",
              done: true,
            }),
          }),
        );

        jest.useRealTimers();
      });

      it("should handle errors when emitting status updates", async () => {
        const jobId = 1;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        jobStatusService.getPublishJobStatusStream(jobId);

        const subject = (jobStatusService as any).jobStatusStreams.get(jobId);

        jest.spyOn(subject, "next").mockImplementation(() => {
          throw new Error("Emission error");
        });

        jest.spyOn(jobStatusService["logger"], "error");

        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        expect(jobStatusService["logger"].error).toHaveBeenCalledWith(
          expect.stringContaining(
            `Error emitting status update for job #${jobId}`,
          ),
        );
      });

      it("should do nothing if job stream does not exist", async () => {
        const jobId = 999;
        const statusUpdate = {
          status: "In Progress",
          progress: "Processing data",
          percentage: 50,
        };

        (jobStatusService as any).jobStatusStreams.clear();

        jest.spyOn(jobStatusService["logger"], "error");

        (jobStatusService as any).emitJobStatusUpdate(jobId, statusUpdate);

        expect(jobStatusService["logger"].error).not.toHaveBeenCalled();
      });
    });
  });
});
