// data.js – Customer seed data and localStorage helpers

const STORAGE_KEY = 'crm.customers';

const SEED = [
  { id: 'c1', name: 'Alice Johnson', status: 'New', notes: '', updatedAt: null },
  { id: 'c2', name: 'Bob Smith',     status: 'New', notes: '', updatedAt: null },
  { id: 'c3', name: 'Carol Diaz',    status: 'New', notes: '', updatedAt: null },
];

export function getCustomers() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
    return SEED;
  }
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
    return SEED;
  }
}

export function getCustomer(id) {
  return getCustomers().find(c => c.id === id) || null;
}

export function saveCustomer(updated) {
  const customers = getCustomers();
  const idx = customers.findIndex(c => c.id === updated.id);
  if (idx === -1) return;
  customers[idx] = { ...customers[idx], ...updated, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customers));
  return customers[idx];
}

export function resetCustomers() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(
    SEED.map(c => ({ ...c, status: 'New', notes: '', updatedAt: null }))
  ));
}
