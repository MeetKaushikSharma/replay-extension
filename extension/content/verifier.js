// verifier.js – Independent post-replay verifier.
// Reads localStorage directly; never trusts that "click was dispatched".
// Specific to the demo CRM; documented as such.

'use strict';

/**
 * Run verification after a replay.
 * @param {object} workflow - The workflow that was just replayed.
 * @returns {object} Verification result.
 */
async function runVerification(workflow) {
  // Take a snapshot of ALL customers BEFORE we start (in case we need collateral change check)
  // We want the state AFTER replay, but we already ran replay, so read now.
  const customersJson = localStorage.getItem('crm.customers');
  if (!customersJson) {
    return {
      overall: 'unverified',
      reason: 'Cannot read localStorage["crm.customers"]',
      fields: []
    };
  }

  let customers;
  try {
    customers = JSON.parse(customersJson);
  } catch {
    return { overall: 'unverified', reason: 'localStorage parse error', fields: [] };
  }

  // Identify the current record by URL hash
  const m = location.hash.match(/#\/customers\/([^/?]+)/);
  if (!m) {
    return { overall: 'unverified', reason: 'Cannot determine record id from URL hash', fields: [] };
  }
  const currentId = m[1];
  const currentCustomer = customers.find(c => c.id === currentId);
  if (!currentCustomer) {
    return { overall: 'unverified', reason: `Customer ${currentId} not found in store`, fields: [] };
  }

  // Collect expected values from workflow steps
  const expected = {};
  for (const step of workflow.steps) {
    if (step.action === 'select' || step.action === 'type') {
      const testid = step.target.testid;
      if (testid === 'status-select') expected.status = step.value;
      if (testid === 'notes-input') expected.notes = step.value;
    }
  }

  const fields = [];

  // Check status
  if ('status' in expected) {
    const observed = currentCustomer.status;
    const status = observed === expected.status ? 'success' : 'failed';
    fields.push({ field: 'status', expected: expected.status, observed, status });
  }

  // Check notes
  if ('notes' in expected) {
    const observed = currentCustomer.notes;
    const status = observed === expected.notes ? 'success' : 'failed';
    fields.push({ field: 'notes', expected: expected.notes, observed, status });
  }

  // Cross-check the visible "Saved values" panel in the DOM
  const savedStatusEl = document.querySelector('[data-testid="saved-status"]');
  const savedNotesEl = document.querySelector('[data-testid="saved-notes"]');

  if (savedStatusEl && 'status' in expected) {
    const domStatus = savedStatusEl.textContent.trim();
    const match = domStatus === expected.status;
    fields.push({ field: 'saved-status (DOM)', expected: expected.status, observed: domStatus, status: match ? 'success' : 'failed' });
  }
  if (savedNotesEl && 'notes' in expected) {
    const domNotes = savedNotesEl.textContent.trim();
    const match = domNotes === expected.notes;
    fields.push({ field: 'saved-notes (DOM)', expected: expected.notes, observed: domNotes, status: match ? 'success' : 'failed' });
  }

  // Collateral change check – compare all OTHER customers
  // We need a "before" snapshot. We'll read a previously stored snapshot if available.
  const beforeKey = `before_snapshot_${currentId}`;
  const beforeData = await chrome.storage.local.get(beforeKey);
  if (beforeData[beforeKey]) {
    const before = beforeData[beforeKey];
    for (const c of customers) {
      if (c.id === currentId) continue;
      const prev = before.find(x => x.id === c.id);
      if (!prev) continue;
      if (JSON.stringify(c) !== JSON.stringify(prev)) {
        fields.push({
          field: `collateral: ${c.id}`,
          expected: 'unchanged',
          observed: 'CHANGED',
          status: 'failed'
        });
      }
    }
  }

  const overall = fields.every(f => f.status === 'success') ? 'success' : 'failed';

  const result = { overall, fields, currentId, updatedAt: currentCustomer.updatedAt };

  // Notify panel
  chrome.runtime.sendMessage({ type: 'VERIFY_RESULT', result, _fromContent: true }).catch(() => {});

  return result;
}

/**
 * Take a snapshot of all customers and store it (for collateral change detection).
 */
async function takeSnapshot(currentId) {
  const customersJson = localStorage.getItem('crm.customers');
  if (!customersJson) return;
  try {
    const customers = JSON.parse(customersJson);
    await chrome.storage.local.set({ [`before_snapshot_${currentId}`]: customers });
  } catch {}
}

window.__replayVerifier = { runVerification, takeSnapshot };
