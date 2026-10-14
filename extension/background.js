// background.js – Service Worker for RePlay
// Responsibilities:
//   1. Open side panel on action click
//   2. Inject content script on demand into any tab
//   3. Track active tab ID for quick fallback

'use strict';

// Open side panel when user clicks extension icon in toolbar
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// ── Track the active tab ──────────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.storage.local.set({ activeTabId: tabId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.active) {
    chrome.storage.local.set({ activeTabId: tabId }).catch(() => {});
  }
});

// ── Handle messages from content script or side panel ─────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg._fromContent) {
    // Record sender tab ID if available
    if (sender.tab?.id) {
      chrome.storage.local.set({ activeTabId: sender.tab.id }).catch(() => {});
    }
    // Content script runtime messages are already received by all open extension views.
    sendResponse({ ok: true });
    return;
  }

  // ── Inject content script on demand ────────────────────────────────────────
  if (msg.type === 'INJECT_CONTENT') {
    const tabId = msg.tabId;
    chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content/content.js']
    }).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // async
  }
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log(`[RePlay] Extension installed/updated (${reason})`);
});
