const apiInput = document.getElementById("api");
const userInput = document.getElementById("user");
const statusEl = document.getElementById("status");
const saveButton = document.getElementById("save");

const setStatus = (text) => {
  statusEl.textContent = text;
};

const loadConfig = async () => {
  const data = await chrome.storage.sync.get(["apiUrl", "userId"]);
  apiInput.value = data.apiUrl || "http://localhost:3001";
  userInput.value = data.userId || "";
};

saveButton.addEventListener("click", async () => {
  await chrome.storage.sync.set({
    apiUrl: apiInput.value.trim(),
    userId: userInput.value.trim(),
  });
  setStatus("Saved.");
});

loadConfig().catch(() => setStatus("Failed to load config"));
