// content/index.js – Entry point; loads all content modules and wires up message handling.
// All scripts are loaded via manifest content_scripts in order, so this is the last to load.

'use strict';

// Load modules in order (content_scripts array in manifest ensures order)
// selectors.js → recorder.js → replayer.js → verifier.js → index.js

const { startRecording, stopRecording, isRecording } = window.__replayRecorder;
const { startReplay, cancelReplay } = window.__replayReplayer;
const { runVerification, takeSnapshot } = window.__replayVerifier;

// ── Message handler (from side panel via background relay) ───────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only handle messages that came FROM the side panel (no _fromContent flag)
  if (msg._fromContent) return; // ignore echoes from bg relay

  (async () => {
    switch (msg.type) {
      case 'PING':
        sendResponse({ ok: true, recording: isRecording() });
        break;

      case 'START_RECORDING': {
        if (isRecording()) { sendResponse({ error: 'Already recording' }); return; }
        startRecording(msg.recordId);
        sendResponse({ ok: true });
        break;
      }

      case 'STOP_RECORDING': {
        if (!isRecording()) { sendResponse({ error: 'Not recording' }); return; }
        const result = stopRecording();
        sendResponse({ ok: true, ...result });
        break;
      }

      case 'START_REPLAY': {
        const { workflow, resumeRunId } = msg;
        // Take collateral snapshot before replay
        const m = location.hash.match(/#\/customers\/([^/?]+)/);
        if (m) await takeSnapshot(m[1]);
        startReplay(workflow, resumeRunId).catch(console.error);
        sendResponse({ ok: true });
        break;
      }

      case 'CANCEL_REPLAY':
        cancelReplay();
        sendResponse({ ok: true });
        break;

      case 'CONFIRM_STEP':
      case 'SENSITIVE_VALUE':
        // These are handled inside replayer's internal listeners;
        // just relay them through the runtime normally.
        sendResponse({ ok: true });
        break;

      case 'RUN_VERIFY': {
        const { workflow } = msg;
        const result = await runVerification(workflow);
        sendResponse({ ok: true, result });
        break;
      }

      case 'RESET_DEMO_DATA': {
        // Reset localStorage to seed data
        const seed = [
          { id: 'c1', name: 'Alice Johnson', status: 'New', notes: '', updatedAt: null },
          { id: 'c2', name: 'Bob Smith',     status: 'New', notes: '', updatedAt: null },
          { id: 'c3', name: 'Carol Diaz',    status: 'New', notes: '', updatedAt: null },
        ];
        localStorage.setItem('crm.customers', JSON.stringify(seed));
        sendResponse({ ok: true });
        break;
      }

      case 'GET_RECORD_INFO': {
        const nameEl = document.querySelector('[data-testid="record-name"]');
        const m2 = location.hash.match(/#\/customers\/([^/?]+)/);
        sendResponse({
          ok: true,
          name: nameEl?.textContent?.trim() || null,
          recordId: m2 ? m2[1] : null,
          url: location.href
        });
        break;
      }

      default:
        sendResponse({ error: `Unknown message type: ${msg.type}` });
    }
  })();

  return true; // keep async sendResponse alive
});

// ── Register this tab with the background so it can relay to us ──────────────
// Called on initial load AND whenever the page becomes visible again.
function registerWithBackground() {
  chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {});
}

registerWithBackground();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) registerWithBackground();
});

console.log('[RePlay] Content script loaded on', location.href);
