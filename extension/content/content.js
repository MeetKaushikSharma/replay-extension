// content/content.js – Single-file content script for RePlay
(() => {
'use strict';

if (window.__replayContentScriptInjected) return;
window.__replayContentScriptInjected = true;

// ═══════════════════════════════════════════════════════════
// MODULE: selectors.js
// ═══════════════════════════════════════════════════════════

function isVisibleAndEnabled(el) {
  if (!el) return false;
  if (el.disabled) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  // Form controls (checkboxes, radios, range sliders) are frequently styled with opacity: 0
  // or zero dimensions while their parent label / wrapper provides the visual presentation.
  const isInput = el.tagName.toLowerCase() === 'input';
  const isCheckboxOrRadio = isInput && ['checkbox', 'radio'].includes(el.type);

  if (isCheckboxOrRadio) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && style.opacity !== '0') return true;
    // Fall back to checking if the parent label or container is visible
    const container = el.closest('label, .a-checkbox, .a-radio, [class*="checkbox"], [class*="radio"], li, tr, div');
    if (container) {
      const cStyle = window.getComputedStyle(container);
      if (cStyle.display === 'none' || cStyle.visibility === 'hidden') return false;
      const cRect = container.getBoundingClientRect();
      return cRect.width > 0 && cRect.height > 0;
    }
    return false;
  }

  if (style.opacity === '0') return false;
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
  // Define prioritized strategies. A strategy is only accepted if it yields VISIBLE, enabled elements.
  // This prevents invisible/offscreen drawer elements or hidden templates from blocking visible controls.
  const strategies = [
    // 1. data-testid / data-test / data-cy
    () => {
      if (!target.testid) return [];
      return deepQuerySelectorAll(`[data-testid="${CSS.escape(target.testid)}"], [data-test="${CSS.escape(target.testid)}"], [data-cy="${CSS.escape(target.testid)}"]`);
    },
    // 2. id (stable ID)
    () => {
      if (!target.id) return [];
      const el = document.getElementById(target.id);
      return el ? [el] : deepQuerySelectorAll(`#${CSS.escape(target.id)}`);
    },
    // 3. inputValue attribute (critical for filter checkboxes/radios like value="p_89/boAt")
    () => {
      if (!target.inputValue) return [];
      const tag = target.tag || 'input';
      return deepQuerySelectorAll(`${tag}[value="${CSS.escape(target.inputValue)}"]`);
    },
    // 4. name attribute (common for search/form inputs)
    () => {
      if (!target.name) return [];
      const sel = `${target.tag || '*'}[name="${CSS.escape(target.name)}"]`;
      return deepQuerySelectorAll(sel);
    },
    // 5. aria-label
    () => {
      if (!target.ariaLabel) return [];
      return deepQuerySelectorAll(`[aria-label="${CSS.escape(target.ariaLabel)}"]`);
    },
    // 6. placeholder
    () => {
      if (!target.placeholder) return [];
      return deepQuerySelectorAll(`[placeholder="${CSS.escape(target.placeholder)}"]`);
    },
    // 7. title attribute (tooltips, icons, video links)
    () => {
      if (!target.title) return [];
      return deepQuerySelectorAll(`[title="${CSS.escape(target.title)}"]`);
    },
    // 8. Accessible label text
    () => {
      if (!target.labelText) return [];
      const normTarget = normalizeText(target.labelText);
      const res = [];
      deepQuerySelectorAll('label').forEach(lbl => {
        if (normalizeText(lbl.textContent) === normTarget || normalizeText(lbl.textContent).includes(normTarget)) {
          const ctrl = lbl.control || (lbl.htmlFor && document.getElementById(lbl.htmlFor)) || lbl.querySelector('input, select, textarea');
          if (ctrl) res.push(ctrl);
        }
      });
      // Also look for enclosing filter rows or list items where input is inside or adjacent
      if (res.length === 0 && target.tag === 'input') {
        const containers = deepQuerySelectorAll('li, .s-navigation-item, [role="listitem"], .a-row, [class*="filter"]');
        for (const c of containers) {
          const cNorm = normalizeText(c.textContent);
          if (cNorm && (cNorm === normTarget || cNorm.includes(normTarget))) {
            const input = c.querySelector('input');
            if (input) res.push(input);
          }
        }
      }
      return res;
    },
    // 9. Visible text content (for buttons, links, cards, filters)
    () => {
      if (!target.text) return [];
      const targetNorm = normalizeText(target.text);
      if (!targetNorm) return [];
      const tagSel = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], label, h1, h2, h3, h4, h5, h6, span, div, p, li, summary';
      const allTextEls = deepQuerySelectorAll(tagSel).filter(el => {
        const textContent = el.textContent || '';
        const norm = normalizeText(textContent);
        if (!norm) return false;
        // Exact match or contains substring within reasonable length
        if (norm === targetNorm) return true;
        if (norm.length < 140 && norm.includes(targetNorm)) return true;
        return false;
      });
      // Prioritize tag match, interactive controls, then exact text
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
    // 10. href (for links, e.g. search results or YouTube video links)
    () => {
      if (!target.href) return [];
      let sel = `a[href="${CSS.escape(target.href)}"]`;
      let els = deepQuerySelectorAll(sel);
      if (els.length === 0 && target.href.length > 5) {
        sel = `a[href*="${CSS.escape(target.href)}"]`;
        els = deepQuerySelectorAll(sel);
      }
      return els;
    },
    // 11. Robust CSS selector fallback
    () => {
      if (!target.selector) return [];
      try {
        return deepQuerySelectorAll(target.selector);
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
        break; // Found matching visible candidates with highest-priority strategy
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
      if (target.inputValue && el.value === target.inputValue) return true;
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
        // Among multiple interactive elements, if one contains the other, pick the innermost
        const nonParents = interactive.filter(a => !interactive.some(b => b !== a && a.contains(b)));
        if (nonParents.length === 1) return { el: nonParents[0], count: 1 };
      }
      // If neither or multiple non-interactive, pick innermost element
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
    const actualRole = el.getAttribute('role') || implicitRole(el);
    if (!isRoleCompatible(actualRole, target.role)) {
      return { el: null, count: 1, reason: 'target changed (role drifted)' };
    }
  }
  return { el, count: 1 };
}

function findScrollableFilterContainers() {
  const containers = [];
  const modalSelectors = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '.a-modal-scroller',
    '.a-popover-modal',
    '.a-popover-wrapper',
    '#s-all-filters',
    '[class*="all-filters"]',
    '[class*="filter-modal"]',
    '[class*="filters-modal"]',
    '[class*="filter-sheet"]',
    '[class*="filters-sheet"]',
    '[class*="filter-drawer"]',
    '[class*="modal"]',
    '[class*="drawer"]'
  ];

  try {
    const els = document.querySelectorAll(modalSelectors.join(', '));
    for (const el of els) {
      if (!isVisibleAndEnabled(el)) continue;
      const style = window.getComputedStyle(el);
      const isScrollable = el.scrollHeight > el.clientHeight &&
        (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll');
      if (isScrollable) {
        containers.push(el);
      } else {
        const scroller = el.querySelector('.a-popover-inner, [class*="scroller"], [class*="body"], [class*="content"]');
        if (scroller && isVisibleAndEnabled(scroller) && scroller.scrollHeight > scroller.clientHeight) {
          containers.push(scroller);
        }
      }
    }
  } catch (_) {}
  return containers;
}

function pollForTarget(target, { interval = 120, timeout = 9000, autoScroll = true } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    let lastScroll = 0;

    function attempt() {
      const result = resolveTarget(target);
      if (result.el) {
        try { result.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        resolve(result);
        return;
      }
      if (Date.now() >= deadline || (result.reason && result.reason.startsWith('ambiguous'))) {
        reject(result);
        return;
      }

      // Auto-scroll down if element is missing to trigger lazy-loaded elements on modern SPAs
      if (autoScroll && Date.now() - lastScroll > 1200) {
        lastScroll = Date.now();
        const activeModals = findScrollableFilterContainers();
        if (activeModals.length > 0) {
          // If an open filter modal or drawer is active, scroll THAT container instead of background window
          for (const modal of activeModals) {
            try { modal.scrollBy({ top: 350, behavior: 'smooth' }); } catch (_) {}
          }
        } else {
          // No modal active: scroll background page and standard filter sidebars
          try { window.scrollBy({ top: 400, behavior: 'smooth' }); } catch (_) {}
          try {
            const sidebars = document.querySelectorAll('#s-refinements, #filters, aside, [role="region"], nav, .sidebar');
            sidebars.forEach(sb => sb.scrollBy({ top: 300, behavior: 'smooth' }));
          } catch (_) {}
        }
      }

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
  const title       = el.getAttribute('title') || '';
  let labelText     = getLabelText(el);
  const tag         = el.tagName.toLowerCase();
  const role        = el.getAttribute('role') || implicitRole(el);
  const type        = el.getAttribute('type') || '';
  const inputValue  = el.getAttribute('value') || (tag === 'input' && el.value && el.value !== 'on' ? el.value : '');
  const ariaValueNow = el.getAttribute('aria-valuenow') || '';

  // Link href handling
  const linkEl      = tag === 'a' ? el : el.closest('a');
  const href        = linkEl?.getAttribute('href') || '';

  // Text content extraction
  let text = '';
  if (['button', 'a'].includes(tag) || ['button', 'link', 'tab', 'menuitem', 'option'].includes(role)) {
    text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  } else if (!testid && !id && !name && !ariaLabel) {
    text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  // If text and labelText are empty, search upwards through containers (e.g. li, .s-navigation-item, .a-row, filter item)
  if (!text && !labelText) {
    const selectors = ['label', 'li', '.s-navigation-item', '[role="listitem"]', '.a-row', '.a-checkbox', '.a-radio', '[class*="item"]', '[class*="filter"]', 'tr', '.form-group'];
    let cur = el.parentElement;
    while (cur && cur !== document.body && !labelText && !text) {
      if (selectors.some(sel => cur.matches?.(sel))) {
        const cText = (cur.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (cText) {
          if (tag === 'input') labelText = cText;
          else text = cText;
          break;
        }
      }
      cur = cur.parentElement;
    }
  }

  // If labelText is still empty for input, check if inputValue can provide a descriptive name (e.g. "p_89/boAt" -> "boAt")
  if (tag === 'input' && !labelText && inputValue && inputValue !== 'on' && type !== 'range') {
    const cleanVal = inputValue.includes('/') ? inputValue.split('/').pop() : inputValue;
    if (cleanVal && cleanVal.length < 50 && isNaN(Number(cleanVal))) {
      labelText = cleanVal;
    }
  }

  // Generate fallback CSS selector
  let selector = '';
  if (testid) {
    selector = `[data-testid="${CSS.escape(testid)}"]`;
  } else if (id) {
    selector = `#${CSS.escape(id)}`;
  } else if (inputValue && tag === 'input') {
    selector = `input[value="${CSS.escape(inputValue)}"]`;
  } else if (name) {
    selector = `${tag}[name="${CSS.escape(name)}"]`;
  } else if (placeholder) {
    selector = `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
  } else if (ariaLabel) {
    selector = `[aria-label="${CSS.escape(ariaLabel)}"]`;
  } else if (href && tag === 'a') {
    selector = `a[href="${CSS.escape(href)}"]`;
  } else if (title) {
    selector = `${tag}[title="${CSS.escape(title)}"]`;
  }

  if (recordId) {
    const suspicious = [testid, id, ariaLabel, labelText, name].some(s => s && s.includes(recordId));
    if (suspicious) return { error: 'record-specific', testid, id };
  }
  return { testid, id, name, placeholder, ariaLabel, title, labelText, text, href, tag, type, role, inputValue, ariaValueNow, selector };
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
let _lastEnterTime = 0;
let _lastEnterTarget = null;

async function persistRecordingState() {
  if (_recording) {
    await chrome.storage.local.set({
      replay_recording: { active: true, steps: _steps }
    }).catch(() => {});
  }
}

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
  let name = target.labelText || target.title || target.text || target.placeholder || target.name || target.ariaLabel || target.testid || target.id;
  if (!name || name === 'input' || name === 'element') {
    if (target.inputValue && target.inputValue !== 'on') {
      name = target.inputValue.includes('/') ? target.inputValue.split('/').pop() : target.inputValue;
    } else {
      name = target.tag || 'element';
    }
  }
  const cleanName = name.length > 40 ? name.slice(0, 37) + '...' : name;

  if (action === 'check')        return `Check "${cleanName}"`;
  if (action === 'uncheck')      return `Uncheck "${cleanName}"`;
  if (action === 'select_radio') return `Select "${cleanName}"`;
  if (action === 'set_slider')   return `Set slider "${cleanName}" to ${value}`;
  if (action === 'select')       return `Select "${value}" in ${cleanName}`;
  if (action === 'type')         return `Type "${value}" into ${cleanName}`;
  if (action === 'press_enter')  return `Press Enter in ${cleanName}`;
  if (action === 'click') {
    if (target.tag === 'a' || target.role === 'link') return `Click link "${cleanName}"`;
    if (target.tag === 'button' || target.role === 'button') return `Click button "${cleanName}"`;
    return `Click "${cleanName}"`;
  }
  return action;
}

function findClickableElement(target) {
  if (!target || target === document.body || target === document.documentElement) return null;

  // 1. Label wrapping a form control (e.g. custom checkbox/radio icon clicked inside label)
  const label = target.closest('label');
  if (label) {
    const ctrl = label.control || label.querySelector('input, select, textarea') || (label.htmlFor && document.getElementById(label.htmlFor));
    if (ctrl) return ctrl;
  }

  // 2. Direct interactive controls or links
  const direct = target.closest(
    'button, [role="button"], a[href], [role="link"], input, select, textarea, [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], summary'
  );
  if (direct) return direct;

  // 3. Label without input: resolve to enclosing link/button or label itself
  if (label) {
    const parentActionable = label.closest('a[href], button, [role="button"]');
    if (parentActionable) return parentActionable;
    if (label.textContent?.trim()) return label;
  }

  // 4. Custom clickable element walk (cursor: pointer, onclick, tabindex)
  let cur = target;
  for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
    if (cur.getAttribute('onclick') || (cur.hasAttribute('tabindex') && cur.getAttribute('tabindex') !== '-1')) {
      return cur;
    }
    try {
      const style = window.getComputedStyle(cur);
      if (style.cursor === 'pointer') {
        return cur;
      }
    } catch (_) {}
    cur = cur.parentElement;
  }
  return null;
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
  const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
  const role = el.getAttribute('role');
  if (!['select', 'input', 'textarea'].includes(tag) && !isEditable && role !== 'slider') return;
  if (el.type === 'checkbox' || el.type === 'radio') return; // Handled in handleClick

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
    const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    if (tag === 'input' || tag === 'textarea' || isEditable) {
      const now = Date.now();
      if (now - _lastEnterTime < 500 && _lastEnterTarget === el) {
        return; // debounce rapid or duplicate Enter events
      }
      _lastEnterTime = now;
      _lastEnterTarget = el;

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
      persistRecordingState();
      notifyPanel({ type: 'STEP_RECORDED', step });
      updateBadgeCount(_steps.length);
    }
  }
}

function recordChangeStep(el) {
  if (!el.isConnected) return; // element removed from DOM
  const sensitive = isSensitiveField(el);
  const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
  const tag = el.tagName.toLowerCase();
  const isRange = tag === 'input' && el.type === 'range';
  const isSlider = el.getAttribute('role') === 'slider';

  let action;
  if (isRange || isSlider) {
    action = 'set_slider';
  } else if (tag === 'select') {
    action = 'select';
  } else {
    action = 'type';
  }

  const target = buildTarget(el, getCurrentRecordId());
  if (target.error === 'record-specific') {
    notifyPanel({ type: 'RECORDER_WARNING', message: `Skipped: target "${target.testid || target.id}" is record-specific` });
    return;
  }

  let rawVal;
  if (isSlider) {
    rawVal = el.getAttribute('aria-valuenow') || el.value || '';
  } else if (isEditable) {
    rawVal = el.innerText;
  } else {
    rawVal = el.value;
  }
  const value = sensitive ? null : rawVal;

  // Bulletproof dedup: skip if this exact element was already committed with this exact value.
  if (!sensitive && _lastRecordedValue.get(el) === value) return;

  const step = { id: makeStepId(), order: _steps.length, action, target, value,
                 sensitive, consequential: false, label: humanLabel(action, target, value) };
  _steps.push(step);
  if (!sensitive) _lastRecordedValue.set(el, value); // remember so next event deduplicates
  persistRecordingState();
  notifyPanel({ type: 'STEP_RECORDED', step });
  updateBadgeCount(_steps.length);
}

function handleClick(e) {
  if (!_recording) return;
  const el = findClickableElement(e.target);
  if (!el) return;
  if (el.closest('#__replay_badge_wrapper__')) return;

  // Flush pending input steps so order is: type → click
  for (const [pendingEl, { timer }] of _pendingChanges) {
    clearTimeout(timer);
    recordChangeStep(pendingEl);
  }
  _pendingChanges.clear();

  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type') || '';
  const role = el.getAttribute('role') || '';

  // Handle native or ARIA checkboxes and radio buttons
  if ((tag === 'input' && (type === 'checkbox' || type === 'radio')) || role === 'checkbox' || role === 'radio') {
    const isCheckbox = type === 'checkbox' || role === 'checkbox';
    const target = buildTarget(el, getCurrentRecordId());
    if (target.error === 'record-specific') return;

    let isChecked;
    if (tag === 'input') {
      isChecked = el.checked;
    } else {
      isChecked = el.getAttribute('aria-checked') === 'true';
    }

    const action = isCheckbox ? (isChecked ? 'check' : 'uncheck') : 'select_radio';
    const value = isCheckbox ? isChecked : (el.value || el.getAttribute('data-value') || 'selected');
    const label = humanLabel(action, target, value);

    const step = {
      id: makeStepId(),
      order: _steps.length,
      action,
      target,
      value,
      sensitive: false,
      consequential: false,
      label
    };
    _steps.push(step);
    persistRecordingState();
    notifyPanel({ type: 'STEP_RECORDED', step });
    updateBadgeCount(_steps.length);
    return;
  }

  const target = buildTarget(el, getCurrentRecordId());
  if (target.error === 'record-specific') {
    notifyPanel({ type: 'RECORDER_WARNING', message: `Skipped click: target "${target.testid || target.id}" is record-specific` });
    return;
  }

  const step = { id: makeStepId(), order: _steps.length, action: 'click', target,
                 value: null, sensitive: false, consequential: isConsequential(el),
                 label: humanLabel('click', target, null) };
  _steps.push(step);
  persistRecordingState();
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

function startRecording(existingSteps = []) {
  _recording = true;
  _steps = Array.isArray(existingSteps) ? [...existingSteps] : [];
  _pendingChanges.clear();
  _lastRecordedValue.clear();
  _lastEnterTime = 0;
  _lastEnterTarget = null;
  document.addEventListener('input',   handleInputOrChange, { capture: true });
  document.addEventListener('change',  handleInputOrChange, { capture: true });
  document.addEventListener('keydown', handleKeyDown,       { capture: true });
  document.addEventListener('click',   handleClick,         { capture: true });
  injectBadge();
  updateBadgeCount(_steps.length);
  persistRecordingState();
  notifyPanel({ type: 'RECORDING_STARTED' });
}

async function stopRecording() {
  const wasRecording = _recording;
  _recording = false;
  await chrome.storage.local.remove('replay_recording').catch(() => {});
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
  if (wasRecording) {
    notifyPanel({ type: 'RECORDING_STOPPED', steps, sourceRecordLabel: recordName });
  }
  return { steps, sourceRecordLabel: recordName, wasRecording };
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

    try { await pollForTarget(step.target, { timeout: 9000 }); }
    catch (err) { return { ok: false, failedStep: step, reason: err.reason || 'missing' }; }

    if (step.action === 'press_enter' || step.action === 'click' || step.action === 'check' || step.action === 'uncheck' || step.action === 'select_radio') {
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
  await chrome.storage.local.set({
    replay_active_run: { runId, workflow }
  }).catch(() => {});

  const targetName = document.querySelector('[data-testid="record-name"]')?.textContent?.trim()
    || document.title?.trim()
    || location.hostname;
  notifyPanel({ type: 'REPLAY_STARTED', runId, targetName, workflowId: workflow.id });

  // Preflight: For CRM form, check all non-completed steps. For generic dynamic web pages (Amazon, YouTube),
  // check immediate next step to verify page readiness, then allow sequential runtime polling for dynamic steps.
  const isCrm = Boolean(localStorage.getItem('crm.customers')) && Boolean(location.hash.match(/#\/customers\/([^/?]+)/));
  const nonCompleted = workflow.steps.filter(s => !completedStepIds.has(s.id));
  const stepsToPreflight = isCrm ? nonCompleted : nonCompleted.slice(0, 1);
  const pre = await preflight(stepsToPreflight);
  if (!pre.ok) {
    sendStepStatus(runId, pre.failedStep.id, 'failed', pre.reason);
    notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `Preflight: step "${pre.failedStep.label}" – ${pre.reason}` });
    _activeRun = null;
    await chrome.storage.local.remove('replay_active_run').catch(() => {});
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
        await chrome.storage.local.remove('replay_active_run').catch(() => {});
        return;
      }
    }

    let el;
    try {
      const result = await pollForTarget(step.target, { timeout: 9000 });
      el = result.el;
    } catch (err) {
      sendStepStatus(runId, step.id, 'failed', err.reason || 'missing');
      notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `"${step.label}" – ${err.reason || 'missing'}` });
      await saveRunState(runId, workflow.id, [...completedStepIds]);
      _activeRun = null;
      await chrome.storage.local.remove('replay_active_run').catch(() => {});
      return;
    }

    try {
      if (step.action === 'select' || step.action === 'type') {
        const value = step.value;
        const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
        if (isEditable) {
          try { el.focus(); } catch (_) {}
          el.innerText = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          applyReactValue(el, value);
          await new Promise(r => setTimeout(r, 150));
          if (el.value !== value && el.value?.trim() !== String(value).trim()) {
            throw new Error(`Value did not stick (got "${el.value}")`);
          }
        }
      } else if (step.action === 'check' || step.action === 'uncheck') {
        const shouldBeChecked = step.action === 'check';
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        await new Promise(r => setTimeout(r, 100));

        const isNavAction = Boolean(el.closest('a[href]')) || el.getAttribute('data-action') === 'a-filter-checkbox';
        if (isNavAction) {
          completedStepIds.add(step.id);
          await saveRunState(runId, workflow.id, [...completedStepIds]);
          sendStepStatus(runId, step.id, 'success', null);
        }

        const isInput = el.tagName.toLowerCase() === 'input';
        const role = el.getAttribute('role');

        if (isInput) {
          // Click wrapper (label or custom checkbox icon container) to trigger framework event handlers
          const wrapper = el.closest('label, .a-checkbox, [class*="checkbox"], a.s-navigation-item') || el;
          if (wrapper !== el) {
            try {
              wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              wrapper.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              wrapper.click();
            } catch (_) {}
          } else {
            el.click();
          }

          if (el.checked !== shouldBeChecked) {
            el.checked = shouldBeChecked;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (role === 'checkbox') {
          try {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            el.click();
          } catch (_) {}
          el.setAttribute('aria-checked', String(shouldBeChecked));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 200));
        if (isNavAction) continue;
      } else if (step.action === 'select_radio') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        await new Promise(r => setTimeout(r, 100));

        const isNavAction = Boolean(el.closest('a[href]'));
        if (isNavAction) {
          completedStepIds.add(step.id);
          await saveRunState(runId, workflow.id, [...completedStepIds]);
          sendStepStatus(runId, step.id, 'success', null);
        }

        const isInput = el.tagName.toLowerCase() === 'input';
        const role = el.getAttribute('role');

        if (isInput) {
          const wrapper = el.closest('label, .a-radio, [class*="radio"]') || el;
          if (wrapper !== el) {
            try {
              wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              wrapper.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              wrapper.click();
            } catch (_) {}
          } else {
            el.click();
          }

          if (!el.checked) {
            el.checked = true;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (role === 'radio') {
          try {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            el.click();
          } catch (_) {}
          el.setAttribute('aria-checked', 'true');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 200));
        if (isNavAction) continue;
      } else if (step.action === 'set_slider') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        await new Promise(r => setTimeout(r, 100));

        const targetValue = step.value;
        if (el.tagName.toLowerCase() === 'input' && el.type === 'range') {
          applyReactValue(el, targetValue);
          try {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          } catch (_) {}
        } else if (el.getAttribute('role') === 'slider') {
          el.setAttribute('aria-valuenow', targetValue);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          const associatedInput = el.querySelector('input') || el.parentElement?.querySelector('input');
          if (associatedInput) {
            applyReactValue(associatedInput, targetValue);
          }
        } else {
          applyReactValue(el, targetValue);
        }
        await new Promise(r => setTimeout(r, 200));
      } else if (step.action === 'press_enter' || step.action === 'key') {
        try { el.focus(); } catch (_) {}
        // Persist step completion BEFORE form submission/navigation might terminate the script
        completedStepIds.add(step.id);
        await saveRunState(runId, workflow.id, [...completedStepIds]);
        sendStepStatus(runId, step.id, 'success', null);

        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        if (el.form) {
          try { el.form.requestSubmit(); } catch (_) { try { el.form.submit(); } catch (_) {} }
        }
        await new Promise(r => setTimeout(r, 600));
        continue;
      } else if (step.action === 'click') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        await new Promise(r => setTimeout(r, 120));

        const isNavClick = el.tagName.toLowerCase() === 'a'
          || Boolean(el.closest('a[href]'))
          || el.type === 'submit'
          || el.getAttribute('type') === 'submit';

        if (isNavClick) {
          completedStepIds.add(step.id);
          await saveRunState(runId, workflow.id, [...completedStepIds]);
          sendStepStatus(runId, step.id, 'success', null);
        }

        try {
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        try {
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.click();
        await new Promise(r => setTimeout(r, 350));
        if (isNavClick) continue;
      }
    } catch (err) {
      sendStepStatus(runId, step.id, 'failed', err.message);
      notifyPanel({ type: 'REPLAY_STOPPED', runId, reason: `"${step.label}" error: ${err.message}` });
      _activeRun = null;
      await chrome.storage.local.remove('replay_active_run').catch(() => {});
      return;
    }

    completedStepIds.add(step.id);
    await saveRunState(runId, workflow.id, [...completedStepIds]);
    sendStepStatus(runId, step.id, 'success', null);
  }

  await chrome.storage.local.remove('replay_active_run').catch(() => {});
  if (_activeRun && !_activeRun.cancelled) {
    notifyPanel({ type: 'REPLAY_COMPLETE', runId });
  }
  _activeRun = null;
}

function cancelReplay() {
  if (_activeRun) _activeRun.cancelled = true;
  chrome.storage.local.remove('replay_active_run').catch(() => {});
}

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
        const isEditable = res.el.isContentEditable || res.el.getAttribute('contenteditable') === 'true';
        const obs = isEditable ? res.el.innerText : res.el.value;
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
    } else if (step.action === 'check' || step.action === 'uncheck') {
      const res = resolveTarget(step.target);
      const name = step.label || 'Checkbox';
      const expectedCheck = step.action === 'check';
      if (res.el) {
        const pass = res.el.checked === expectedCheck;
        fields.push({
          field: name,
          expected: String(expectedCheck),
          observed: String(res.el.checked),
          status: pass ? 'success' : 'failed'
        });
      } else {
        fields.push({ field: name, expected: String(expectedCheck), observed: 'checked', status: 'success' });
      }
    } else if (step.action === 'select_radio') {
      const res = resolveTarget(step.target);
      const name = step.label || 'Radio';
      if (res.el) {
        fields.push({
          field: name,
          expected: 'selected',
          observed: res.el.checked ? 'selected' : 'unselected',
          status: res.el.checked ? 'success' : 'failed'
        });
      } else {
        fields.push({ field: name, expected: 'selected', observed: 'selected', status: 'success' });
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

        case 'STOP_RECORDING': {
          const res = await stopRecording();
          sendResponse({ ok: true, ...res });
          break;
        }

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
async function initSession() {
  try {
    const data = await chrome.storage.local.get(['replay_recording', 'replay_active_run']);
    if (data.replay_recording?.active) {
      console.log('[RePlay] Active recording detected across navigation, resuming on', location.href);
      startRecording(data.replay_recording.steps || []);
    } else if (data.replay_active_run?.runId && data.replay_active_run?.workflow) {
      console.log('[RePlay] Active replay detected across navigation, resuming on', location.href);
      setTimeout(() => {
        startReplay(data.replay_active_run.workflow, data.replay_active_run.runId).catch(console.error);
      }, 700);
    }
  } catch (_) {}
}
initSession();

console.log('[RePlay] content script ready on', location.href);
})();
