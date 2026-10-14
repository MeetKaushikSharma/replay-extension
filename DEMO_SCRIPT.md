# DEMO_SCRIPT.md – RePlay 60–90 Second Demo

## Setup (do before demo)
- CRM running: `cd crm-demo && npm run dev` → http://localhost:5173
- Extension loaded at `chrome://extensions` (Developer mode → Load unpacked → `extension/`)
- Click **↺ Reset Demo Data** on the CRM list page to ensure all customers are "New" with empty notes

---

## 1. Record on Alice (~20 s)

> *"I'll teach RePlay what to do by performing it once on Alice."*

1. Open `http://localhost:5173/#/customers/c1` — shows **Alice Johnson**, Status: New
2. Click the RePlay icon → side panel opens; header shows "Alice Johnson"
3. **Record tab** → click **▶ Start Recording** — red **"● REC (0)"** badge appears on page
4. Change **Status** to **Follow-up** — badge becomes "● REC (1)"; panel shows `▼ Select "Follow-up" in Status`
5. Click **Notes** → type `Call next week` — badge becomes "● REC (2)"; panel shows `✎ Type into Notes`
6. Click **Save** — badge becomes "● REC (3)"; panel shows `↵ Click save-button ⚠`
7. Click **■ Stop Recording**
8. Name: `Set status and note` → **Save Workflow** → switches to Workflows tab

> *"Three steps. The ⚠ marks the Save as a consequential step — it will need your confirmation during replay."*

---

## 2. Replay on Bob (~25 s)

> *"Now I'll replay the exact same workflow on Bob — without touching Alice."*

1. Navigate to `http://localhost:5173/#/customers/c2` — **Bob Smith**, Status: New
2. Workflows tab → card shows **"Recorded from: Alice Johnson"** · click **🔍 Steps** to inspect
3. Click **▶ Use** → Replay tab — shows Target: **Bob Smith**
4. Click **▶ Replay**
5. Timeline: `▼ Select` ✓ → `✎ Type` ✓ → `↵ Click save-button` → confirmation dialog appears:
   **"About to execute: 'Click save-button'. This is a consequential action. Proceed?"**
6. Click **✓ Confirm** → Save ✓ → Overall: `REPLAY COMPLETE`
7. Click **✓ Verify** → verification table:
   - status: Follow-up → **✅ success**
   - notes: Call next week → **✅ success**
   - saved-status (DOM) → **✅ success**
   - saved-notes (DOM) → **✅ success**
   - Overall: **SUCCESS**

---

## 3. Replay on Carol (~10 s)

> *"Same workflow, no re-recording."*

1. Navigate to `http://localhost:5173/#/customers/c3` — **Carol Diaz**
2. Replay tab → same workflow selected → **▶ Replay** → Confirm → Verify → **SUCCESS**

> *"Same 3 steps, Carol updated. Alice and Bob are unchanged — verified by reading localStorage directly."*

---

## 4. Fault: Renamed Save Button (~20 s)

> *"What if someone changes the interface? Watch RePlay stop safely."*

1. Navigate to `http://localhost:5173/#/customers/c2?fault=rename-save`
2. Red banner: **"⚠ TEST FAULT ACTIVE: rename-save"**
3. Replay tab → **▶ Replay**
4. Status ✓, Notes ✓, Save step ✕ — error: `Preflight: step "Click save-button" – missing`
5. **No data changed** — preflight stopped before touching anything
6. Click **Restore** on the page → fault removed
7. Side panel → **↺ Retry** → resumes from Save step → Verify → **SUCCESS**

> *"Named the exact failing step. Stopped before any consequential action. Retry without re-running what already worked."*

---

## Done

Total time: ~75 seconds. Key points:
- ✅ Teach once, replay safely on multiple records
- ✅ Live step count badge while recording (● REC (n))
- ✅ Independent verification — reads localStorage directly, not the UI
- ✅ Safe stop on interface change, with exact reason + retry
- ✅ Fully local — no AI, no server, no API key

---

## Vercel Deploy (one-time)

```bash
cd crm-demo
npx vercel login      # auth with GitHub
npx vercel --prod     # deploy — note the URL (e.g. https://replay-crm.vercel.app)
```

After deploy, add the URL to `extension/manifest.json`:
```json
"host_permissions": ["http://localhost:5173/*", "https://replay-crm.vercel.app/*"],
"content_scripts": [{ "matches": ["http://localhost:5173/*", "https://replay-crm.vercel.app/*"], ... }]
```
Then reload the extension and navigate to the deployed URL.
