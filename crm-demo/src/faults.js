// faults.js – Test-only fault injection
// Faults are activated via URL hash query param: #/customers/c2?fault=rename-save
// Read from hash so they survive SPA navigation.

export const FAULT_TYPES = {
  RENAME_SAVE: 'rename-save',
  REMOVE_STATUS: 'remove-status',
  DUPLICATE_SAVE: 'duplicate-save',
};

/**
 * Read the fault from the current URL hash.
 * e.g., #/customers/c2?fault=rename-save → 'rename-save'
 */
export function getActiveFault() {
  const hash = window.location.hash || '';
  // Extract query string from hash: #/customers/c2?fault=xxx
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return null;
  const qs = new URLSearchParams(hash.slice(qIdx + 1));
  return qs.get('fault') || null;
}

/**
 * Remove the fault param from the hash and trigger re-render.
 */
export function clearFault() {
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return;
  const path = hash.slice(1, qIdx); // e.g. /customers/c2
  window.location.hash = path;
}
