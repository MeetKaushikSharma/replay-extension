// background.js – Service Worker
// Relays messages between side panel and content script.
// Holds NO in-memory state that matters (can be killed any time).

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// ── Track which tab has the CRM content script ───────────────────────────────
// Content script registers itself by sending { type: 'CONTENT_READY', tabId }.
// We store the most-recent active CRM tab ID in chrome.storage.local so the
// background can relay to it even after the SW sleeps and restarts.

async function getCrmTabId() {
  // 1. Try the stored tab ID first
  const { crmTabId } = await chrome.storage.local.get('crmTabId');
  if (crmTabId) {
    try {
      // Verify the tab still exists and has the content script
      await chrome.tabs.get(crmTabId);
      return crmTabId;
    } catch {
      // Tab gone – fall through to query
    }
  }
  // 2. Fallback: query all windows for an active localhost:5173 tab
  const allTabs = await chrome.tabs.query({ url: 'http://localhost:5173/*' });
  if (allTabs.length) {
    await chrome.storage.local.set({ crmTabId: allTabs[0].id });
    return allTabs[0].id;
  }
  // 3. Last resort: active tab in any window
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active?.id ?? null;
}

// ── Relay: side panel → content script ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Register content script tab
  if (msg.type === 'CONTENT_READY' && sender.tab) {
    chrome.storage.local.set({ crmTabId: sender.tab.id });
    sendResponse({ ok: true });
    return;
  }

  // Messages from content script → broadcast to side panel
  if (msg._fromContent) {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Side panel may not be open; ignore
    });
    sendResponse({ ok: true });
    return;
  }

  // Messages from side panel (no sender.tab) → forward to content script
  if (!sender.tab) {
    getCrmTabId().then(tabId => {
      if (!tabId) {
        sendResponse({ error: 'No CRM tab found. Open http://localhost:5173 first.' });
        return;
      }
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // keep channel open for async sendResponse
  }
});

// Log install / update
chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log(`[RePlay] ${reason}`);
});
