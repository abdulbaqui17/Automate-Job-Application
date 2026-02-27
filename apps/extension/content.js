const OVERLAY_ID = "applycraft-overlay";

const getConfig = async () => {
  const data = await chrome.storage.sync.get(["apiUrl", "userId"]);
  return {
    apiUrl: data.apiUrl || "http://localhost:3001",
    userId: data.userId || "",
  };
};

const detectPlatform = (url) => {
  if (url.includes("linkedin.com")) return "LINKEDIN";
  if (url.includes("indeed.com")) return "INDEED";
  if (url.includes("glassdoor.com")) return "GLASSDOOR";
  if (url.includes("wellfound.com")) return "OTHER";
  if (url.includes("lever.co")) return "OTHER";
  if (url.includes("greenhouse.io")) return "OTHER";
  return "OTHER";
};

const isJobPage = (url) => {
  return (
    /linkedin\.com\/jobs\/view/.test(url) ||
    /indeed\.com\/viewjob/.test(url) ||
    /indeed\.com\/.*jk=/.test(url) ||
    /glassdoor\.com\/Job/.test(url) ||
    /glassdoor\.com\/job-listing/.test(url) ||
    /wellfound\.com\/jobs/.test(url) ||
    /lever\.co\/.+/.test(url) ||
    /greenhouse\.io\/.+/.test(url)
  );
};

const createOverlay = () => {
  if (document.getElementById(OVERLAY_ID)) return;

  const container = document.createElement("div");
  container.id = OVERLAY_ID;
  container.className = "applycraft-overlay";

  const title = document.createElement("div");
  title.className = "applycraft-title";
  title.textContent = "ApplyCraft";

  const status = document.createElement("div");
  status.className = "applycraft-status";
  status.textContent = "Ready to save this job.";

  const button = document.createElement("button");
  button.className = "applycraft-button";
  button.textContent = "Apply with AI";

  const hint = document.createElement("div");
  hint.className = "applycraft-hint";
  hint.textContent = "Queues the job and starts automation.";

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Queuing job...";
    try {
      const { apiUrl, userId } = await getConfig();
      if (!apiUrl || !userId) {
        status.textContent = "Set API URL + User ID in the extension options.";
        button.disabled = false;
        return;
      }

      const jobUrl = window.location.href;
      const platform = detectPlatform(jobUrl);

      const res = await fetch(`${apiUrl}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, jobUrl, platform }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        status.textContent = `Failed: ${err.error || res.status}`;
        button.disabled = false;
        return;
      }

      await fetch(`${apiUrl}/automation/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }).catch(() => undefined);

      status.textContent = "Queued! Automation starting.";
    } catch (err) {
      status.textContent = "Failed to queue job.";
    } finally {
      button.disabled = false;
    }
  });

  container.appendChild(title);
  container.appendChild(status);
  container.appendChild(button);
  container.appendChild(hint);
  document.body.appendChild(container);
};

const removeOverlay = () => {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();
};

const ensureOverlay = () => {
  const url = window.location.href;
  if (isJobPage(url)) {
    createOverlay();
  } else {
    removeOverlay();
  }
};

let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    ensureOverlay();
  }
}, 1000);

ensureOverlay();
