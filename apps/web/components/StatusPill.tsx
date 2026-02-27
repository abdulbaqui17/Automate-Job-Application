export default function StatusPill({ status }: { status: string }) {
  const warn = status === "FAILED" || status === "MANUAL" || status === "MANUAL_INTERVENTION";
  return <span className={`status-pill ${warn ? "warn" : ""}`}>{status}</span>;
}
