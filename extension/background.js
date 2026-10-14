// background.js – Service Worker (simplified)
// Only responsibility: relay content→sidepanel messages and open side panel.
// Sidepanel→content is handled DIRECTLY from the side panel via chrome.tabs.sendMessage.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// ── Relay: content script → side panel ──────────────────────────────────────
// Content scripts can't address the side panel directly, so they send here
// with _fromContent:true and we forward to all extension pages.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg._fromContent) {
    // Store the tab ID any time content script contacts us
    if (sender.tab?.id) {
      chrome.storage.local.set({ crmTabId: sender.tab.id }).catch(() => {});
    }
    // Forward to side panel (and any other extension pages)
    chrome.runtime.sendMessage(msg).catch(() => {
      // Side panel may not be open – ignore
    });
    sendResponse({ ok: true });
    return; // synchronous sendResponse, no need to return true
  }
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log(`[RePlay] ${reason}`);
});
