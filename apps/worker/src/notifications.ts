import "./env";
import nodemailer from "nodemailer";
import { prisma } from "./db";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpSecure = process.env.SMTP_SECURE === "true";
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM;

const transporter = smtpHost && smtpFrom
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
    })
  : null;

export const isEmailEnabled = () => !!transporter;

type StatusType = "APPLIED" | "FAILED" | "MANUAL_INTERVENTION" | "PROCESSING" | "QUEUED";

const formatSubject = (status: StatusType, title?: string | null, company?: string | null) => {
  const role = title ? ` ${title}` : "";
  const org = company ? ` @ ${company}` : "";
  if (status === "APPLIED") return `Applied${role}${org}`;
  if (status === "MANUAL_INTERVENTION") return `Manual review needed${role}${org}`;
  if (status === "FAILED") return `Application failed${role}${org}`;
  return `Application update${role}${org}`;
};

const formatBody = (payload: {
  status: StatusType;
  title?: string | null;
  company?: string | null;
  jobUrl?: string | null;
}) => {
  const lines: string[] = [];
  lines.push(`Status: ${payload.status}`);
  if (payload.title) lines.push(`Role: ${payload.title}`);
  if (payload.company) lines.push(`Company: ${payload.company}`);
  if (payload.jobUrl) lines.push(`Link: ${payload.jobUrl}`);
  lines.push("");
  lines.push("ApplyCraft notification.");
  return lines.join("\n");
};

export const sendStatusNotification = async (payload: {
  userId: string;
  applicationId: string;
  status: StatusType;
  title?: string | null;
  company?: string | null;
  jobUrl?: string | null;
}) => {
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user?.email) return;

  const type = payload.status === "FAILED" ? "ERROR" : payload.status === "APPLIED" ? "COMPLETED" : "STATUS_UPDATE";

  const notification = await prisma.notification.create({
    data: {
      userId: payload.userId,
      applicationId: payload.applicationId,
      channel: "EMAIL",
      type,
      status: transporter ? "PENDING" : "FAILED",
      payload: {
        status: payload.status,
        title: payload.title,
        company: payload.company,
        jobUrl: payload.jobUrl,
      },
    },
  });

  if (!transporter) return;

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: user.email,
      subject: formatSubject(payload.status, payload.title, payload.company),
      text: formatBody(payload),
    });

    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: "SENT", sentAt: new Date() },
    });
  } catch (err) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: "FAILED" },
    });
  }
};
