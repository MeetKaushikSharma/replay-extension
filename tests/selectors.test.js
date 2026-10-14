// tests/selectors.test.js – Unit tests for selector resolution using jsdom
// Run with: node --test tests/selectors.test.js

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ── Setup jsdom environment ─────────────────────────────────────────────────
function makeDOM(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, {
    url: 'http://localhost:5173/#/customers/c1'
  });
  return dom.window.document;
}

// Re-implement selector logic for testing (mirrors selectors.js)
function isVisibleAndEnabled(el) {
  if (!el) return false;
  if (el.disabled) return false;
  // jsdom doesn't compute layouts, so we skip rect check
  return true;
}

function resolveTarget(target, document) {
  const candidates = [];
  if (target.testid) {
    const els = Array.from(document.querySelectorAll(`[data-testid="${target.testid}"]`));
    if (els.length) candidates.push(...els);
  }
  if (candidates.length === 0 && target.id) {
    const el = document.getElementById(target.id);
    if (el) candidates.push(el);
  }
  if (candidates.length === 0 && target.name) {
    const els = Array.from(document.querySelectorAll(`${target.tag || '*'}[name="${target.name}"]`));
    if (els.length) candidates.push(...els);
  }
  if (candidates.length === 0 && target.ariaLabel) {
    const els = Array.from(document.querySelectorAll(`[aria-label="${target.ariaLabel}"]`));
    if (els.length) candidates.push(...els);
  }
  if (candidates.length === 0 && target.placeholder) {
    const els = Array.from(document.querySelectorAll(`[placeholder="${target.placeholder}"]`));
    if (els.length) candidates.push(...els);
  }
  if (candidates.length === 0 && target.text) {
    const els = Array.from(document.querySelectorAll(target.tag || 'button, a, [role="button"]')).filter(el => el.textContent?.trim() === target.text);
    if (els.length) candidates.push(...els);
  }
  if (candidates.length === 0 && target.selector) {
    try {
      const els = Array.from(document.querySelectorAll(target.selector));
      if (els.length) candidates.push(...els);
    } catch (_) {}
  }
  const visible = candidates.filter(isVisibleAndEnabled);
  if (visible.length === 0) return { el: null, count: 0, reason: 'missing' };
  if (visible.length > 1) return { el: null, count: visible.length, reason: `ambiguous (${visible.length} matches)` };

  const el = visible[0];
  if (target.tag && el.tagName.toLowerCase() !== target.tag.toLowerCase()) {
    return { el: null, count: 1, reason: 'target changed (tag drifted)' };
  }
  if (target.role) {
    const actualRole = el.getAttribute('role') || (el.tagName.toLowerCase() === 'input' ? 'textbox' : '');
    const isTextInput = (r) => ['textbox', 'combobox', 'searchbox'].includes(r);
    const compatible = actualRole === target.role || (isTextInput(actualRole) && isTextInput(target.role));
    if (!compatible) {
      return { el: null, count: 1, reason: 'target changed (role drifted)' };
    }
  }
  return { el, count: 1 };
}

function buildTarget(el, recordId, document) {
  const testid = el.getAttribute('data-testid') || '';
  const id = el.id || '';
  const ariaLabel = el.getAttribute('aria-label') || '';
  const tag = el.tagName.toLowerCase();
  if (recordId) {
    const suspicious = [testid, id, ariaLabel].some(s => s && s.includes(recordId));
    if (suspicious) return { error: 'record-specific', testid, id };
  }
  return { testid, id, ariaLabel, tag };
}

function isSensitiveField(el) {
  const SENSITIVE_PATTERN = /pass|pwd|secret|token|card|cvv|ssn|otp/i;
  if (el.type === 'password') return true;
  const attrs = [el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.placeholder].join(' ');
  return SENSITIVE_PATTERN.test(attrs);
}

function applyReactValue(el, value) {
  // In jsdom we just set directly
  const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true }));
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('Selector resolution', () => {
  test('found: resolves by testid', () => {
    const document = makeDOM('<button data-testid="save-button">Save</button>');
    const result = resolveTarget({ testid: 'save-button' }, document);
    assert.equal(result.count, 1);
    assert.ok(result.el);
    assert.equal(result.el.textContent, 'Save');
  });

  test('missing: returns count=0 and reason=missing', () => {
    const document = makeDOM('<button data-testid="save-button">Save</button>');
    const result = resolveTarget({ testid: 'nonexistent' }, document);
    assert.equal(result.count, 0);
    assert.equal(result.reason, 'missing');
    assert.equal(result.el, null);
  });

  test('ambiguous: returns count>1 and reason starting with "ambiguous"', () => {
    const document = makeDOM(`
      <button data-testid="save-button">Save 1</button>
      <button data-testid="save-button">Save 2</button>
    `);
    const result = resolveTarget({ testid: 'save-button' }, document);
    assert.equal(result.count, 2);
    assert.match(result.reason, /ambiguous/);
    assert.equal(result.el, null);
  });

  test('fallback to id when testid absent', () => {
    const document = makeDOM('<select id="status-select"></select>');
    const result = resolveTarget({ id: 'status-select' }, document);
    assert.equal(result.count, 1);
    assert.ok(result.el);
  });

  test('fallback to aria-label when testid and id absent', () => {
    const document = makeDOM('<select aria-label="Status"></select>');
    const result = resolveTarget({ ariaLabel: 'Status' }, document);
    assert.equal(result.count, 1);
    assert.ok(result.el);
  });

  test('fallback to name attribute (YouTube/search inputs)', () => {
    const document = makeDOM('<input name="search_query" />');
    const result = resolveTarget({ name: 'search_query', tag: 'input' }, document);
    assert.equal(result.count, 1);
    assert.ok(result.el);
  });

  test('fallback to placeholder attribute', () => {
    const document = makeDOM('<input placeholder="Search YouTube" />');
    const result = resolveTarget({ placeholder: 'Search YouTube', tag: 'input' }, document);
    assert.equal(result.count, 1);
    assert.ok(result.el);
  });

  test('fallback to button text content', () => {
    const document = makeDOM('<button class="custom-btn">Search</button>');
    const result = resolveTarget({ text: 'Search', tag: 'button' }, document);
    assert.equal(result.count, 1);
    assert.ok(result.el);
  });

  test('fallback to CSS selector', () => {
    const document = makeDOM('<div class="video-card"><a class="video-title" href="/watch">Title</a></div>');
    const result = resolveTarget({ selector: '.video-card a.video-title' }, document);
    assert.equal(result.count, 1);
    assert.ok(result.el);
  });

  test('disabled element is excluded', () => {
    const document = makeDOM('<button data-testid="save-button" disabled>Save</button>');
    const result = resolveTarget({ testid: 'save-button' }, document);
    assert.equal(result.count, 0);
    assert.equal(result.reason, 'missing');
  });
});

describe('Record-specific target rejection', () => {
  test('rejects target whose testid contains the record id', () => {
    const document = makeDOM('<a data-testid="customer-row-c1" href="#">Alice</a>');
    const el = document.querySelector('[data-testid="customer-row-c1"]');
    const target = buildTarget(el, 'c1', document);
    assert.equal(target.error, 'record-specific');
  });

  test('accepts target whose testid does NOT contain the record id', () => {
    const document = makeDOM('<button data-testid="save-button">Save</button>');
    const el = document.querySelector('[data-testid="save-button"]');
    const target = buildTarget(el, 'c1', document);
    assert.ok(!target.error);
    assert.equal(target.testid, 'save-button');
  });
});

describe('Recorder redaction (sensitive fields)', () => {
  test('password input is sensitive', () => {
    const document = makeDOM('<input type="password" id="user-pass" />');
    const el = document.querySelector('input');
    assert.ok(isSensitiveField(el));
  });

  test('input with "token" in id is sensitive', () => {
    const document = makeDOM('<input type="text" id="auth-token" />');
    const el = document.querySelector('input');
    assert.ok(isSensitiveField(el));
  });

  test('normal text input is NOT sensitive', () => {
    const document = makeDOM('<input type="text" id="notes-input" data-testid="notes-input" />');
    const el = document.querySelector('input');
    assert.ok(!isSensitiveField(el));
  });

  test('input with "card" in name is sensitive', () => {
    const document = makeDOM('<input type="text" name="card-number" />');
    const el = document.querySelector('input');
    assert.ok(isSensitiveField(el));
  });
});

describe('Native-setter value application', () => {
  test('applies value to input and fires change event', () => {
    const document = makeDOM('<input type="text" data-testid="notes-input" value="" />');
    const el = document.querySelector('input');
    let changed = false;
    el.addEventListener('change', () => { changed = true; });
    applyReactValue(el, 'Hello world');
    assert.equal(el.value, 'Hello world');
    assert.ok(changed);
  });

  test('applies value to select', () => {
    const document = makeDOM(`
      <select data-testid="status-select">
        <option value="New">New</option>
        <option value="Follow-up">Follow-up</option>
      </select>
    `);
    const el = document.querySelector('select');
    applyReactValue(el, 'Follow-up');
    assert.equal(el.value, 'Follow-up');
  });
});

describe('Verifier logic', () => {
  function makeVerifierLogic(customersJson, currentId, expectedStatus, expectedNotes) {
    // Inline the core verifier logic for unit testing
    let customers;
    try { customers = JSON.parse(customersJson); }
    catch { return { overall: 'unverified', reason: 'parse error', fields: [] }; }

    const current = customers.find(c => c.id === currentId);
    if (!current) return { overall: 'unverified', reason: 'not found', fields: [] };

    const fields = [];
    if (expectedStatus !== undefined) {
      fields.push({ field: 'status', expected: expectedStatus, observed: current.status, status: current.status === expectedStatus ? 'success' : 'failed' });
    }
    if (expectedNotes !== undefined) {
      fields.push({ field: 'notes', expected: expectedNotes, observed: current.notes, status: current.notes === expectedNotes ? 'success' : 'failed' });
    }
    const overall = fields.every(f => f.status === 'success') ? 'success' : 'failed';
    return { overall, fields };
  }

  test('verifier passes when status and notes match', () => {
    const data = JSON.stringify([{ id: 'c2', status: 'Follow-up', notes: 'Call next week' }]);
    const result = makeVerifierLogic(data, 'c2', 'Follow-up', 'Call next week');
    assert.equal(result.overall, 'success');
    assert.ok(result.fields.every(f => f.status === 'success'));
  });

  test('verifier fails when status does not match', () => {
    const data = JSON.stringify([{ id: 'c2', status: 'New', notes: 'Call next week' }]);
    const result = makeVerifierLogic(data, 'c2', 'Follow-up', 'Call next week');
    assert.equal(result.overall, 'failed');
    const statusField = result.fields.find(f => f.field === 'status');
    assert.equal(statusField.status, 'failed');
  });

  test('verifier returns unverified when customer not found', () => {
    const data = JSON.stringify([{ id: 'c1', status: 'New', notes: '' }]);
    const result = makeVerifierLogic(data, 'c99', 'Follow-up', 'test');
    assert.equal(result.overall, 'unverified');
  });

  test('generic verifier verifies arbitrary site input value correctly', () => {
    function makeGenericVerifier(steps, domValues) {
      const fields = [];
      for (const step of steps) {
        if (step.action === 'type') {
          const obs = domValues[step.id];
          const pass = obs === step.value;
          fields.push({ field: step.label, expected: step.value, observed: obs, status: pass ? 'success' : 'failed' });
        } else if (step.action === 'press_enter' || step.action === 'click') {
          fields.push({ field: step.label, expected: 'executed', observed: 'completed', status: 'success' });
        }
      }
      const overall = fields.length > 0 && fields.every(f => f.status === 'success') ? 'success' : 'failed';
      return { overall, fields };
    }

    const steps = [
      { id: 's1', action: 'type', value: 'lofi hip hop', label: 'Type into search' },
      { id: 's2', action: 'press_enter', value: 'Enter', label: 'Press Enter' }
    ];
    const result = makeGenericVerifier(steps, { s1: 'lofi hip hop' });
    assert.equal(result.overall, 'success');
    assert.equal(result.fields.length, 2);
  });
});

describe('Cross-Navigation & Deduplication Resilience', () => {
  test('role tolerance: accepts compatible textbox/combobox on input', () => {
    const doc = makeDOM('<input id="search" name="q" role="combobox" />');
    // Recorded with role: 'textbox'
    const target = { id: 'search', tag: 'input', role: 'textbox' };
    const res = resolveTarget(target, doc);
    assert.ok(res.el, 'should find input despite combobox vs textbox difference');
    assert.equal(res.count, 1);
  });

  test('role tolerance: rejects incompatible role change', () => {
    const doc = makeDOM('<button id="search" role="button">Search</button>');
    const target = { id: 'search', tag: 'button', role: 'textbox' };
    const res = resolveTarget(target, doc);
    assert.equal(res.el, null);
    assert.ok(res.reason.includes('role drifted'));
  });

  test('Enter throttling: prevents duplicate press_enter within 500ms', () => {
    let lastEnterTime = 0;
    let lastEnterTarget = null;
    const recorded = [];

    function simulateEnter(el, time) {
      if (time - lastEnterTime < 500 && lastEnterTarget === el) {
        return false; // suppressed
      }
      lastEnterTime = time;
      lastEnterTarget = el;
      recorded.push({ action: 'press_enter', time });
      return true;
    }

    const input = { id: 'q' };
    assert.equal(simulateEnter(input, 1000), true);
    assert.equal(simulateEnter(input, 1200), false, 'should suppress duplicate Enter at 200ms');
    assert.equal(simulateEnter(input, 1400), false, 'should suppress duplicate Enter at 400ms');
    assert.equal(simulateEnter(input, 1600), true, 'should allow Enter after 600ms');
    assert.equal(recorded.length, 2);
  });

  test('step deduplication: pendingSteps only stores unique step IDs', () => {
    const pendingSteps = [];
    function onStepRecorded(step) {
      if (pendingSteps.some(s => s.id === step.id)) return;
      pendingSteps.push(step);
    }

    const step1 = { id: 'step_1', action: 'type', value: 'hello ai' };
    const step2 = { id: 'step_2', action: 'press_enter', value: 'Enter' };

    // Simulate duplicate delivery from content script + background relay
    onStepRecorded(step1);
    onStepRecorded(step2);
    onStepRecorded(step1); // duplicate
    onStepRecorded(step2); // duplicate

    assert.equal(pendingSteps.length, 2);
    assert.deepEqual(pendingSteps.map(s => s.id), ['step_1', 'step_2']);
  });
});
