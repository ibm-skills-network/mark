export const TRANSLATION_MAINTENANCE_JOB_RUNNER =
  "TRANSLATION_MAINTENANCE_JOB_RUNNER";

export interface TranslationMaintenanceJobRunner {
  runFixMissingTranslationsJob(
    jobId: string,
    assignmentIds: number[],
    body: unknown,
  ): Promise<void>;
  runSweepMissingTranslationsJob(jobId: string, body: unknown): Promise<void>;
}
