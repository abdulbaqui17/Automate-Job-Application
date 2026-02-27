const apiInput = document.getElementById("api");
const userInput = document.getElementById("user");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const sendButton = document.getElementById("send");
const optionsLink = document.getElementById("open-options");

const detectPlatform = (url) => {
  if (url.includes("linkedin.com")) return "LINKEDIN";
  if (url.includes("indeed.com")) return "INDEED";
  if (url.includes("glassdoor.com")) return "GLASSDOOR";
  return "OTHER";
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const loadConfig = async () => {
  const data = await chrome.storage.sync.get(["apiUrl", "userId"]);
  apiInput.value = data.apiUrl || "http://localhost:3001";
  userInput.value = data.userId || "";
  if (data.apiUrl && data.userId) {
    summaryEl.textContent = `Configured for ${data.apiUrl}`;
  } else {
    summaryEl.textContent = "Set API URL and User ID to enable one-click apply.";
  }
};

const saveConfig = async () => {
  await chrome.storage.sync.set({
    apiUrl: apiInput.value.trim(),
    userId: userInput.value.trim(),
  });
};

sendButton.addEventListener("click", async () => {
  const apiUrl = apiInput.value.trim();
  const userId = userInput.value.trim();
  if (!apiUrl || !userId) {
    setStatus("Set API URL and User ID first.");
    return;
  }
  await saveConfig();
  setStatus("Sending...");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    setStatus("No active tab URL.");
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        jobUrl: tab.url,
        platform: detectPlatform(tab.url),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(`Error: ${err.error || res.status}`);
      return;
    }

    setStatus("Queued! Automation will start shortly.");
  } catch (err) {
    setStatus("Failed to send.");
  }
});

optionsLink.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadConfig().catch(() => setStatus("Failed to load config"));
