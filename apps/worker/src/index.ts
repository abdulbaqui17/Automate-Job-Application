import { redis } from "./redis";
import { prisma } from "./db";
import { APPLICATION_STREAM, WORKER_GROUP, AUTOMATION_CHANNEL } from "./stream";
import { startDiscovery } from "./discovery";
import { applyWithBrowser, runFullAutomation } from "./automation";
import { publishEvent } from "./events";

const CONSUMER = `worker-${process.pid}`;
const MAX_ATTEMPTS = 3;

const ensureGroup = async () => {
  try {
    await redis.xgroup("CREATE", APPLICATION_STREAM, WORKER_GROUP, "$", "MKSTREAM");
  } catch (err: any) {
    if (!String(err?.message ?? "").includes("BUSYGROUP")) {
      throw err;
    }
  }
};

const parseFields = (fields: string[]) => {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    map[fields[i]] = fields[i + 1];
  }
  return map;
};

const processJob = async (payload: {
  applicationId: string;
  jobId: string;
  userId: string;
  jobUrl: string;
  platform: string;
  attempts?: number;
}) => {
  const attempts = payload.attempts ?? 0;

  await prisma.application.update({
    where: { id: payload.applicationId },
    data: { status: "PROCESSING" },
  });

  await applyWithBrowser({
    applicationId: payload.applicationId,
    jobId: payload.jobId,
    userId: payload.userId,
    jobUrl: payload.jobUrl,
    platform: payload.platform as any,
  });

  return attempts;
};

const run = async () => {
  await ensureGroup();
  console.log("Worker started");
  startDiscovery().catch((err) => {
    console.error("Discovery failed to start", err);
  });

  const automationSub = redis.duplicate();
  await automationSub.subscribe(AUTOMATION_CHANNEL);
  console.log(`Subscribed to ${AUTOMATION_CHANNEL}`);
  automationSub.on("message", async (_channel, message) => {
    console.log(`[automation] Received message: ${message}`);
    try {
      const { userId } = JSON.parse(message) as { userId: string };
      console.log(`[automation] Starting full automation for user: ${userId}`);
      await runFullAutomation(userId);
      console.log(`[automation] Finished automation for user: ${userId}`);
    } catch (err) {
      console.error("Automation start failed", err);
    }
  });

  while (true) {
    const response = (await redis.call(
      "XREADGROUP",
      "GROUP",
      WORKER_GROUP,
      CONSUMER,
      "BLOCK",
      "5000",
      "COUNT",
      "1",
      "STREAMS",
      APPLICATION_STREAM,
      ">"
    )) as [string, [string, string[]][]][] | null;

    if (!response) continue;

    for (const [, messages] of response) {
      for (const [id, fields] of messages) {
        const map = parseFields(fields as string[]);
        if (!map.payload) {
          await redis.xack(APPLICATION_STREAM, WORKER_GROUP, id as string);
          continue;
        }

        const payload = JSON.parse(map.payload) as {
          applicationId: string;
          jobId: string;
          userId: string;
          jobUrl: string;
          platform: string;
          attempts?: number;
        };

        try {
          await processJob(payload);
          await publishEvent({
            jobId: payload.applicationId,
            type: "JOB_FINISHED",
            message: "Automation completed",
          });
          await redis.xack(APPLICATION_STREAM, WORKER_GROUP, id as string);
        } catch (err: any) {
          const attempts = (payload.attempts ?? 0) + 1;
          if (attempts < MAX_ATTEMPTS) {
            await redis.xadd(
              APPLICATION_STREAM,
              "*",
              "payload",
              JSON.stringify({ ...payload, attempts })
            );
            await publishEvent({
              jobId: payload.applicationId,
              type: "ERROR_OCCURRED",
              message: `Job failed, retrying (${attempts}/${MAX_ATTEMPTS})`,
            });
          } else {
            await prisma.application.update({
              where: { id: payload.applicationId },
              data: { status: "FAILED", error: err?.message ?? "Job failed" },
            });
            await publishEvent({
              jobId: payload.applicationId,
              type: "ERROR_OCCURRED",
              message: err?.message ?? "Job failed",
            });
          }
          await redis.xack(APPLICATION_STREAM, WORKER_GROUP, id as string);
        }
      }
    }
  }
};

run().catch((err) => {
  console.error("Worker crashed", err);
  process.exit(1);
});
