import Topbar from "../../../components/Topbar";
import LogStream from "../../../components/LogStream";
import PageWrapper from "../../../components/PageWrapper";

export default function LogsPage() {
  return (
    <PageWrapper>
      <Topbar title="Logs" />
      <div className="panel">
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-display), sans-serif",
            fontSize: "1.05rem",
            fontWeight: 600,
          }}
        >
          Live pipeline events
        </h3>
        <p style={{ color: "var(--muted)", marginTop: 6, fontSize: "0.82rem" }}>
          Connects to the WebSocket stream for job lifecycle updates.
        </p>
        <div style={{ marginTop: 12 }}>
          <LogStream />
        </div>
      </div>
    </PageWrapper>
  );
}
