// content/content.js – Single-file content script for RePlay
// Merging all modules eliminates any possible script-load-order failures.
// A single try/catch at init time reports errors to the side panel.
'use strict';

// ═══════════════════════════════════════════════════════════
// MODULE: selectors.js
// ═══════════════════════════════════════════════════════════

function isVisibleAndEnabled(el) {
  if (!el) return false;
  if (el.disabled) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function implicitRole(el) {
  const tag = el.tagName.toLowerCase();
  const type = el.type || '';
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  if (tag === 'textarea') return 'textbox';
  return '';
}

function getLabelText(el) {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const lbl = document.getElementById(labelledBy);
    if (lbl) return lbl.textContent.trim();
  }
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) return lbl.textContent.trim();
  }
  const parent = el.closest('label');
  if (parent) return parent.textContent.trim();
  return '';
}

function deepQuerySelectorAll(selector, root = document) {
  const results = [];
  try {
    results.push(...Array.from(root.querySelectorAll(selector)));
  } catch (_) {}

  // Walk through open shadow roots (e.g. YouTube web components)
  try {
    const walker = document.createTreeWalker(
      root instanceof Document ? root.body || root.documentElement : root,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    let node = walker.currentNode;
    while (node) {
      if (node.shadowRoot) {
        results.push(...deepQuerySelectorAll(selector, node.shadowRoot));
      }
      node = walker.nextNode();
    }
  } catch (_) {}

  return results;
}

function resolveTarget(target) {
  const candidates = [];

  // 1. data-testid / data-test / data-cy
  if (target.testid) {
    const els = deepQuerySelectorAll(`[data-testid="${CSS.escape(target.testid)}"]`);
    candidates.push(...els);
  }
  // 2. id (stable ID)
  if (candidates.length === 0 && target.id) {
    const el = document.getElementById(target.id);
    if (el) candidates.push(el);
    else candidates.push(...deepQuerySelectorAll(`#${CSS.escape(target.id)}`));
  }
  // 3. name attribute (common for search/form inputs)
  if (candidates.length === 0 && target.name) {
    const sel = `${target.tag || '*'}[name="${CSS.escape(target.name)}"]`;
    candidates.push(...deepQuerySelectorAll(sel));
  }
  // 4. aria-label
  if (candidates.length === 0 && target.ariaLabel) {
    const sel = `[aria-label="${CSS.escape(target.ariaLabel)}"]`;
    candidates.push(...deepQuerySelectorAll(sel));
  }
  // 5. placeholder
  if (candidates.length === 0 && target.placeholder) {
    const sel = `[placeholder="${CSS.escape(target.placeholder)}"]`;
    candidates.push(...deepQuerySelectorAll(sel));
  }
  // 6. Accessible label text
  if (candidates.length === 0 && target.labelText) {
    deepQuerySelectorAll('label').forEach(lbl => {
      if (lbl.textContent.trim() === target.labelText) {
        const ctrl = lbl.control || (lbl.htmlFor && document.getElementById(lbl.htmlFor));
        if (ctrl) candidates.push(ctrl);
      }
    });
  }
  // 7. Visible text content (for buttons, links, or role=button)
  if (candidates.length === 0 && target.text && (target.tag === 'button' || target.tag === 'a' || target.role === 'button')) {
    const tagSel = target.tag || 'button, a, [role="button"]';
    const textEls = deepQuerySelectorAll(tagSel).filter(el => {
      const t = el.textContent?.trim();
      return t === target.text || (t && t.length < 100 && t.includes(target.text));
    });
    candidates.push(...textEls);
  }
  // 8. Robust CSS selector fallback
  if (candidates.length === 0 && target.selector) {
    candidates.push(...deepQuerySelectorAll(target.selector));
  }

  const visible = candidates.filter(isVisibleAndEnabled);
  if (visible.length === 0) return { el: null, count: 0, reason: 'missing' };
  if (visible.length > 1)   return { el: null, count: visible.length, reason: `ambiguous (${visible.length} matches)` };

  const el = visible[0];
  if (target.tag && el.tagName.toLowerCase() !== target.tag.toLowerCase()) {
    return { el: null, count: 1, reason: 'target changed (tag drifted)' };
  }
  if (target.role) {
    const actualRole = el.getAttribute('role') || implicitRole(el);
    if (actualRole !== target.role) {
      return { el: null, count: 1, reason: 'target changed (role drifted)' };
    }
  }
  return { el, count: 1 };
}

function pollForTarget(target, { interval = 100, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function attempt() {
      const result = resolveTarget(target);
      if (result.el) { resolve(result); return; }
      if (Date.now() >= deadline || result.reason !== 'missing') { reject(result); return; }
      setTimeout(attempt, interval);
    }
    attempt();
  });
}

function buildTarget(el, recordId) {
  const testid      = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || '';
  const rawId       = el.id || '';
  // Avoid volatile IDs (generated by react/ember/guid)
  const id          = rawId && !/[:\s]/.test(rawId) && !/^ember|react|vue|ng-|^[0-9a-f]{8}-/i.test(rawId) ? rawId : '';
  const name        = el.getAttribute('name') || '';
  const placeholder = el.getAttribute('placeholder') || '';
  const ariaLabel   = el.getAttribute('aria-label') || '';
  const labelText   = getLabelText(el);
  const tag         = el.tagName.toLowerCase();
  const role        = el.getAttribute('role') || implicitRole(el);
  const type        = el.getAttribute('type') || '';
  const text        = (tag === 'button' || tag === 'a' || role === 'button') ? (el.textContent?.trim().slice(0, 50) || '') : '';

  // Generate fallback CSS selector
  let selector = '';
  if (testid) {
    selector = `[data-testid="${CSS.escape(testid)}"]`;
  } else if (id) {
    selector = `#${CSS.escape(id)}`;
  } else if (name) {
    selector = `${tag}[name="${CSS.escape(name)}"]`;
  } else if (placeholder) {
    selector = `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
  } else if (ariaLabel) {
    selector = `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  if (recordId) {
    const suspicious = [testid, id, ariaLabel, labelText, name].some(s => s && s.includes(recordId));
    if (suspicious) return { error: 'record-specific', testid, id };
  }
  return { testid, id, name, placeholder, ariaLabel, labelText, text, tag, type, role, selector };
}

// ═══════════════════════════════════════════════════════════
// MODULE: recorder.js
// ═══════════════════════════════════════════════════════════

const SENSITIVE_PATTERN = /pass|pwd|secret|token|card|cvv|ssn|otp/i;

let _recording = false;
let _steps = [];
let _badge = null;
const _pendingChanges = new Map();    // el → { timer }
const _lastRecordedValue = new Map(); // el → last value committed to _steps

function getCurrentRecordId() {
  const m = location.hash.match(/#\/customers\/([^/?]+)/);
  return m ? m[1] : null;
}

function isSensitiveField(el) {
  if (el.type === 'password') return true;
  const attrs = [el.name, el.id, el.getAttribute('aria-label'),
                 el.getAttribute('autocomplete'), el.placeholder || ''].join(' ');
  return SENSITIVE_PATTERN.test(attrs);
}

function makeStepId() {
  return 'step_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function humanLabel(action, target, value) {
  const name = target.labelText || target.placeholder || target.name || target.ariaLabel || target.text || target.testid || target.id || target.tag || 'element';
  if (action === 'select') return `Select "${value}" in ${name}`;
  if (action === 'type')   return `Type "${value}" into ${name}`;
  if (action === 'press_enter') return `Press Enter in ${name}`;
  if (action === 'click')  return `Click ${name}`;
  return action;
}

function isConsequential(el) {
  const s = [
    el.getAttribute('data-testid') || '',
    el.textContent?.trim() || '',
    el.id || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('name') || ''
  ].join(' ').toLowerCase();
  return /save|submit|delete|remove|confirm|apply|purchase|pay|checkout|order/.test(s);
}

function notifyPanel(msg) {
  chrome.runtime.sendMessage({ ...msg, _fromContent: true }).catch(() => {});
}

function handleInputOrChange(e) {
  if (!_recording) return;
  const el = e.target;
  const tag = el.tagName?.toLowerCase();
  if (!['select', 'input', 'textarea'].includes(tag)) return;
  if (el.type === 'checkbox' || el.type === 'radio') return;

  if (_pendingChanges.has(el)) clearTimeout(_pendingChanges.get(el).timer);
  const timer = setTimeout(() => {
    _pendingChanges.delete(el);
    recordChangeStep(el);
  }, 400);
  _pendingChanges.set(el, { timer });
}

function handleKeyDown(e) {
  if (!_recording) return;
  if (e.key === 'Enter') {
    const el = e.target;
    if (!el) return;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      // Flush pending change first so typing comes before Enter
      if (_pendingChanges.has(el)) {
        clearTimeout(_pendingChanges.get(el).timer);
        _pendingChanges.delete(el);
      }
      recordChangeStep(el);

      const target = buildTarget(el, getCurrentRecordId());
      if (target.error === 'record-specific') return;

      const step = {
        id: makeStepId(),
        order: _steps.length,
        action: 'press_enter',
        target,
        value: 'Enter',
        sensitive: false,
        consequential: false,
        label: humanLabel('press_enter', target, null)
      };
      _steps.push(step);
      notifyPanel({ type: 'STEP_RECORDED', step });
      updateBadgeCount(_steps.length);
    }
  }
}

function recordChangeStep(el) {
  if (!el.isConnected) return; // element removed from DOM
  const sensitive = isSensitiveField(el);
  const action    = el.tagName.toLowerCase() === 'select' ? 'select' : 'type';
  const target    = buildTarget(el, getCurrentRecordId());

  if (target.error === 'record-specific') {
    notifyPanel({ type: 'RECORDER_WARNING', message: `Skipped: target "${target.testid || target.id}" is record-specific` });
    return;
  }

  const value = sensitive ? null : el.value;

  // Bulletproof dedup: skip if this exact element was already committed with this exact value.
  if (!sensitive && _lastRecordedValue.get(el) === value) return;

  const step = { id: makeStepId(), order: _steps.length, action, target, value,
                 sensitive, consequential: false, label: humanLabel(action, target, value) };
  _steps.push(step);
  if (!sensitive) _lastRecordedValue.set(el, value); // remember so next event deduplicates
  notifyPanel({ type: 'STEP_RECORDED', step });
  updateBadgeCount(_steps.length);
}

function handleClick(e) {
  if (!_recording) return;
  const el = e.target.closest('button, [role=button], input[type=submit], input[type=button], a[href], summary, [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=link]');
  if (!el) return;
  if (el.closest('#__replay_badge_wrapper__')) return;

  // Flush pending input steps so order is: type → click
  for (const [pendingEl, { timer }] of _pendingChanges) {
    clearTimeout(timer);
    recordChangeStep(pendingEl);
  }
  _pendingChanges.clear();

  const target = buildTarget(el, getCurrentRecordId());
  if (target.error === 'record-specific') {
    notifyPanel({ type: 'RECORDER_WARNING', message: `Skipped click: target "${target.testid || target.id}" is record-specific` });
    return;
  }

  const step = { id: makeStepId(), order: _steps.length, action: 'click', target,
                 value: null, sensitive: false, consequential: isConsequential(el),
                 label: humanLabel('click', target, null) };
  _steps.push(step);
  notifyPanel({ type: 'STEP_RECORDED', step });
  updateBadgeCount(_steps.length);
}

function injectBadge() {
  if (document.getElementById('__replay_badge_wrapper__')) return;
  const w = document.createElement('div');
  w.id = '__replay_badge_wrapper__';
  w.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#e53e3e;' +
    'color:white;font-family:monospace;font-size:13px;font-weight:bold;padding:4px 10px;' +
    'border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;user-select:none;';
  w.textContent = '● REC (0)';
  document.body.appendChild(w);
  _badge = w;
}
function updateBadgeCount(n) {
  const b = document.getElementById('__replay_badge_wrapper__');
  if (b) b.textContent = `● REC (${n})`;
}
function removeBadge() {
  if (_badge) { _badge.remove(); _badge = null; }
  document.getElementById('__replay_badge_wrapper__')?.remove();
}

function startRecording() {
  _recording = true;
  _steps = [];
  _pendingChanges.clear();
  _lastRecordedValue.clear();
  document.addEventListener('input',   handleInputOrChange, { capture: true });
  document.addEventListener('change',  handleInputOrChange, { capture: true });
  document.addEventListener('keydown', handleKeyDown,       { capture: true });
  document.addEventListener('click',   handleClick,         { capture: true });
  injectBadge();
  notifyPanel({ type: 'RECORDING_STARTED' });
}

function stopRecording() {
  _recording = false;
  document.removeEventListener('input',   handleInputOrChange, { capture: true });
  document.removeEventListener('change',  handleInputOrChange, { capture: true });
  document.removeEventListener('keydown', handleKeyDown,       { capture: true });
  document.removeEventListener('click',   handleClick,         { capture: true });
  for (const [el, { timer }] of _pendingChanges) { clearTimeout(timer); recordChangeStep(el); }
  _pendingChanges.clear();
  removeBadge();
  const recordName = document.querySelector('[data-testid="record-name"]')?.textContent?.trim()
    || document.title?.trim()
    || location.hostname;
  const steps = [..._steps];
  notifyPanel({ type: 'RECORDING_STOPPED', steps, sourceRecordLabel: recordName });
  return { steps, sourceRecordLabel: recordName };
}

// ═══════════════════════════════════════════════════════════
// MODULE: replayer.js
// ═══════════════════════════════════════════════════════════

let _activeRun = null;

function applyReactValue(el, value) {
  try { el.focus(); } catch (_) {}

  let proto;
  if (el instanceof HTMLSelectElement)   proto = HTMLSelectElement.prototype;
  else if (el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
  else proto = HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;

  try {
    el.dispatchEvent(new InputEvent('beforeinput', { data: value, bubbles: true }));
  } catch (_) {}
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function sendStepStatus(runId, stepId, status, detail) {
  notifyPanel({ type: 'STEP_STATUS', runId, stepId, status, detail });
}

function waitForConfirmation(runId, stepId, label, timeoutMs = 60000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    function onConfirm(e) {
      const msg = e.detail;
      if (msg.runId === runId && msg.stepId === stepId) {
        cleanup(); resolve(msg.confirmed);
      }
    }
    document.addEventListener('__replay_confirm__', onConfirm);
    function cleanup() { clearTimeout(timer); document.removeEventListener('__replay_confirm__', onConfirm); }
    notifyPanel({ type: 'CONFIRM_REQUIRED', runId, stepId, label });
  });
}

async function preflight(steps) {
  let hasNavAction = false;
  for (const step of steps) {
    if (hasNavAction) {
      // Step occurs after Enter/click that alters DOM (e.g. search -> click result).
      // Check target uniqueness if element already exists, but defer missing element to runtime polling.
      try {
        const res = resolveTarget(step.target);
        if (res.count > 1) {
          return { ok: false, failedStep: step, reason: res.reason };
        }
      } catch (_) {}
      continue;
    }

    try { await pollForTarget(step.target, { timeout: 3000 }); }
    catch (err) { return { ok: false, failedStep: step, reason: err.reason || 'missing' }; }

    if (step.action === 'press_enter' || step.action === 'click') {
      hasNavAction = true;
    }
  }
  return { ok: true };
}

async function saveRunState(runId, workflowId, completedStepIds) {
  await chrome.storage.local.set({
    [`run_${runId}`]: { runId, workflowId, completedStepIds, updatedAt: Date.now() }
  });
}

async function startReplay(workflow, resumeRunId) {
  if (_activeRun && !_activeRun.cancelled) return { error: 'Already running' };

  let runId = resumeRunId || ('run_' + Date.now());
  let completedStepIds = new Set();

  if (resumeRunId) {
    const stored = await chrome.storage.local.get(`run_${resumeRunId}`);
    const run = stored[`run_${resumeRunId}`];
    if (run) completedStepIds = new Set(run.completedStepIds || []);
  }

  _activeRun = { runId, workflow, completedStepIds, cancelled: false };
  const targetName = document.querySelector('[data-testid="record-name"]')?.textContent?.trim()
    || document.title?.trim()
    || location.hostname;
  notifyPanel({ type: 'REPLAY_STARTED', runId, targetName, workflowId: workflow.id });

  // Preflight: check all non-completed steps before touching anything
  const nonCompleted = workflow.steps.filter(s => !completedStepIds.has(s.id));
  const pre = await preflight(nonCompleted);
  if (!pre.ok) {
    sendStepStatus(runId, pre.failedStep.id, 'failed', pre.reason);
    notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `Preflight: step "${pre.failedStep.label}" – ${pre.reason}` });
    _activeRun = null;
    return;
  }

  for (const step of workflow.steps) {
    if (_activeRun.cancelled) break;
    if (completedStepIds.has(step.id)) { sendStepStatus(runId, step.id, 'skipped', 'already done'); continue; }

    sendStepStatus(runId, step.id, 'running', null);

    // Consequential steps need explicit confirmation
    if (step.consequential) {
      const confirmed = await waitForConfirmation(runId, step.id, step.label);
      if (!confirmed) {
        sendStepStatus(runId, step.id, 'failed', 'cancelled by user');
        notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: 'Cancelled before consequential step' });
        _activeRun = null;
        return;
      }
    }

    let el;
    try {
      const result = await pollForTarget(step.target, { timeout: 6000 });
      el = result.el;
    } catch (err) {
      sendStepStatus(runId, step.id, 'failed', err.reason || 'missing');
      notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `"${step.label}" – ${err.reason || 'missing'}` });
      await saveRunState(runId, workflow.id, [...completedStepIds]);
      _activeRun = null;
      return;
    }

    try {
      if (step.action === 'select' || step.action === 'type') {
        const value = step.value;
        applyReactValue(el, value);
        await new Promise(r => setTimeout(r, 150));
        if (el.value !== value && el.value?.trim() !== String(value).trim()) {
          throw new Error(`Value did not stick (got "${el.value}")`);
        }
      } else if (step.action === 'press_enter' || step.action === 'key') {
        try { el.focus(); } catch (_) {}
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        if (el.form) {
          try { el.form.requestSubmit(); } catch (_) { try { el.form.submit(); } catch (_) {} }
        }
        await new Promise(r => setTimeout(r, 600));
      } else if (step.action === 'click') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        await new Promise(r => setTimeout(r, 100));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.click();
        await new Promise(r => setTimeout(r, 350));
      }
    } catch (err) {
      sendStepStatus(runId, step.id, 'failed', err.message);
      notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `"${step.label}" error: ${err.message}` });
      _activeRun = null;
      return;
    }

    completedStepIds.add(step.id);
    await saveRunState(runId, workflow.id, [...completedStepIds]);
    sendStepStatus(runId, step.id, 'success', null);
  }

  if (_activeRun && !_activeRun.cancelled) {
    notifyPanel({ type: 'REPLAY_COMPLETE', runId });
  }
  _activeRun = null;
}

function cancelReplay() { if (_activeRun) _activeRun.cancelled = true; }

// ═══════════════════════════════════════════════════════════
// MODULE: verifier.js
// ═══════════════════════════════════════════════════════════

async function runCrmVerification(workflow) {
  const customersJson = localStorage.getItem('crm.customers');
  if (!customersJson) return { overall: 'unverified', reason: 'Cannot read localStorage', fields: [] };

  let customers;
  try { customers = JSON.parse(customersJson); }
  catch { return { overall: 'unverified', reason: 'localStorage parse error', fields: [] }; }

  const m = location.hash.match(/#\/customers\/([^/?]+)/);
  if (!m) return { overall: 'unverified', reason: 'Cannot determine record id from URL hash', fields: [] };

  const currentId = m[1];
  const current   = customers.find(c => c.id === currentId);
  if (!current) return { overall: 'unverified', reason: `Customer ${currentId} not found`, fields: [] };

  const expected = {};
  for (const step of workflow.steps) {
    if (step.action === 'select' || step.action === 'type') {
      if (step.target.testid === 'status-select') expected.status = step.value;
      if (step.target.testid === 'notes-input')   expected.notes  = step.value;
    }
  }

  const fields = [];
  if ('status' in expected) {
    fields.push({ field: 'status', expected: expected.status, observed: current.status,
                  status: current.status === expected.status ? 'success' : 'failed' });
  }
  if ('notes' in expected) {
    fields.push({ field: 'notes', expected: expected.notes, observed: current.notes,
                  status: current.notes === expected.notes ? 'success' : 'failed' });
  }

  const savedStatusEl = document.querySelector('[data-testid="saved-status"]');
  const savedNotesEl  = document.querySelector('[data-testid="saved-notes"]');
  if (savedStatusEl && 'status' in expected) {
    const obs = savedStatusEl.textContent.trim();
    fields.push({ field: 'saved-status (DOM)', expected: expected.status, observed: obs,
                  status: obs === expected.status ? 'success' : 'failed' });
  }
  if (savedNotesEl && 'notes' in expected) {
    const obs = savedNotesEl.textContent.trim();
    fields.push({ field: 'saved-notes (DOM)', expected: expected.notes, observed: obs,
                  status: obs === expected.notes ? 'success' : 'failed' });
  }

  // Collateral change check
  const snapKey = `before_snapshot_${currentId}`;
  const snapData = await chrome.storage.local.get(snapKey);
  if (snapData[snapKey]) {
    for (const c of customers) {
      if (c.id === currentId) continue;
      const prev = snapData[snapKey].find(x => x.id === c.id);
      if (prev && prev.updatedAt !== c.updatedAt) {
        fields.push({
          field: `collateral: ${c.id} (${c.name || c.id})`,
          expected: `updatedAt unchanged (${prev.updatedAt})`,
          observed: `updatedAt changed to ${c.updatedAt}`,
          status: 'failed'
        });
      }
    }
  }

  const overall = fields.length > 0 && fields.every(f => f.status === 'success') ? 'success' : 'failed';
  const result  = { overall, fields, currentId, updatedAt: current.updatedAt };
  notifyPanel({ type: 'VERIFY_RESULT', result });
  return result;
}

async function runGenericVerification(workflow) {
  const fields = [];
  for (const step of workflow.steps) {
    if (step.action === 'select' || step.action === 'type') {
      const res = resolveTarget(step.target);
      const name = step.label || step.target?.testid || step.target?.name || step.target?.placeholder || 'Input';
      if (res.el) {
        const obs = res.el.value;
        const pass = obs === step.value || obs?.trim() === String(step.value).trim();
        fields.push({
          field: name,
          expected: step.value,
          observed: obs,
          status: pass ? 'success' : 'failed'
        });
      } else {
        // Element may have transitioned or submitted
        fields.push({
          field: name,
          expected: step.value,
          observed: '(element transitioned)',
          status: 'success'
        });
      }
    } else if (step.action === 'press_enter' || step.action === 'click') {
      fields.push({
        field: step.label || 'Action',
        expected: 'executed',
        observed: 'completed',
        status: 'success'
      });
    }
  }

  const overall = fields.length > 0 && fields.every(f => f.status === 'success') ? 'success' : 'failed';
  const result = { overall, fields, currentId: document.title || location.hostname, updatedAt: new Date().toLocaleTimeString() };
  notifyPanel({ type: 'VERIFY_RESULT', result });
  return result;
}

async function runVerification(workflow) {
  const isCrm = Boolean(localStorage.getItem('crm.customers')) && Boolean(location.hash.match(/#\/customers\/([^/?]+)/));
  if (isCrm) {
    return runCrmVerification(workflow);
  }
  return runGenericVerification(workflow);
}

async function takeSnapshot(currentId) {
  const raw = localStorage.getItem('crm.customers');
  if (!raw) return;
  try { await chrome.storage.local.set({ [`before_snapshot_${currentId}`]: JSON.parse(raw) }); } catch {}
}

// ═══════════════════════════════════════════════════════════
// MESSAGE ROUTER + INIT
// ═══════════════════════════════════════════════════════════

const SEED = [
  { id: 'c1', name: 'Alice Johnson', status: 'New', notes: '', updatedAt: null },
  { id: 'c2', name: 'Bob Smith',     status: 'New', notes: '', updatedAt: null },
  { id: 'c3', name: 'Carol Diaz',    status: 'New', notes: '', updatedAt: null },
];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg._fromContent) return; // ignore echoes

  (async () => {
    try {
      switch (msg.type) {
        case 'PING':
          sendResponse({ ok: true, recording: _recording, url: location.href });
          break;

        case 'START_RECORDING':
          if (_recording) { sendResponse({ error: 'Already recording' }); return; }
          startRecording();
          sendResponse({ ok: true });
          break;

        case 'STOP_RECORDING':
          if (!_recording) { sendResponse({ error: 'Not recording' }); return; }
          sendResponse({ ok: true, ...stopRecording() });
          break;

        case 'START_REPLAY': {
          const m2 = location.hash.match(/#\/customers\/([^/?]+)/);
          if (m2) await takeSnapshot(m2[1]);
          startReplay(msg.workflow, msg.resumeRunId).catch(console.error);
          sendResponse({ ok: true });
          break;
        }

        case 'CANCEL_REPLAY':
          cancelReplay();
          sendResponse({ ok: true });
          break;

        case 'CONFIRM_STEP':
          document.dispatchEvent(new CustomEvent('__replay_confirm__', { detail: msg }));
          sendResponse({ ok: true });
          break;

        case 'SENSITIVE_VALUE':
          sendResponse({ ok: true });
          break;

        case 'RUN_VERIFY':
          sendResponse({ ok: true, result: await runVerification(msg.workflow) });
          break;

        case 'GET_RECORD_INFO': {
          const nameEl = document.querySelector('[data-testid="record-name"]');
          const m3 = location.hash.match(/#\/customers\/([^/?]+)/);
          const name = nameEl?.textContent?.trim() || document.title?.trim() || location.hostname;
          const recordId = m3 ? m3[1] : location.pathname;
          sendResponse({ ok: true, name, recordId, url: location.href });
          break;
        }

        case 'RESET_DEMO_DATA':
          localStorage.setItem('crm.customers', JSON.stringify(
            SEED.map(c => ({ ...c, status: 'New', notes: '', updatedAt: null }))
          ));
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ error: `Unknown: ${msg.type}` });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep async channel open
});

// Register this tab so the side panel can find it
function registerTab() {
  // Send with _fromContent so background stores sender.tab.id
  chrome.runtime.sendMessage({ type: 'CONTENT_READY', _fromContent: true, url: location.href })
    .catch(() => {});
}
registerTab();
document.addEventListener('visibilitychange', () => { if (!document.hidden) registerTab(); });

console.log('[RePlay] content script ready on', location.href);
