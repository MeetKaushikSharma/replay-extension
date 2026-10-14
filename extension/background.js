// background.js – Service Worker
// Relays messages between side panel and content script.
// Holds NO in-memory state that matters (can be killed any time).

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// ── Relay: side panel → content script ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages from the side panel have no sender.tab
  if (!sender.tab) {
    // Forward to the active tab's content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: "No active tab" });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // keep channel open for async sendResponse
  }

  // Messages from content script → broadcast to side panel
  // (content → background → side panel)
  if (msg._fromContent) {
    // Forward to all extension pages (the side panel)
    chrome.runtime.sendMessage(msg).catch(() => {
      // Side panel may not be open; ignore
    });
    sendResponse({ ok: true });
    return;
  }
});

// Log install / update
chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log(`[RePlay] ${reason}`);
});
