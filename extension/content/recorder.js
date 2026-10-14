// recorder.js – Capture-phase event listener based workflow recorder

'use strict';

const SENSITIVE_PATTERN = /pass|pwd|secret|token|card|cvv|ssn|otp/i;

let _recording = false;
let _steps = [];
let _recordId = null; // current record id to detect record-specific targets
let _badge = null;

function getCurrentRecordId() {
  // Extract from hash: #/customers/c1
  const m = location.hash.match(/#\/customers\/([^/?]+)/);
  return m ? m[1] : null;
}

function isSensitiveField(el) {
  if (el.type === 'password') return true;
  const attrs = [el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.placeholder].join(' ');
  return SENSITIVE_PATTERN.test(attrs);
}

function isActionableButton(el) {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return true;
  if (tag === 'input' && (el.type === 'submit' || el.type === 'button')) return true;
  if (el.getAttribute('role') === 'button') return true;
  if (tag === 'a' && el.href) return true;
  return false;
}

function isFormControl(el) {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return ['select', 'input', 'textarea'].includes(tag);
}

function makeStepId() {
  return 'step_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function humanLabel(action, target, value) {
  if (action === 'select') return `Select "${value}" in ${target.labelText || target.testid || target.ariaLabel || 'field'}`;
  if (action === 'type') return `Type into ${target.labelText || target.testid || target.ariaLabel || 'field'}`;
  if (action === 'click') return `Click ${target.ariaLabel || target.labelText || target.testid || 'button'}`;
  return action;
}

function isConsequential(el) {
  const testid = (el.getAttribute('data-testid') || '').toLowerCase();
  const text = el.textContent.trim().toLowerCase();
  const id = (el.id || '').toLowerCase();
  return /save|submit|delete|remove|confirm|apply/.test(testid + ' ' + text + ' ' + id);
}

// Pending change tracking (for select/input/textarea – record final value, not per-keystroke)
const _pendingChanges = new Map(); // el → { timer, originalValue }

function handleChange(e) {
  if (!_recording) return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();
  if (!['select', 'input', 'textarea'].includes(tag)) return;

  // Re-use existing pending timer (debounce to get final value)
  if (_pendingChanges.has(el)) {
    clearTimeout(_pendingChanges.get(el).timer);
  }

  const timer = setTimeout(() => {
    _pendingChanges.delete(el);
    recordChangeStep(el);
  }, 400);

  _pendingChanges.set(el, { timer });
}

function recordChangeStep(el) {
  const sensitive = isSensitiveField(el);
  const tag = el.tagName.toLowerCase();
  const action = tag === 'select' ? 'select' : 'type';

  const { buildTarget } = window.__replaySelectors;
  const rid = getCurrentRecordId();
  const target = buildTarget(el, rid);

  if (target.error === 'record-specific') {
    notifyPanel({ type: 'RECORDER_WARNING', message: `Skipped step: target "${target.testid || target.id}" looks record-specific` });
    return;
  }

  const value = sensitive ? null : el.value;
  const step = {
    id: makeStepId(),
    order: _steps.length,
    action,
    target,
    value,
    sensitive,
    consequential: false,
    label: humanLabel(action, target, value)
  };

  _steps.push(step);
  notifyPanel({ type: 'STEP_RECORDED', step });
}

function handleClick(e) {
  if (!_recording) return;
  const el = e.target.closest('button, [role=button], input[type=submit], input[type=button], a[href]');
  if (!el) return;

  // Ignore the REC badge itself and extension UI
  if (el.id === '__replay_badge__') return;
  if (el.closest('#__replay_badge_wrapper__')) return;

  const { buildTarget } = window.__replaySelectors;
  const rid = getCurrentRecordId();
  const target = buildTarget(el, rid);

  if (target.error === 'record-specific') {
    notifyPanel({ type: 'RECORDER_WARNING', message: `Skipped click: target "${target.testid || target.id}" looks record-specific` });
    return;
  }

  const step = {
    id: makeStepId(),
    order: _steps.length,
    action: 'click',
    target,
    value: null,
    sensitive: false,
    consequential: isConsequential(el),
    label: humanLabel('click', target, null)
  };

  _steps.push(step);
  notifyPanel({ type: 'STEP_RECORDED', step });
}

function notifyPanel(msg) {
  chrome.runtime.sendMessage({ ...msg, _fromContent: true }).catch(() => {});
}

function injectBadge() {
  if (document.getElementById('__replay_badge_wrapper__')) return;
  const wrapper = document.createElement('div');
  wrapper.id = '__replay_badge_wrapper__';
  wrapper.style.cssText = `
    position: fixed; top: 12px; right: 12px; z-index: 2147483647;
    background: #e53e3e; color: white; font-family: monospace;
    font-size: 13px; font-weight: bold; padding: 4px 10px;
    border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.4);
    pointer-events: none; user-select: none;
  `;
  wrapper.textContent = '● REC';
  document.body.appendChild(wrapper);
  _badge = wrapper;
}

function removeBadge() {
  if (_badge) { _badge.remove(); _badge = null; }
  const el = document.getElementById('__replay_badge_wrapper__');
  if (el) el.remove();
}

function startRecording(recordId) {
  _recording = true;
  _steps = [];
  _recordId = recordId || getCurrentRecordId();
  document.addEventListener('change', handleChange, { capture: true });
  document.addEventListener('click', handleClick, { capture: true });
  injectBadge();
  notifyPanel({ type: 'RECORDING_STARTED' });
}

function stopRecording() {
  _recording = false;
  document.removeEventListener('change', handleChange, { capture: true });
  document.removeEventListener('click', handleClick, { capture: true });
  // Flush any pending debounced changes
  for (const [el, { timer }] of _pendingChanges) {
    clearTimeout(timer);
    recordChangeStep(el);
  }
  _pendingChanges.clear();
  removeBadge();

  const recordName = document.querySelector('[data-testid="record-name"]')?.textContent?.trim() || '';
  const result = { steps: _steps, sourceRecordLabel: recordName };
  notifyPanel({ type: 'RECORDING_STOPPED', ...result });
  return result;
}

function isRecording() { return _recording; }
function getSteps() { return _steps; }

window.__replayRecorder = { startRecording, stopRecording, isRecording, getSteps };
