export interface JobStateRecord {
  id: string;
  queueName: string;
  jobName: string;
  kind: string;
  userId: string;
  assignmentId?: number;
  attemptId?: number | null;
  status: string;
  progress: string;
  percentage?: number;
  currentQuestion?: number;
  totalQuestions?: number;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobStateOptions {
  queueName: string;
  jobName: string;
  kind: string;
  userId: string;
  assignmentId?: number;
  attemptId?: number | null;
  status: string;
  progress: string;
  percentage?: number;
  result?: unknown;
  activeKey?: string;
  /** When provided, use this UUID as the job ID (e.g. from acquireActiveJobLock) */
  reservedId?: string;
}

export interface JobStatusUpdate {
  status: string;
  progress: string;
  percentage?: number;
  currentQuestion?: number;
  totalQuestions?: number;
  result?: unknown;
}
