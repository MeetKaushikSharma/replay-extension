// background.js – Service Worker
// Responsibilities:
//   1. Open side panel on action click
//   2. Inject content script on demand into any tab (for non-CRM sites)
//   3. Relay content→sidepanel messages
//   4. Store active tab ID so sidepanel can message it

'use strict';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// ── Track the active tab ──────────────────────────────────────────────────────
// Store whenever the active tab changes so the side panel always knows
// which tab to message, even on non-CRM sites.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.storage.local.set({ activeTabId: tabId }).catch(() => {});
});

// Also update on tab update (URL change within same tab)
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') {
    // If this is the tab the side panel is looking at, clear the crmTabId
    // so getCrmTabId() re-queries instead of using a stale ID
    chrome.storage.local.get('activeTabId').then(({ activeTabId }) => {
      if (activeTabId === tabId) {
        chrome.storage.local.set({ activeTabId: tabId }).catch(() => {});
      }
    });
  }
});

// ── Relay: content script → side panel ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg._fromContent) {
    // Store sender tab ID so sidepanel can address it directly
    if (sender.tab?.id) {
      chrome.storage.local.set({ crmTabId: sender.tab.id, activeTabId: sender.tab.id }).catch(() => {});
    }
    // Forward to side panel (and any other extension pages)
    chrome.runtime.sendMessage(msg).catch(() => {
      // Side panel may not be open – ignore
    });
    sendResponse({ ok: true });
    return;
  }

  // ── Inject content script on demand ────────────────────────────────────────
  // Side panel sends INJECT_CONTENT when PING fails (non-CRM site, or first load)
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
  console.log(`[RePlay] ${reason}`);
});
