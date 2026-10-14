# TESTS.md – Required Test Results

> **Status**: Unit tests run and verified. Browser-based end-to-end tests require manual execution because no automated browser driver is available in this environment. Results for Tests 1–3 are marked **UNVERIFIED (manual checklist provided)** until you report them.

---

## Unit Tests (node:test + jsdom) — VERIFIED

Run: `node --test tests/selectors.test.js`

**Actual result (run at ~12:26 IST, 14 Oct 2026):**

```
# tests 17
# suites 5
# pass 17
# fail 0
# cancelled 0
# skipped 0
# duration_ms ~596
```

### Suite breakdown

| Suite | Tests | Result |
|---|---|---|
| Selector resolution | 6 | ✅ all pass |
| Record-specific target rejection | 2 | ✅ all pass |
| Recorder redaction (sensitive fields) | 4 | ✅ all pass |
| Native-setter value application | 2 | ✅ all pass |
| Verifier logic | 3 | ✅ all pass |

Covers: found / missing / ambiguous, disabled element excluded, fallback id/ariaLabel, record-specific rejection (customer-row-c1), sensitive pattern (password/token/card), native setter + event fire, verifier pass/fail/unverified.

---

## Test 1 – Successful Replay (UNVERIFIED – manual checklist)

**Scenario:** Record on Alice (c1), replay on Bob (c2), independently verify Bob's saved status and note.

### Manual steps
1. `cd crm-demo && npm install && npm run dev` (if not already running)
2. Load extension: `chrome://extensions` → Developer mode → Load unpacked → select `extension/` folder
3. Open `http://localhost:5173/#/customers/c1` (Alice Johnson)
4. Click the RePlay extension action icon → side panel opens
5. In the **Record** tab, click **▶ Start Recording** (red REC badge appears on page)
6. Change Status select to **Follow-up**
7. Type `Call next week` into the Notes textarea
8. Click **Save**
9. In side panel, click **■ Stop Recording**
10. Name: `Set status and note` → click **Save Workflow**
11. Navigate to `http://localhost:5173/#/customers/c2` (Bob Smith)
12. In side panel, switch to **Replay** tab
13. In **Workflows** tab, click **▶ Select** next to the saved workflow
14. Back in **Replay** tab, verify Target shows "Bob Smith"
15. Click **▶ Replay**
16. When confirmation dialog appears for the Save step, click **✓ Confirm**
17. All steps should show ✓ success
18. Click **✓ Verify**

**Expected outcome:**
- Timeline: all 3 steps green ✓
- Verification table shows:
  - status: expected `Follow-up`, observed `Follow-up` → ✅ success
  - notes: expected `Call next week`, observed `Call next week` → ✅ success
  - saved-status (DOM): ✅ success
  - saved-notes (DOM): ✅ success
- Overall: **SUCCESS**
- The `saved-updated-at` field is non-null

**Actual result:** ⬜ UNVERIFIED — awaiting user confirmation

---

## Test 2 – Workflow Reuse (UNVERIFIED – manual checklist)

**Scenario:** Replay the SAME stored workflow (same workflow id, no re-recording) on Carol (c3).

### Manual steps (continue from Test 1)
1. Note the workflow ID shown in the Workflows tab (e.g., `wf_1728...`)
2. Navigate to `http://localhost:5173/#/customers/c3` (Carol Diaz)
3. In the side panel **Workflows** tab — do NOT create a new workflow. The same one from Test 1 is still selected.
4. Switch to **Replay** tab → Target should now show "Carol Diaz"
5. Click **▶ Replay**
6. Confirm the Save step when prompted
7. Click **✓ Verify**

**Expected outcome:**
- Same workflow ID as Test 1 is used (no new recording)
- Same step count (3 steps)
- Same step content (Select Follow-up, Type "Call next week", Click Save)
- Carol's data shows status=Follow-up, notes="Call next week"
- Verification: overall **SUCCESS**
- Alice's and Bob's data are **unchanged** (no collateral changes)

**Actual result:** ⬜ UNVERIFIED — awaiting user confirmation

---

## Test 3 – Interface Change / Safe Stop (UNVERIFIED – manual checklist)

**Scenario:** Open a record with various faults, replay must stop and name the failing step.

### Test 3a – fault=rename-save
1. Navigate to `http://localhost:5173/#/customers/c2?fault=rename-save`
2. Observe: red "TEST FAULT ACTIVE: rename-save" banner at top
3. In side panel Replay tab, click **▶ Replay** (same workflow selected)
4. Replay proceeds through status and notes steps but **STOPS** on the Click Save step
5. Timeline shows: Select ✓, Type ✓, Click Save ✕
6. Error message: `Step "Click save-button" failed: missing` (or similar)
7. **Zero data changes** — verify Bob's record is unchanged in Saved values panel
8. **No success is reported**
9. In page, click **Restore** button (removes fault)
10. In side panel, click **↺ Retry**
11. Replay resumes from the Save step (not re-executing already-done steps)
12. Completion and Verify succeeds

### Test 3b – fault=remove-status
1. Navigate to `http://localhost:5173/#/customers/c2?fault=remove-status`
2. Click **▶ Replay**
3. Replay stops on the Select step (status-select not rendered)
4. Preflight or first step fails: reason "missing"
5. Retry after Restore → succeeds

### Test 3c – fault=duplicate-save
1. Navigate to `http://localhost:5173/#/customers/c2?fault=duplicate-save`
2. Click **▶ Replay**
3. Replay proceeds through status and notes, then stops on Save step
4. Reason: "ambiguous (2 matches)" — two elements share data-testid="save-button"
5. Retry after Restore → succeeds

**Actual result:** ⬜ UNVERIFIED — awaiting user confirmation

---

## Notes

- The `fault=rename-save` test also validates idempotency: the consequential Save step is NOT re-executed after Retry (only non-completed steps resume).
- Browser behavior is **unverified** due to no automated Chrome/Playwright available in this build environment.
- Provide your test results and I will update this file with actual observed outcomes.
