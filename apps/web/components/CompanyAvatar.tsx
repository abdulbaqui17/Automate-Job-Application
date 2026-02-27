"use client";

import { useMemo, useState } from "react";

type Props = {
  company?: string | null;
  jobUrl?: string | null;
};

const toInitials = (value?: string | null) => {
  if (!value) return "?";
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
  return `${first}${second}`.toUpperCase();
};

const slugify = (value?: string | null) => {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
};

const getHostname = (jobUrl?: string | null) => {
  if (!jobUrl) return "";
  try {
    return new URL(jobUrl).hostname;
  } catch {
    return "";
  }
};

export default function CompanyAvatar({ company, jobUrl }: Props) {
  const initials = useMemo(() => toInitials(company), [company]);
  const hostname = useMemo(() => getHostname(jobUrl), [jobUrl]);
  const clearbitSlug = useMemo(() => slugify(company), [company]);

  const clearbitUrl = clearbitSlug ? `https://logo.clearbit.com/${clearbitSlug}.com` : "";
  const faviconUrl = hostname
    ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
    : "";

  const [src, setSrc] = useState(clearbitUrl || faviconUrl);

  const handleError = () => {
    if (src === clearbitUrl && faviconUrl) {
      setSrc(faviconUrl);
    } else if (src) {
      setSrc("");
    }
  };

  return (
    <div className="company-avatar">
      {src ? (
        <img
          src={src}
          alt={company ?? "Company logo"}
          onError={handleError}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
