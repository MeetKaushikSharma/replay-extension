# DEMO_SCRIPT.md – RePlay 60–90 Second Demo

## Setup (do before demo)
- CRM running: `cd crm-demo && npm run dev` → http://localhost:5173
- Extension loaded at `chrome://extensions` (Developer mode → Load unpacked → `extension/`)
- Click ↺ Reset Demo Data on the CRM to ensure all customers are "New" with empty notes

---

## 1. Record on Alice (~20 s)

> *"I'll teach RePlay what to do by performing it once on Alice."*

1. Open `http://localhost:5173/#/customers/c1` — shows **Alice Johnson**, Status: New
2. Click the RePlay icon → side panel opens
3. **Record tab** → click **▶ Start Recording** — red "● REC" badge appears
4. Change **Status** to **Follow-up** — side panel shows "Select Follow-up in Status"
5. Click **Notes** → type `Call next week` — side panel shows "Type into notes-input"
6. Click **Save** — toast "Saved successfully" appears; side panel shows "Click save-button"
7. Click **■ Stop Recording** → name it `Set status and note` → **Save Workflow**

> *"Three steps recorded. The workflow is stored locally — no server, no AI."*

---

## 2. Replay on Bob (~25 s)

> *"Now I'll replay the exact same workflow on Bob — without touching Alice."*

1. Navigate to `http://localhost:5173/#/customers/c2` — **Bob Smith**, Status: New
2. Side panel → **Workflows** tab → click **▶ Select** on "Set status and note"
3. Switch to **Replay** tab — shows: Workflow: Set status and note | Target: Bob Smith
4. Click **▶ Replay**
5. Timeline: Select step ✓ → Type step ✓ → Save step (⚠ confirmation dialog)
6. Click **✓ Confirm** → Save step ✓
7. Bob's page shows: Status = Follow-up, Notes = "Call next week", Saved values updated

> *"RePlay independently verifies the result."*

8. Click **✓ Verify** → verification table appears:
   - status: Follow-up → **✅ success**
   - notes: Call next week → **✅ success**
   - saved-status (DOM): **✅ success**
   - Overall: **SUCCESS**

---

## 3. Replay on Carol (~10 s)

> *"Same workflow, no re-recording. Let's run it on Carol."*

1. Navigate to `http://localhost:5173/#/customers/c3` — **Carol Diaz**
2. Replay tab → same workflow still selected → click **▶ Replay** → Confirm
3. Verify → **SUCCESS**

> *"Same workflow ID, same 3 steps, Carol's data updated. Alice's and Bob's are unchanged."*

---

## 4. Fault: Renamed Save Button (~20 s)

> *"What if someone changes the interface? Watch RePlay stop safely."*

1. Navigate to `http://localhost:5173/#/customers/c2?fault=rename-save`
2. Red banner: "TEST FAULT ACTIVE: rename-save"
3. Side panel → Replay tab → click **▶ Replay**
4. Status ✓, Notes ✓, Save step ✕ — error: `"Step 'Click save-button' failed: missing"`
5. **No data was changed** — Bob's saved values are unchanged
6. Click **Restore** on the page → fault removed
7. Side panel → click **↺ Retry** → Save step executes and succeeds
8. Verify → **SUCCESS**

> *"RePlay stopped before touching anything consequential, named exactly which step failed, and let us fix and retry — without re-running the steps that already worked."*

---

## Done

Total time: ~75 seconds for a live demo. Key points:
- ✅ Teach once, replay safely on multiple records
- ✅ Independent verification (reads localStorage, not trusting UI)
- ✅ Safe stop on interface change, with named reason and retry
- ✅ Fully local — no AI, no server, no API keys
