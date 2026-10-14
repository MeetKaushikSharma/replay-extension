// selectors.js – Target resolution utilities
// Resolves a recorded target descriptor to a DOM element.
// Never falls back to nearby elements; requires exactly 1 visible+enabled match.

'use strict';

/**
 * Resolve a target descriptor to exactly one element.
 * Returns { el, count } or throws a ResolveError.
 */
function resolveTarget(target) {
  const candidates = [];

  // 1. data-testid (highest priority)
  if (target.testid) {
    const els = Array.from(document.querySelectorAll(`[data-testid="${CSS.escape(target.testid)}"]`));
    if (els.length) candidates.push(...els);
  }

  // 2. id attribute
  if (candidates.length === 0 && target.id) {
    const el = document.getElementById(target.id);
    if (el) candidates.push(el);
  }

  // 3. aria-label
  if (candidates.length === 0 && target.ariaLabel) {
    const els = Array.from(document.querySelectorAll(`[aria-label="${CSS.escape(target.ariaLabel)}"]`));
    if (els.length) candidates.push(...els);
  }

  // 4. label text + role/tag
  if (candidates.length === 0 && target.labelText) {
    const allLabels = Array.from(document.querySelectorAll('label'));
    for (const lbl of allLabels) {
      if (lbl.textContent.trim() === target.labelText) {
        const ctrl = lbl.control || (lbl.htmlFor && document.getElementById(lbl.htmlFor));
        if (ctrl) candidates.push(ctrl);
      }
    }
  }

  const visible = candidates.filter(isVisibleAndEnabled);

  if (visible.length === 0) {
    return { el: null, count: 0, reason: 'missing' };
  }
  if (visible.length > 1) {
    return { el: null, count: visible.length, reason: `ambiguous (${visible.length} matches)` };
  }

  // Drift check: compare tag / role hint
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
  const map = {
    button: 'button', a: 'link', select: 'combobox',
    input: el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'textbox',
    textarea: 'textbox'
  };
  return map[tag] || '';
}

/**
 * Poll for a target until timeout.
 * Resolves with { el } or rejects with { reason, count }.
 */
function pollForTarget(target, { interval = 100, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    function attempt() {
      const result = resolveTarget(target);
      if (result.el) {
        resolve(result);
        return;
      }
      if (Date.now() >= deadline || result.reason !== 'missing') {
        reject(result);
        return;
      }
      setTimeout(attempt, interval);
    }

    attempt();
  });
}

/**
 * Build a target descriptor from a DOM element.
 * Rejects record-specific targets (those containing a record id).
 */
function buildTarget(el, recordId) {
  const testid = el.getAttribute('data-testid') || '';
  const id = el.id || '';
  const ariaLabel = el.getAttribute('aria-label') || '';
  const labelText = getLabelText(el);
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') || implicitRole(el);

  // Check if any identifier looks record-specific
  if (recordId) {
    const suspicious = [testid, id, ariaLabel, labelText].some(
      s => s && s.includes(recordId)
    );
    if (suspicious) return { error: 'record-specific', testid, id };
  }

  return { testid, id, ariaLabel, labelText, tag, role };
}

function getLabelText(el) {
  // Check for aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }
  // Check for <label for="id">
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) return lbl.textContent.trim();
  }
  // Check for wrapping label
  const parent = el.closest('label');
  if (parent) return parent.textContent.trim();
  return '';
}

// Export for use in other content scripts
window.__replaySelectors = { resolveTarget, pollForTarget, buildTarget, isVisibleAndEnabled };
