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
  if (el.closest('[style*="display: none"], [style*="visibility: hidden"], [hidden]')) {
    return false;
  }
  return true;
}

function normalizeText(str) {
  return (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function areTagsCompatible(tagA, tagB) {
  if (!tagA || !tagB) return true;
  tagA = tagA.toLowerCase();
  tagB = tagB.toLowerCase();
  if (tagA === tagB) return true;
  const clickables = new Set(['a', 'button', 'span', 'div', 'label', 'i', 'p', 'li', 'summary']);
  if (clickables.has(tagA) && clickables.has(tagB)) return true;
  const textInputs = new Set(['input', 'textarea']);
  if (textInputs.has(tagA) && textInputs.has(tagB)) return true;
  return false;
}

function isRoleCompatible(actualRole, targetRole) {
  if (!actualRole || !targetRole) return true;
  if (actualRole === targetRole) return true;
  const isTextInput = (r) => ['textbox', 'combobox', 'searchbox'].includes(r);
  const isClickable = (r) => ['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio'].includes(r);
  if (isTextInput(actualRole) && isTextInput(targetRole)) return true;
  if (isClickable(actualRole) && isClickable(targetRole)) return true;
  return false;
}

function resolveTarget(target, document) {
  const strategies = [
    // 1. data-testid
    () => {
      if (!target.testid) return [];
      return Array.from(document.querySelectorAll(`[data-testid="${target.testid}"], [data-test="${target.testid}"], [data-cy="${target.testid}"]`));
    },
    // 2. id
    () => {
      if (!target.id) return [];
      const el = document.getElementById(target.id);
      return el ? [el] : Array.from(document.querySelectorAll(`#${target.id}`));
    },
    // 3. name
    () => {
      if (!target.name) return [];
      return Array.from(document.querySelectorAll(`${target.tag || '*'}[name="${target.name}"]`));
    },
    // 4. ariaLabel
    () => {
      if (!target.ariaLabel) return [];
      return Array.from(document.querySelectorAll(`[aria-label="${target.ariaLabel}"]`));
    },
    // 5. placeholder
    () => {
      if (!target.placeholder) return [];
      return Array.from(document.querySelectorAll(`[placeholder="${target.placeholder}"]`));
    },
    // 6. title
    () => {
      if (!target.title) return [];
      return Array.from(document.querySelectorAll(`[title="${target.title}"]`));
    },
    // 7. labelText
    () => {
      if (!target.labelText) return [];
      const normTarget = normalizeText(target.labelText);
      const res = [];
      Array.from(document.querySelectorAll('label')).forEach(lbl => {
        if (normalizeText(lbl.textContent) === normTarget || normalizeText(lbl.textContent).includes(normTarget)) {
          const ctrl = lbl.control || (lbl.htmlFor && document.getElementById(lbl.htmlFor)) || lbl.querySelector('input, select, textarea');
          if (ctrl) res.push(ctrl);
        }
      });
      return res;
    },
    // 8. Visible text content
    () => {
      if (!target.text) return [];
      const targetNorm = normalizeText(target.text);
      if (!targetNorm) return [];
      const tagSel = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], label, h1, h2, h3, h4, span, div, p, li, summary';
      const allTextEls = Array.from(document.querySelectorAll(tagSel)).filter(el => {
        const textContent = el.textContent || '';
        const norm = normalizeText(textContent);
        if (!norm) return false;
        if (norm === targetNorm) return true;
        if (norm.length < 140 && norm.includes(targetNorm)) return true;
        return false;
      });
      return allTextEls.sort((a, b) => {
        if (target.tag) {
          const aTagMatch = a.tagName.toLowerCase() === target.tag.toLowerCase() ? 1 : 0;
          const bTagMatch = b.tagName.toLowerCase() === target.tag.toLowerCase() ? 1 : 0;
          if (aTagMatch !== bTagMatch) return bTagMatch - aTagMatch;
        }
        const aInteractive = ['button', 'a', 'input', 'label'].includes(a.tagName.toLowerCase()) || a.hasAttribute('role');
        const bInteractive = ['button', 'a', 'input', 'label'].includes(b.tagName.toLowerCase()) || b.hasAttribute('role');
        if (aInteractive !== bInteractive) return bInteractive ? 1 : -1;

        const aExact = normalizeText(a.textContent) === targetNorm ? 1 : 0;
        const bExact = normalizeText(b.textContent) === targetNorm ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        return a.textContent.length - b.textContent.length;
      });
    },
    // 9. href
    () => {
      if (!target.href) return [];
      let els = Array.from(document.querySelectorAll(`a[href="${target.href}"]`));
      if (els.length === 0 && target.href.length > 5) {
        els = Array.from(document.querySelectorAll(`a[href*="${target.href}"]`));
      }
      return els;
    },
    // 10. selector
    () => {
      if (!target.selector) return [];
      try {
        return Array.from(document.querySelectorAll(target.selector));
      } catch (_) {
        return [];
      }
    }
  ];

  let visible = [];
  for (const strategy of strategies) {
    let candidates = [];
    try {
      candidates = strategy();
    } catch (_) {
      continue;
    }
    if (candidates.length > 0) {
      const vis = candidates.filter(isVisibleAndEnabled);
      if (vis.length > 0) {
        visible = vis;
        break;
      }
    }
  }

  if (visible.length === 0) return { el: null, count: 0, reason: 'missing' };

  if (visible.length > 1) {
    // 1. If target.tag is specified, narrow down to elements matching tag
    let filtered = visible;
    if (target.tag) {
      const tagMatches = filtered.filter(el => el.tagName.toLowerCase() === target.tag.toLowerCase());
      if (tagMatches.length > 0) filtered = tagMatches;
    }

    // 2. Exact matches
    const exact = filtered.filter(el => {
      if (target.id && el.id === target.id) return true;
      if (target.href && (el.getAttribute('href') === target.href || el.getAttribute('href')?.endsWith(target.href))) return true;
      if (target.text && normalizeText(el.textContent) === normalizeText(target.text)) return true;
      return false;
    });

    const pool = exact.length > 0 ? exact : filtered;

    // 3. If candidates are in an ancestor-descendant hierarchy (e.g. <div><a id="filter"><span>Text</span></a></div>),
    // pick the most specific interactive control or innermost matching element
    if (pool.length > 1) {
      const interactive = pool.filter(el =>
        ['button', 'a', 'input', 'label'].includes(el.tagName.toLowerCase()) || el.hasAttribute('role')
      );
      if (interactive.length === 1) return { el: interactive[0], count: 1 };
      if (interactive.length > 1) {
        const nonParents = interactive.filter(a => !interactive.some(b => b !== a && a.contains(b)));
        if (nonParents.length === 1) return { el: nonParents[0], count: 1 };
      }
      const nonParents = pool.filter(a => !pool.some(b => b !== a && a.contains(b)));
      if (nonParents.length === 1) return { el: nonParents[0], count: 1 };
    } else if (pool.length === 1) {
      return { el: pool[0], count: 1 };
    }

    return { el: null, count: visible.length, reason: `ambiguous (${visible.length} matches)` };
  }

  const el = visible[0];
  if (target.tag && !areTagsCompatible(target.tag, el.tagName)) {
    return { el: null, count: 1, reason: 'target changed (tag drifted)' };
  }
  if (target.role) {
    const actualRole = el.getAttribute('role') || (el.tagName.toLowerCase() === 'input' ? 'textbox' : '');
    if (!isRoleCompatible(actualRole, target.role)) {
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
  let text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  let labelText = '';

  const parentLabel = el.closest('label');
  if (parentLabel) labelText = (parentLabel.textContent || '').replace(/\s+/g, ' ').trim();

  // Container text fallback
  if (!text && !labelText) {
    const container = el.closest('li, label, .s-navigation-item, [role="listitem"], tr');
    if (container) {
      const cText = (container.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (cText) {
        if (tag === 'input') labelText = cText;
        else text = cText;
      }
    }
  }

  if (recordId) {
    const suspicious = [testid, id, ariaLabel, labelText].some(s => s && s.includes(recordId));
    if (suspicious) return { error: 'record-specific', testid, id };
  }
  return { testid, id, ariaLabel, tag, text, labelText };
}

function findClickableElement(target) {
  if (!target || target === target.ownerDocument.body || target === target.ownerDocument.documentElement) return null;

  // 1. Label wrapping a form control (e.g. checkbox icon inside label)
  const label = target.closest('label');
  if (label) {
    const ctrl = label.control || label.querySelector('input, select, textarea') || (label.htmlFor && target.ownerDocument.getElementById(label.htmlFor));
    if (ctrl) return ctrl;
  }

  // 2. Direct interactive controls or links
  const direct = target.closest(
    'button, [role="button"], a[href], [role="link"], input, select, textarea, [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], summary'
  );
  if (direct) return direct;

  // 3. Label without input: parent link or text label
  if (label) {
    const parentActionable = label.closest('a[href], button, [role="button"]');
    if (parentActionable) return parentActionable;
    if (label.textContent?.trim()) return label;
  }

  // 4. Custom clickable walk
  let cur = target;
  for (let i = 0; i < 4 && cur && cur !== target.ownerDocument.body; i++) {
    if (cur.getAttribute('onclick') || (cur.hasAttribute('tabindex') && cur.getAttribute('tabindex') !== '-1')) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
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

describe('Universal Web Interactions (Links, Checkboxes, Radios, Title, Href, Auto-scroll)', () => {
  test('resolves links by href attribute (YouTube / Google Search results)', () => {
    const doc = makeDOM(`
      <div class="results">
        <a class="yt-simple-endpoint" href="/watch?v=dQw4w9WgXcQ">
          <span id="video-title">Never Gonna Give You Up</span>
        </a>
      </div>
    `);
    const target = { tag: 'a', href: '/watch?v=dQw4w9WgXcQ' };
    const res = resolveTarget(target, doc);
    assert.ok(res.el, 'should locate link by href');
    assert.equal(res.el.getAttribute('href'), '/watch?v=dQw4w9WgXcQ');
  });

  test('resolves element by title attribute', () => {
    const doc = makeDOM('<button title="Settings" aria-hidden="true"><svg></svg></button>');
    const target = { title: 'Settings' };
    const res = resolveTarget(target, doc);
    assert.ok(res.el);
    assert.equal(res.el.getAttribute('title'), 'Settings');
  });

  test('checkbox check/uncheck sets state and triggers events', () => {
    const doc = makeDOM('<input type="checkbox" id="agree" />');
    const el = doc.getElementById('agree');
    let changeFired = false;
    el.addEventListener('change', () => { changeFired = true; });

    // Simulate replayer check action
    el.checked = true;
    el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));

    assert.equal(el.checked, true);
    assert.equal(changeFired, true);
  });

  test('radio button select_radio selects radio and triggers change', () => {
    const doc = makeDOM(`
      <input type="radio" name="shipping" value="standard" checked />
      <input type="radio" name="shipping" value="express" id="express" />
    `);
    const el = doc.getElementById('express');
    let changeFired = false;
    el.addEventListener('change', () => { changeFired = true; });

    el.checked = true;
    el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));

    assert.equal(el.checked, true);
    assert.equal(changeFired, true);
  });

  test('clickable detector walks up to find interactive container', () => {
    const doc = makeDOM(`
      <div id="video-card" role="button" tabindex="0">
        <div class="thumb-container">
          <img src="thumb.jpg" id="inner-img" />
        </div>
      </div>
    `);

    function findClickable(target) {
      return target.closest('button, [role="button"], a[href], [role="link"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="tab"], summary');
    }

    const innerImg = doc.getElementById('inner-img');
    const clickable = findClickable(innerImg);
    assert.ok(clickable);
    assert.equal(clickable.id, 'video-card');
  });
});

describe('Dynamic E-Commerce & Complex Web Filtering (Visible-first fallback, Amazon badges, container context, preflight)', () => {
  test('visible-first strategy: hidden href in drawer does not block visible text in sidebar', () => {
    const doc = makeDOM(`
      <!-- Hidden mobile drawer -->
      <div id="mobile-drawer" style="display: none">
        <a href="/s?k=Power+Bank&amp;filter=tomorrow" id="hidden-drawer-link">Old Filter Link</a>
      </div>
      <!-- Visible sidebar filter -->
      <div id="sidebar-filters">
        <a href="/s?k=Power+Bank&amp;new_token=123" id="visible-filter-link">
          <span class="a-size-base">Get It by Tomorrow</span>
        </a>
      </div>
    `);

    // Target recorded with old href AND visible text
    const target = {
      tag: 'a',
      href: '/s?k=Power+Bank&filter=tomorrow',
      text: 'Get It by Tomorrow'
    };

    const res = resolveTarget(target, doc);
    assert.ok(res.el, 'should locate visible filter link');
    assert.equal(res.el.id, 'visible-filter-link');
    assert.equal(res.count, 1);
  });

  test('text normalization matches Amazon filter labels with newlines and count badges', () => {
    const doc = makeDOM(`
      <div class="s-refinement">
        <a id="prime-filter" class="s-navigation-item" href="/s?k=Power+Bank&amp;filter=tomorrow">
          <span>
            Get It by Tomorrow
          </span>
          <span class="s-count">(2,540)</span>
        </a>
      </div>
    `);

    const target = { tag: 'a', text: 'Get It by Tomorrow' };
    const res = resolveTarget(target, doc);
    assert.ok(res.el);
    assert.equal(res.el.id, 'prime-filter');
    assert.equal(res.count, 1);
  });

  test('findClickableElement resolves checkbox inside empty label to input element', () => {
    const doc = makeDOM(`
      <a class="s-navigation-item" href="/filter-discount">
        <div class="a-checkbox">
          <label>
            <input type="checkbox" id="discount-70-input" />
            <i class="a-icon a-icon-checkbox" id="check-icon"></i>
          </label>
        </div>
        <span class="a-size-base">70% Off or more</span>
      </a>
    `);

    const icon = doc.getElementById('check-icon');
    const clickable = findClickableElement(icon);
    assert.ok(clickable);
    assert.equal(clickable.id, 'discount-70-input', 'should resolve to the checkbox input, not empty label');
    assert.equal(clickable.tagName.toLowerCase(), 'input');
  });

  test('buildTarget extracts labelText from enclosing container when input has no direct label text', () => {
    const doc = makeDOM(`
      <li class="s-navigation-item">
        <input type="checkbox" id="discount-input" />
        <span class="a-size-base">70% Off or more</span>
      </li>
    `);

    const input = doc.getElementById('discount-input');
    const target = buildTarget(input, null, doc);
    assert.equal(target.labelText, '70% Off or more', 'should extract text from enclosing container');
  });

  test('tag cross-compatibility allows clickable span to resolve to button without tag drift error', () => {
    const doc = makeDOM('<button id="apply-btn">Apply Filters</button>');
    // Target was recorded when user clicked an inner span: { tag: 'span', text: 'Apply Filters' }
    const target = { tag: 'span', text: 'Apply Filters' };
    const res = resolveTarget(target, doc);
    assert.ok(res.el);
    assert.equal(res.el.id, 'apply-btn');
    assert.equal(res.count, 1);
  });

  test('tag incompatibility rejects input target matching non-input elements', () => {
    const doc = makeDOM('<div id="price-box">20</div>');
    const target = { tag: 'input', text: '20' };
    const res = resolveTarget(target, doc);
    assert.equal(res.el, null);
    assert.match(res.reason, /tag drifted/);
  });

  test('preflight scope: generic sites check immediate next step, CRM checks all steps', () => {
    function getStepsToPreflight(isCrm, nonCompletedSteps) {
      return isCrm ? nonCompletedSteps : nonCompletedSteps.slice(0, 1);
    }

    const elevenSteps = Array.from({ length: 11 }, (_, i) => ({ id: `step_${i}` }));

    const genericSteps = getStepsToPreflight(false, elevenSteps);
    assert.equal(genericSteps.length, 1, 'generic web should only preflight immediate next step');
    assert.equal(genericSteps[0].id, 'step_0');

    const crmSteps = getStepsToPreflight(true, elevenSteps);
    assert.equal(crmSteps.length, 11, 'CRM should preflight all 11 steps for form verification');
  });

  test('isNewTabPage correctly identifies Chrome new tab URLs and maps to google.com', () => {
    function isNewTabPage(url) {
      if (!url) return true;
      return url.startsWith('chrome://newtab') ||
             url.startsWith('chrome-search://') ||
             url === 'about:blank' ||
             url === 'about:newtab' ||
             url.startsWith('edge://newtab') ||
             url === 'chrome://';
    }

    assert.equal(isNewTabPage('chrome://newtab/'), true);
    assert.equal(isNewTabPage('chrome-search://local-ntp/local-ntp.html'), true);
    assert.equal(isNewTabPage('about:blank'), true);
    assert.equal(isNewTabPage('about:newtab'), true);
    assert.equal(isNewTabPage('edge://newtab'), true);
    assert.equal(isNewTabPage('https://www.google.com'), false);
    assert.equal(isNewTabPage('https://www.amazon.in'), false);
    assert.equal(isNewTabPage('chrome://settings'), false);
  });
});
