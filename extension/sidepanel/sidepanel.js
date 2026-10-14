// sidepanel.js – All side panel UI logic
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let recording = false;
let pendingSteps = [];   // steps captured during recording (before save)
let pendingSourceLabel = ''; // sourceRecordLabel from STOP_RECORDING response
let savedWorkflows = []; // loaded from chrome.storage.local
let selectedWorkflow = null;
let activeRunId = null;
let lastRunWorkflow = null; // for retry
let pendingConfirm = null;  // { runId, stepId, label }
let replayComplete = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const recIndicator    = $('rec-indicator');
const currentRecord   = $('current-record');
const btnStartRec     = $('btn-start-rec');
const btnStopRec      = $('btn-stop-rec');
const workflowNameForm = $('workflow-name-form');
const workflowNameInput = $('workflow-name-input');
const btnSaveWorkflow = $('btn-save-workflow');
const btnDiscardWorkflow = $('btn-discard-workflow');
const warningsContainer = $('warnings-container');
const noStepsMsg      = $('no-steps-msg');
const stepsList       = $('steps-list');

const workflowsList   = $('workflows-list');
const btnResetDemo    = $('btn-reset-demo');

const noWorkflowSelected  = $('no-workflow-selected');
const selectedWorkflowInfo = $('selected-workflow-info');
const rpWorkflowName  = $('rp-workflow-name');
const rpStepCount     = $('rp-step-count');
const rpTargetRecord  = $('rp-target-record');
const btnStartReplay  = $('btn-start-replay');
const btnCancelReplay = $('btn-cancel-replay');
const btnVerify       = $('btn-verify');
const btnRetry        = $('btn-retry');
const confirmDialog   = $('confirm-dialog');
const confirmMsg      = $('confirm-msg');
const btnConfirmYes   = $('btn-confirm-yes');
const btnConfirmNo    = $('btn-confirm-no');
const timelineList    = $('timeline-list');
const verifyResults   = $('verify-results');
const verifyOverall   = $('verify-overall');
const verifyTbody     = $('verify-tbody');
const replayError     = $('replay-error');

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
    btn.classList.add('active');
    const panel = $(`tab-${btn.dataset.tab}`);
    panel.classList.remove('hidden');
    panel.classList.add('active');
    if (btn.dataset.tab === 'replay') refreshReplayTargetRecord();
  });
});

// ── Storage helpers ─────────────────────────────────────────────────────────
async function loadWorkflows() {
  const data = await chrome.storage.local.get('workflows');
  savedWorkflows = data.workflows || [];
}

async function saveWorkflows() {
  await chrome.storage.local.set({ workflows: savedWorkflows });
}

// ── Messaging helpers ───────────────────────────────────────────────────────
// Side panel talks DIRECTLY to the content script via chrome.tabs.sendMessage.
// This does NOT require the `tabs` permission — only host_permissions for the URL.
// The background relay (runtime.sendMessage) is only used for content→panel direction.

async function getCrmTabId() {
  // Primary: tab ID registered by content script on load
  const { crmTabId } = await chrome.storage.local.get('crmTabId');
  if (crmTabId) return crmTabId;

  // Fallback: active tab in current window (side panel shares the browser window)
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id ?? null;
}

async function sendToContent(msg) {
  const tabId = await getCrmTabId();
  if (!tabId) {
    throw new Error('CRM tab not found. Open http://localhost:5173 in this window first.');
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        // Tab ID may be stale – clear it so next call uses fallback
        chrome.storage.local.remove('crmTabId').catch(() => {});
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}

async function sendConfirmToContent(msg) {
  try { await sendToContent(msg); } catch { /* replayer handles timeout */ }
}

// ── Recording controls ──────────────────────────────────────────────────────
btnStartRec.addEventListener('click', async () => {
  pendingSteps = [];
  warningsContainer.innerHTML = '';
  stepsList.innerHTML = '';
  noStepsMsg.classList.remove('hidden');

  try {
    await sendToContent({ type: 'START_RECORDING' });
    recording = true;
    recIndicator.classList.remove('hidden');
    btnStartRec.classList.add('hidden');
    btnStopRec.classList.remove('hidden');
    workflowNameForm.classList.add('hidden');
  } catch (e) {
    showError(`Failed to start recording: ${e.message}`);
  }
});

btnStopRec.addEventListener('click', async () => {
  try {
    const result = await sendToContent({ type: 'STOP_RECORDING' });

    recording = false;
    recIndicator.classList.add('hidden');
    btnStartRec.classList.remove('hidden');
    btnStopRec.classList.add('hidden');

    // Handle relay errors
    if (result?.error) {
      showWarning(`⚠ Stop recording error: ${result.error}. Try reloading the CRM tab.`);
      return;
    }

    const steps = result?.steps ?? [];
    pendingSteps = steps;
    pendingSourceLabel = result?.sourceRecordLabel || '';

    if (steps.length > 0) {
      workflowNameForm.classList.remove('hidden');
      // Scroll into view in case panel is short
      workflowNameForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      showWarning('⚠ No steps were recorded. Make sure you interact with the CRM form controls while recording.');
    }
  } catch (e) {
    // Reset UI state even on error
    recording = false;
    recIndicator.classList.add('hidden');
    btnStartRec.classList.remove('hidden');
    btnStopRec.classList.add('hidden');
    showWarning(`⚠ Could not stop recording: ${e.message}. Reload the CRM tab and try again.`);
  }
});


btnSaveWorkflow.addEventListener('click', async () => {
  const name = workflowNameInput.value.trim() || 'Untitled Workflow';
  const workflow = {
    id: 'wf_' + Date.now(),
    name,
    createdAt: new Date().toISOString(),
    sourceRecordLabel: pendingSourceLabel,
    steps: pendingSteps.map((s, i) => ({ ...s, order: i }))
  };
  savedWorkflows.push(workflow);
  await saveWorkflows();
  workflowNameForm.classList.add('hidden');
  pendingSteps = [];
  renderWorkflowsList();
  // Switch to workflows tab
  document.querySelector('[data-tab="workflows"]').click();
});

btnDiscardWorkflow.addEventListener('click', () => {
  workflowNameForm.classList.add('hidden');
  pendingSteps = [];
});

// ── Workflows list ──────────────────────────────────────────────────────────
function renderWorkflowsList() {
  if (savedWorkflows.length === 0) {
    workflowsList.innerHTML = '<p class="muted">No workflows saved yet.</p>';
    return;
  }
  workflowsList.innerHTML = '';
  for (const wf of savedWorkflows) {
    const card = document.createElement('div');
    card.className = 'workflow-card';
    const date = new Date(wf.createdAt).toLocaleString();
    card.innerHTML = `
      <div class="workflow-card-header">
        <span class="workflow-card-name">${esc(wf.name)}</span>
        <span class="workflow-card-meta">${esc(date)}</span>
      </div>
      <div class="workflow-card-steps">${wf.steps.length} step${wf.steps.length !== 1 ? 's' : ''} · ID: <code>${esc(wf.id)}</code></div>
      <div class="workflow-card-actions">
        <button class="btn btn-primary btn-sm" data-action="select" data-id="${esc(wf.id)}">▶ Select</button>
        <button class="btn btn-ghost btn-sm" data-action="inspect" data-id="${esc(wf.id)}">🔍 Inspect</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${esc(wf.id)}">✕ Delete</button>
      </div>
      <div class="inspect-panel hidden" id="inspect-${esc(wf.id)}"></div>
    `;
    workflowsList.appendChild(card);
  }
}

workflowsList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const wf = savedWorkflows.find(w => w.id === id);
  if (!wf) return;

  if (action === 'select') {
    selectedWorkflow = wf;
    renderWorkflowInfo();
    document.querySelector('[data-tab="replay"]').click();
  } else if (action === 'inspect') {
    const panel = document.getElementById(`inspect-${id}`);
    if (panel.classList.contains('hidden')) {
      panel.innerHTML = '<ol>' + wf.steps.map(s =>
        `<li style="font-size:10px;color:#888;margin:3px 0">${esc(s.order+1)}. ${esc(s.label)}</li>`
      ).join('') + '</ol>';
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  } else if (action === 'delete') {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    savedWorkflows = savedWorkflows.filter(w => w.id !== id);
    await saveWorkflows();
    if (selectedWorkflow?.id === id) {
      selectedWorkflow = null;
      renderWorkflowInfo();
    }
    renderWorkflowsList();
  }
});

// ── Replay tab ──────────────────────────────────────────────────────────────
function renderWorkflowInfo() {
  if (!selectedWorkflow) {
    noWorkflowSelected.classList.remove('hidden');
    selectedWorkflowInfo.classList.add('hidden');
    btnStartReplay.disabled = true;
    return;
  }
  noWorkflowSelected.classList.add('hidden');
  selectedWorkflowInfo.classList.remove('hidden');
  rpWorkflowName.textContent = selectedWorkflow.name;
  rpStepCount.textContent = selectedWorkflow.steps.length;
  btnStartReplay.disabled = false;
}

async function refreshReplayTargetRecord() {
  try {
    const result = await sendToContent({ type: 'GET_RECORD_INFO' });
    if (result?.name) {
      rpTargetRecord.textContent = result.name;
      currentRecord.textContent = result.name;
    } else {
      rpTargetRecord.textContent = '—';
      currentRecord.textContent = 'No record open';
    }
  } catch {
    rpTargetRecord.textContent = '—';
  }
}

// Reset demo data
btnResetDemo.addEventListener('click', async () => {
  if (!confirm('Reset CRM demo data? All customers will be reset to New status with empty notes.')) return;
  try {
    await sendToContent({ type: 'RESET_DEMO_DATA' });
    alert('Demo data reset. Reload the CRM page.');
  } catch (e) {
    // If content script doesn't handle it, inject directly – won't work from panel
    // Tell user to reload manually
    alert('Could not reach the CRM page. Please reload crm-demo and click the Reset button there.');
  }
});

// Start replay
btnStartReplay.addEventListener('click', async () => {
  if (!selectedWorkflow) return;
  replayComplete = false;
  activeRunId = null;
  lastRunWorkflow = selectedWorkflow;
  timelineList.innerHTML = '';
  verifyResults.classList.add('hidden');
  replayError.classList.add('hidden');
  btnVerify.classList.add('hidden');
  btnRetry.classList.add('hidden');
  confirmDialog.classList.add('hidden');

  // Render initial timeline
  for (const step of selectedWorkflow.steps) {
    addTimelineItem(step.id, step.label, 'pending');
  }

  btnStartReplay.disabled = true;
  btnCancelReplay.classList.remove('hidden');

  try {
    await sendToContent({ type: 'START_REPLAY', workflow: selectedWorkflow });
  } catch (e) {
    showReplayError(`Could not start replay: ${e.message}`);
    btnStartReplay.disabled = false;
    btnCancelReplay.classList.add('hidden');
  }
});

btnCancelReplay.addEventListener('click', async () => {
  await sendToContent({ type: 'CANCEL_REPLAY' }).catch(() => {});
  btnCancelReplay.classList.add('hidden');
  btnStartReplay.disabled = false;
});

btnVerify.addEventListener('click', async () => {
  if (!lastRunWorkflow) return;
  try {
    const result = await sendToContent({ type: 'RUN_VERIFY', workflow: lastRunWorkflow });
    if (result?.result) renderVerifyResults(result.result);
  } catch (e) {
    showReplayError(`Verify failed: ${e.message}`);
  }
});

btnRetry.addEventListener('click', async () => {
  if (!lastRunWorkflow || !activeRunId) return;
  btnRetry.classList.add('hidden');
  replayError.classList.add('hidden');
  confirmDialog.classList.add('hidden');
  btnCancelReplay.classList.remove('hidden');
  btnStartReplay.disabled = true;
  try {
    await sendToContent({ type: 'START_REPLAY', workflow: lastRunWorkflow, resumeRunId: activeRunId });
  } catch (e) {
    showReplayError(`Retry failed: ${e.message}`);
    btnStartReplay.disabled = false;
    btnCancelReplay.classList.add('hidden');
    btnRetry.classList.remove('hidden');
  }
});

// Confirm dialog
btnConfirmYes.addEventListener('click', () => {
  if (!pendingConfirm) return;
  const { runId, stepId } = pendingConfirm;
  confirmDialog.classList.add('hidden');
  pendingConfirm = null;
  sendToContent({ type: 'CONFIRM_STEP', runId, stepId, confirmed: true }).catch(() => {});
});

btnConfirmNo.addEventListener('click', () => {
  if (!pendingConfirm) return;
  const { runId, stepId } = pendingConfirm;
  confirmDialog.classList.add('hidden');
  pendingConfirm = null;
  sendToContent({ type: 'CONFIRM_STEP', runId, stepId, confirmed: false }).catch(() => {});
});

// ── Incoming messages from content script (via background relay) ─────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg._fromContent) return;

  switch (msg.type) {
    case 'RECORDING_STARTED':
      recording = true;
      break;

    case 'RECORDING_STOPPED':
      recording = false;
      break;

    case 'STEP_RECORDED':
      pendingSteps.push(msg.step);
      noStepsMsg.classList.add('hidden');
      addStepToList(msg.step);
      break;

    case 'RECORDER_WARNING':
      showWarning(msg.message);
      break;

    case 'REPLAY_STARTED':
      activeRunId = msg.runId;
      refreshReplayTargetRecord();
      break;

    case 'STEP_STATUS':
      updateTimelineItem(msg.stepId, msg.status, msg.detail);
      break;

    case 'CONFIRM_REQUIRED':
      pendingConfirm = { runId: msg.runId, stepId: msg.stepId, label: msg.label };
      confirmMsg.textContent = `About to execute: "${msg.label}". This is a consequential action. Proceed?`;
      confirmDialog.classList.remove('hidden');
      break;

    case 'REPLAY_STOPPED': {
      btnCancelReplay.classList.add('hidden');
      btnStartReplay.disabled = false;
      btnRetry.classList.remove('hidden');
      showReplayError(`Stopped: ${msg.reason || 'unknown reason'}`);
      break;
    }

    case 'REPLAY_COMPLETE':
      replayComplete = true;
      btnCancelReplay.classList.add('hidden');
      btnStartReplay.disabled = false;
      btnVerify.classList.remove('hidden');
      replayError.classList.add('hidden');
      break;

    case 'VERIFY_RESULT':
      renderVerifyResults(msg.result);
      break;
  }
});

// ── Timeline helpers ─────────────────────────────────────────────────────────
const STATUS_ICONS = {
  pending: '○', running: '◌', success: '✓', failed: '✕', skipped: '↷'
};

function addTimelineItem(stepId, label, status) {
  const li = document.createElement('li');
  li.id = `tl-${stepId}`;
  li.className = `timeline-item status-${status}`;
  li.innerHTML = `
    <span class="timeline-icon">${STATUS_ICONS[status] || '○'}</span>
    <div class="timeline-body">
      <span class="timeline-label">${esc(label)}</span>
      <span class="timeline-status">${status}</span>
    </div>
  `;
  timelineList.appendChild(li);
}

function updateTimelineItem(stepId, status, detail) {
  const li = document.getElementById(`tl-${stepId}`);
  if (!li) return;
  li.className = `timeline-item status-${status}`;
  li.querySelector('.timeline-icon').textContent = STATUS_ICONS[status] || '○';
  li.querySelector('.timeline-status').textContent = status;
  if (detail) {
    let d = li.querySelector('.timeline-detail');
    if (!d) { d = document.createElement('div'); d.className = 'timeline-detail'; li.querySelector('.timeline-body').appendChild(d); }
    d.textContent = detail;
  }
}

// ── Verification helpers ─────────────────────────────────────────────────────
function renderVerifyResults(result) {
  verifyResults.classList.remove('hidden');
  verifyOverall.textContent = `Overall: ${result.overall.toUpperCase()}`;
  verifyOverall.className = `overall-${result.overall}`;
  verifyTbody.innerHTML = '';
  for (const f of result.fields || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(f.field)}</td>
      <td>${esc(String(f.expected ?? ''))}</td>
      <td>${esc(String(f.observed ?? ''))}</td>
      <td class="td-${f.status}">${esc(f.status)}</td>
    `;
    verifyTbody.appendChild(tr);
  }
}

// ── Live step list (record tab) ──────────────────────────────────────────────
function addStepToList(step) {
  const li = document.createElement('li');
  li.textContent = `${step.order + 1}. ${step.label}`;
  stepsList.appendChild(li);
}

// ── Error / warning display ──────────────────────────────────────────────────
function showWarning(msg) {
  const div = document.createElement('div');
  div.className = 'warning-msg';
  div.textContent = msg;
  warningsContainer.appendChild(div);
}

function showError(msg) {
  alert(msg);
}

function showReplayError(msg) {
  replayError.textContent = msg;
  replayError.classList.remove('hidden');
}

// ── Utilities ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Poll for current record ──────────────────────────────────────────────────
async function pollCurrentRecord() {
  try {
    const result = await sendToContent({ type: 'GET_RECORD_INFO' });
    if (result?.name) {
      currentRecord.textContent = result.name;
    }
  } catch {}
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadWorkflows();
  renderWorkflowsList();
  renderWorkflowInfo();
  pollCurrentRecord();
  // Poll every 2s to keep current record name updated
  setInterval(pollCurrentRecord, 2000);
}

init();
