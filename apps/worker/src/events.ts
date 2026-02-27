import { redis } from "./redis";
import { JOB_EVENTS_CHANNEL } from "./stream";

export const publishEvent = async (event: {
  jobId: string;
  type: string;
  message: string;
  meta?: Record<string, unknown>;
}) => {
  await redis.publish(
    JOB_EVENTS_CHANNEL,
    JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
    })
  );
};
