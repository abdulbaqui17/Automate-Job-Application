export const Platforms = [
  "LINKEDIN",
  "INDEED",
  "GLASSDOOR",
  "REMOTIVE",
  "ARBEITNOW",
  "OTHER",
] as const;
export type Platform = (typeof Platforms)[number];

export const ApplicationStatuses = [
  "QUEUED",
  "PROCESSING",
  "APPLIED",
  "FAILED",
  "MANUAL_INTERVENTION",
] as const;
export type ApplicationStatus = (typeof ApplicationStatuses)[number];

export type JobRequest = {
  userId: string;
  jobUrl: string;
  platform: Platform;
};

export type JobEvent = {
  jobId: string;
  type: "JOB_STARTED" | "STEP_COMPLETED" | "ERROR_OCCURRED" | "JOB_FINISHED";
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
};
