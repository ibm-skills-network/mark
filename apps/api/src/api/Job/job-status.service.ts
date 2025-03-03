import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

@Injectable()
export class JobStatusService {
  private jobStatusSubjects = new Map<number, Subject<MessageEvent>>();

  cleanupJobStream(jobId: number) {
    const stream = this.jobStatusSubjects.get(jobId);
    if (stream) {
      stream.complete();
      this.jobStatusSubjects.get(jobId).complete();
      this.jobStatusSubjects.delete(jobId);
    }
  }

  /**
   * Get or create a job status subject
   */
  getJobStatusStream(jobId: number): Observable<MessageEvent> {
    if (!this.jobStatusSubjects.has(jobId)) {
      this.jobStatusSubjects.set(jobId, new Subject<MessageEvent>());
    }
    return this.jobStatusSubjects.get(jobId).asObservable();
  }

  /**
   * Update the job status and emit real-time updates
   */
  updateJobStatus(
    jobId: number,
    progress: string,
    status = "In Progress",
    result?: unknown,
    percentage?: number,
  ) {
    if (this.jobStatusSubjects.has(jobId)) {
      const update = {
        data: {
          status,
          progress,
          percentage,
          result: result
            ? (JSON.parse(JSON.stringify(result)) as unknown)
            : undefined,
          done: status === "Completed" || status === "Failed",
        },
      };

      this.jobStatusSubjects.get(jobId).next(update as MessageEvent);

      // If job is done, complete the stream
      if (update.data.done) {
        this.jobStatusSubjects.get(jobId).complete();
        this.jobStatusSubjects.delete(jobId);
      }
    }
  }
}
