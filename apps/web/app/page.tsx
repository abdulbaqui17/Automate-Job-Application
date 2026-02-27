import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <div>
          <span className="badge">Enterprise-grade automation</span>
          <h1>ApplyCraft. From script to platform.</h1>
          <p>
            Build a resilient job application system with queue orchestration,
            real-time observability, and human-in-the-loop safety nets.
          </p>
          <div className="cta-row">
            <Link className="button primary" href="/dashboard">
              Open dashboard
            </Link>
            <Link className="button ghost" href="/dashboard/settings">
              Configure sources
            </Link>
          </div>
        </div>
        <div className="hero-card">
          <h3>System pulse</h3>
          <p>
            6 queues active, 2 workers online, 38 jobs in flight. Your pipeline
            never blocks on a single failure.
          </p>
          <div className="metrics" style={{ marginTop: "20px" }}>
            <div className="metric">
              <span>Daily throughput</span>
              <h4>72</h4>
            </div>
            <div className="metric">
              <span>Retry success</span>
              <h4>91%</h4>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-title">What ships in the platform</h2>
        <div className="card-grid">
          <div className="card">
            <h3>Queue orchestration</h3>
            <p>Redis + BullMQ handle retries, backoff, and rate-limits.</p>
          </div>
          <div className="card">
            <h3>Live observability</h3>
            <p>WebSocket log streaming with step-level status updates.</p>
          </div>
          <div className="card">
            <h3>Profile intelligence</h3>
            <p>Structured profile data ready for Gemini resume tailoring.</p>
          </div>
          <div className="card">
            <h3>Human-in-loop</h3>
            <p>Pause jobs for manual intervention and resume safely.</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-title">Architecture at a glance</h2>
        <div className="card-grid">
          <div className="card">
            <h3>Control plane</h3>
            <p>Next.js dashboard + real-time telemetry.</p>
          </div>
          <div className="card">
            <h3>API gateway</h3>
            <p>Bun + TypeScript, WebSockets, and job dispatch.</p>
          </div>
          <div className="card">
            <h3>Worker fleet</h3>
            <p>Queue-driven job workers, Playwright-ready.</p>
          </div>
          <div className="card">
            <h3>Persistence</h3>
            <p>PostgreSQL for lifecycle state and audit logs.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
