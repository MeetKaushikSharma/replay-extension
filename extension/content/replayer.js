// replayer.js – Replays a recorded workflow on the current page record.
// Replay runs entirely in the content script so it survives SW sleeping.

'use strict';

const { pollForTarget } = window.__replaySelectors;

let _activeRun = null; // { runId, workflow, completedStepIds, cancelled }

/**
 * Apply a value to a React-controlled input/select/textarea.
 * Uses the native value setter to bypass React's synthetic event handling.
 */
function applyReactValue(el, value) {
  const proto = el instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
  // Dispatch bubbling events so React picks up the change
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Verify that the element actually holds the expected value after applying.
 */
function verifyValue(el, expected) {
  return el.value === expected;
}

function notifyPanel(msg) {
  chrome.runtime.sendMessage({ ...msg, _fromContent: true }).catch(() => {});
}

function sendStepStatus(runId, stepId, status, detail) {
  notifyPanel({ type: 'STEP_STATUS', runId, stepId, status, detail });
}

/**
 * Wait for user confirmation from the side panel.
 * Returns a Promise that resolves true (confirmed) or false (cancelled/timeout).
 */
function waitForConfirmation(runId, stepId, label, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    function onMsg(msg) {
      if (msg.type === 'CONFIRM_STEP' && msg.runId === runId && msg.stepId === stepId) {
        cleanup();
        resolve(msg.confirmed);
      }
    }

    chrome.runtime.onMessage.addListener(onMsg);

    function cleanup() {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMsg);
    }

    // Ask the panel to show a confirmation prompt
    notifyPanel({ type: 'CONFIRM_REQUIRED', runId, stepId, label });
  });
}

/**
 * Run a preflight check: resolve ALL step targets before touching anything.
 * Returns { ok: true } or { ok: false, failedStep, reason }.
 */
async function preflight(steps) {
  for (const step of steps) {
    try {
      await pollForTarget(step.target, { timeout: 5000 });
    } catch (err) {
      return { ok: false, failedStep: step, reason: err.reason || 'missing' };
    }
  }
  return { ok: true };
}

/**
 * Main replay entry point.
 * @param {object} workflow - The stored workflow object.
 * @param {string} [resumeRunId] - If set, resume an existing run (idempotency).
 */
async function startReplay(workflow, resumeRunId) {
  if (_activeRun?.cancelled === false) {
    return { error: 'Already running' };
  }

  // Load idempotency state
  let runId = resumeRunId;
  let completedStepIds = new Set();

  if (resumeRunId) {
    const stored = await chrome.storage.local.get(`run_${resumeRunId}`);
    const run = stored[`run_${resumeRunId}`];
    if (run) completedStepIds = new Set(run.completedStepIds || []);
  } else {
    runId = 'run_' + Date.now();
  }

  _activeRun = { runId, workflow, completedStepIds, cancelled: false };

  const targetName = document.querySelector('[data-testid="record-name"]')?.textContent?.trim() || '(unknown)';
  notifyPanel({ type: 'REPLAY_STARTED', runId, targetName, workflowId: workflow.id });

  // ── Preflight ───────────────────────────────────────────────────────────────
  const nonCompleted = workflow.steps.filter(s => !completedStepIds.has(s.id));

  // For preflight, skip already-completed steps
  const preflightResult = await preflight(nonCompleted);
  if (!preflightResult.ok) {
    const { failedStep, reason } = preflightResult;
    sendStepStatus(runId, failedStep.id, 'failed', reason);
    notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `Preflight failed: step "${failedStep.label}" – ${reason}` });
    _activeRun = null;
    return { error: reason, stepId: failedStep.id };
  }

  // ── Execute steps ───────────────────────────────────────────────────────────
  for (const step of workflow.steps) {
    if (_activeRun.cancelled) break;

    if (completedStepIds.has(step.id)) {
      sendStepStatus(runId, step.id, 'skipped', 'already completed');
      continue;
    }

    // Consequential: must NOT re-execute on retry
    const isConsequential = step.consequential;

    sendStepStatus(runId, step.id, 'running', null);

    // Handle sensitive fields – pause and ask user
    if (step.sensitive) {
      notifyPanel({ type: 'SENSITIVE_PAUSE', runId, stepId: step.id, label: step.label });
      // Wait for the value to be provided via SENSITIVE_VALUE message
      const value = await waitForSensitiveValue(runId, step.id);
      if (value === null) {
        sendStepStatus(runId, step.id, 'failed', 'sensitive input cancelled');
        notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: 'Cancelled during sensitive field input' });
        _activeRun = null;
        return;
      }
      step._runtimeValue = value;
    }

    // Consequential: ask for confirmation
    if (isConsequential && !completedStepIds.has(step.id)) {
      const confirmed = await waitForConfirmation(runId, step.id, step.label);
      if (!confirmed) {
        sendStepStatus(runId, step.id, 'failed', 'cancelled by user');
        notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: 'User cancelled before consequential step' });
        _activeRun = null;
        return;
      }
    }

    // Resolve target with polling
    let el;
    try {
      const result = await pollForTarget(step.target, { timeout: 5000 });
      el = result.el;
    } catch (err) {
      sendStepStatus(runId, step.id, 'failed', err.reason || 'missing');
      notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `Step "${step.label}" failed: ${err.reason || 'missing'}` });
      _activeRun = null;
      // Save partial progress for retry
      await saveRunState(runId, workflow.id, [...completedStepIds]);
      return { error: err.reason, stepId: step.id };
    }

    // Apply action
    try {
      if (step.action === 'select' || step.action === 'type') {
        const value = step._runtimeValue ?? step.value;
        applyReactValue(el, value);
        await new Promise(r => setTimeout(r, 100)); // small settle time
        if (!verifyValue(el, value)) {
          throw new Error(`Value did not stick: expected "${value}", got "${el.value}"`);
        }
      } else if (step.action === 'click') {
        el.click();
        await new Promise(r => setTimeout(r, 200)); // wait for DOM reaction
      }
    } catch (err) {
      sendStepStatus(runId, step.id, 'failed', err.message);
      notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `Step "${step.label}" error: ${err.message}` });
      _activeRun = null;
      return;
    }

    completedStepIds.add(step.id);
    await saveRunState(runId, workflow.id, [...completedStepIds]);
    sendStepStatus(runId, step.id, 'success', null);
  }

  const cancelled = _activeRun?.cancelled;
  _activeRun = null;

  if (!cancelled) {
    notifyPanel({ type: 'REPLAY_COMPLETE', runId });
  }
}

function waitForSensitiveValue(runId, stepId, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    function onMsg(msg) {
      if (msg.type === 'SENSITIVE_VALUE' && msg.runId === runId && msg.stepId === stepId) {
        cleanup();
        resolve(msg.value);
      }
    }
    chrome.runtime.onMessage.addListener(onMsg);
    function cleanup() { clearTimeout(timer); chrome.runtime.onMessage.removeListener(onMsg); }
  });
}

async function saveRunState(runId, workflowId, completedStepIds) {
  await chrome.storage.local.set({
    [`run_${runId}`]: { runId, workflowId, completedStepIds, updatedAt: Date.now() }
  });
}

function cancelReplay() {
  if (_activeRun) _activeRun.cancelled = true;
}

function getActiveRun() { return _activeRun; }

window.__replayReplayer = { startReplay, cancelReplay, getActiveRun };
