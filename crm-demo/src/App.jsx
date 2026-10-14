import React, { useState, useEffect, useCallback } from 'react';
import { getCustomers, getCustomer, saveCustomer, resetCustomers } from './data.js';
import { getActiveFault, clearFault, FAULT_TYPES } from './faults.js';

// ── Routing ──────────────────────────────────────────────────────────────────
function parseRoute() {
  const hash = window.location.hash || '#/';
  const qIdx = hash.indexOf('?');
  const path = qIdx === -1 ? hash.slice(1) : hash.slice(1, qIdx);
  const fault = getActiveFault();
  const m = path.match(/^\/customers\/([^/]+)$/);
  if (m) return { page: 'detail', id: m[1], fault };
  return { page: 'list', fault };
}

// ── Customer List Page ───────────────────────────────────────────────────────
function CustomerList({ onReset }) {
  const [customers, setCustomers] = useState(() => getCustomers());

  useEffect(() => {
    const refresh = () => setCustomers(getCustomers());
    window.addEventListener('hashchange', refresh);
    return () => window.removeEventListener('hashchange', refresh);
  }, []);

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Demo CRM</h1>
      <p style={styles.subtitle}>Choose a customer to view their record.</p>
      <div style={styles.listContainer}>
        {customers.map(c => (
          <a
            key={c.id}
            href={`#/customers/${c.id}`}
            data-testid={`customer-row-${c.id}`}
            style={styles.row}
          >
            <span style={styles.rowName}>{c.name}</span>
            <span style={styles.rowBadge(c.status)}>{c.status}</span>
          </a>
        ))}
      </div>
      <div style={styles.toolbar}>
        <button
          style={styles.resetBtn}
          onClick={() => { resetCustomers(); window.location.reload(); }}
        >
          ↺ Reset Demo Data
        </button>
      </div>
    </div>
  );
}

// ── Customer Detail Page ─────────────────────────────────────────────────────
function CustomerDetail({ id, fault }) {
  const [customer, setCustomer] = useState(() => getCustomer(id));
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(null);  // persisted values (from store)
  const [toastVisible, setToastVisible] = useState(false);

  // Load customer when id or localStorage changes
  const reloadCustomer = useCallback(() => {
    const c = getCustomer(id);
    setCustomer(c);
    if (c) {
      setStatus(c.status);
      setNotes(c.notes || '');
      setSaved({ status: c.status, notes: c.notes || '', updatedAt: c.updatedAt });
    }
  }, [id]);

  useEffect(() => { reloadCustomer(); }, [reloadCustomer]);

  if (!customer) {
    return <div style={styles.page}><p>Customer not found. <a href="#/">← Back</a></p></div>;
  }

  const handleSave = () => {
    const updated = saveCustomer({ id, status, notes });
    setSaved({ status: updated.status, notes: updated.notes, updatedAt: updated.updatedAt });
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2500);
  };

  // Fault: rename-save → save button gets testid "save-btn-v2" and label "Save Record"
  const saveTestId  = fault === FAULT_TYPES.RENAME_SAVE  ? 'save-btn-v2'    : 'save-button';
  const saveLabel   = fault === FAULT_TYPES.RENAME_SAVE  ? 'Save Record'    : 'Save';
  const showStatus  = fault !== FAULT_TYPES.REMOVE_STATUS;

  return (
    <div style={styles.page}>
      {/* TEST FAULT ACTIVE banner */}
      {fault && (
        <div style={styles.faultBanner}>
          ⚠ TEST FAULT ACTIVE: <strong>{fault}</strong>
          <button
            data-testid="restore-button"
            style={styles.restoreBtn}
            onClick={clearFault}
          >
            Restore
          </button>
        </div>
      )}

      <a data-testid="back-link" href="#/" style={styles.backLink}>← Back to list</a>
      <h2 data-testid="record-name" style={styles.h2}>{customer.name}</h2>

      <div style={styles.form}>
        {/* Status select */}
        {showStatus && (
          <div style={styles.field}>
            <label htmlFor="status-select" style={styles.label}>Status</label>
            <select
              id="status-select"
              data-testid="status-select"
              aria-label="Status"
              value={status}
              onChange={e => setStatus(e.target.value)}
              style={styles.select}
            >
              <option value="New">New</option>
              <option value="Contacted">Contacted</option>
              <option value="Follow-up">Follow-up</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
        )}

        {/* Notes textarea */}
        <div style={styles.field}>
          <label htmlFor="notes-input" style={styles.label}>Notes</label>
          <textarea
            id="notes-input"
            data-testid="notes-input"
            aria-label="Notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={styles.textarea}
            rows={4}
          />
        </div>

        {/* Save button – fault: duplicate-save adds a second one */}
        <div style={styles.buttonRow}>
          <button
            data-testid={saveTestId}
            aria-label={saveLabel}
            onClick={handleSave}
            style={styles.saveBtn}
          >
            {saveLabel}
          </button>
          {fault === FAULT_TYPES.DUPLICATE_SAVE && (
            <button
              data-testid="save-button"
              aria-label="Save (duplicate)"
              onClick={handleSave}
              style={styles.saveBtn}
            >
              Save (duplicate)
            </button>
          )}
        </div>

        {/* Toast */}
        {toastVisible && (
          <div data-testid="save-toast" style={styles.toast}>
            ✓ Saved successfully
          </div>
        )}
      </div>

      {/* Saved values panel – rendered from persisted store, NOT form state */}
      {saved && (
        <div style={styles.savedPanel}>
          <h3 style={styles.savedTitle}>Saved values</h3>
          <div style={styles.savedRow}>
            <span style={styles.savedLabel}>Status:</span>
            <span data-testid="saved-status">{saved.status}</span>
          </div>
          <div style={styles.savedRow}>
            <span style={styles.savedLabel}>Notes:</span>
            <span data-testid="saved-notes">{saved.notes}</span>
          </div>
          <div style={styles.savedRow}>
            <span style={styles.savedLabel}>Updated at:</span>
            <span data-testid="saved-updated-at">{saved.updatedAt || '—'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App (router) ──────────────────────────────────────────────────────────────
export default function App() {
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (route.page === 'detail') {
    return <CustomerDetail id={route.id} fault={route.fault} />;
  }
  return <CustomerList />;
}

// ── Inline styles (no extra CSS files needed) ─────────────────────────────────
const styles = {
  page: { maxWidth: 640, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' },
  h1:   { fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#1a202c' },
  h2:   { fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#1a202c' },
  subtitle: { color: '#718096', marginBottom: 24 },
  listContainer: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: 8, textDecoration: 'none', color: '#2d3748',
    transition: 'box-shadow .15s',
  },
  rowName: { fontWeight: 600 },
  rowBadge: (status) => ({
    padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
    background: { New: '#ebf8ff', Contacted: '#fefcbf', 'Follow-up': '#faf5ff', Closed: '#f0fff4' }[status] || '#eee',
    color: { New: '#2b6cb0', Contacted: '#744210', 'Follow-up': '#553c9a', Closed: '#276749' }[status] || '#333',
  }),
  toolbar: { display: 'flex', gap: 10 },
  resetBtn: {
    padding: '8px 16px', background: '#f7fafc', border: '1px solid #e2e8f0',
    borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#4a5568',
  },
  backLink: { display: 'inline-block', marginBottom: 12, color: '#4f46e5', fontSize: 14, textDecoration: 'none' },
  form: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, marginBottom: 20 },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#4a5568', marginBottom: 5 },
  select: {
    width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
    borderRadius: 6, fontSize: 14, background: '#fff', color: '#2d3748',
  },
  textarea: {
    width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
    borderRadius: 6, fontSize: 14, resize: 'vertical', fontFamily: 'inherit',
    color: '#2d3748',
  },
  buttonRow: { display: 'flex', gap: 10, marginTop: 4 },
  saveBtn: {
    padding: '9px 22px', background: '#4f46e5', color: 'white',
    border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 14,
  },
  toast: {
    marginTop: 10, padding: '8px 14px', background: '#c6f6d5', color: '#276749',
    borderRadius: 6, fontWeight: 600, fontSize: 13,
  },
  savedPanel: {
    background: '#f7fafc', border: '1px solid #e2e8f0',
    borderRadius: 10, padding: 16,
  },
  savedTitle: { fontSize: 13, fontWeight: 700, color: '#4a5568', marginBottom: 10 },
  savedRow: { display: 'flex', gap: 8, marginBottom: 6, fontSize: 13, alignItems: 'flex-start' },
  savedLabel: { color: '#718096', minWidth: 80, fontWeight: 500 },
  faultBanner: {
    background: '#fed7d7', border: '1px solid #fc8181', color: '#822727',
    padding: '10px 16px', borderRadius: 6, marginBottom: 16,
    display: 'flex', alignItems: 'center', gap: 12, fontWeight: 600, fontSize: 14,
  },
  restoreBtn: {
    marginLeft: 'auto', padding: '5px 14px', background: '#e53e3e',
    color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer',
    fontWeight: 600, fontSize: 13,
  },
};
