import Topbar from "../../../components/Topbar";
import LogStream from "../../../components/LogStream";

export default function LogsPage() {
  return (
    <div>
      <Topbar title="Logs" />
      <div className="panel">
        <h3>Live pipeline events</h3>
        <p style={{ color: "var(--muted)", marginTop: "4px" }}>
          Connects to the WebSocket stream for job lifecycle updates.
        </p>
        <LogStream />
      </div>
    </div>
  );
}
