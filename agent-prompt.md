# Build RePlay: Teach Once, Automate Safely (Chrome MV3 extension + demo CRM)

You are a senior browser-extension engineer working as my implementation partner. Build a real, working Chrome extension prototype for the "Teach-Me-Once Computer Agent" hackathon challenge, plus a small demo CRM it operates on. I have a hard limit of 240 minutes from when you start. Note the start time with `date` and check it at every milestone. Optimize for a working end-to-end demo, not completeness. A chatbot that only explains things does not qualify.

## 0. How to work

- First inspect the working directory. If it contains an organizer-provided browser app, inspect it and prefer it over building the CRM. Otherwise build the CRM described below. Never overwrite or delete existing files without inspecting them.
- Work in the 6 milestones in section 9. After each one, run the available checks, report the ACTUAL result in 2-3 lines, commit, and move on. If something fails, fix it before adding scope.
- Do not claim a feature works unless you executed a test for it. Never invent test outcomes, repository URLs or deployment URLs. Anything you could not run goes in a final "incomplete or unverified" list.
- Do not stop after planning. Implement. Ask me at most one focused question, and only for a real blocker; otherwise choose sensible defaults and continue.
- Use JavaScript, React and Vite. No new frameworks. The extension has no build step.
- Check whether Chrome or Chromium is available. If not, try `npx playwright install chromium`. If that is blocked, test the logic with jsdom and give me an exact manual Chrome checklist to run, and mark browser behavior as unverified until I report results.

## 1. What the product does

1. Observes the user completing a task in a browser app (recording).
2. Saves the actions as a reusable workflow.
3. Replays the workflow on a different record.
4. Verifies the intended changes actually happened.
5. Stops safely if the interface or task changes.

Demo scenario: on Customer A the user sets status to "Follow-up", types a note, and clicks Save. The extension stores the steps. On Customer B (and later C) it replays the same steps using the same reusable page controls, with no hardcoded customer identity, then independently checks the saved status and note.

## 2. Constraints

- Manifest V3. Permissions: `storage` and `sidePanel` only. No `tabs`, no `<all_urls>`.
- Supported scope is explicit: the demo CRM only. Use static `content_scripts` matches for `http://localhost:5173/*` plus the deployed CRM URL once it exists (add it after deploying). Put the scope in the README.
- Local-first. No paid API, API key, backend, hosted database or AI inference anywhere. No LLM, and no sending page content anywhere.
- No hidden iframes, no remote or downloaded code, no `eval`.
- Respect Chrome's restrictions on privileged pages (`chrome://`, Web Store). The side panel needs Chrome 114+; say so in the README.

## 3. Architecture

- **Content script** (`extension/content/`): recorder, replayer, verifier. It owns the DOM and runs the replay loop, so replay survives the service worker sleeping.
- **Background service worker**: opens the side panel on action click (`chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`), relays messages, persists recording state and run logs in `chrome.storage.local`. It holds no in-memory state that matters.
- **Side panel** (`extension/sidepanel/sidepanel.html|css|js`): all UI. Talks to the content script via `chrome.tabs.sendMessage` and listens via `chrome.runtime.onMessage`.
- **CRM demo** (`crm-demo/`): React + Vite, deployable to Vercel as-is.

Suggested layout:

```
replay/
  extension/
    manifest.json, background.js
    content/ selectors.js, recorder.js, replayer.js, verifier.js, index.js
    sidepanel/ sidepanel.html, sidepanel.css, sidepanel.js
  crm-demo/ (Vite + React: src/App.jsx, data.js, faults.js)
  tests/ (node:test + jsdom, TESTS.md)
  README.md, DEMO_SCRIPT.md
```

## 4. Demo CRM spec (build this first and keep it tiny)

- Hash routes: `#/` (customer list) and `#/customers/:id` (detail). No router library.
- Seed three customers into `localStorage["crm.customers"]` on first load: `[{id:"c1",name:"Alice Johnson"},{id:"c2",name:"Bob Smith"},{id:"c3",name:"Carol Diaz"}]`, each with `status:"New"`, `notes:""`, `updatedAt:null`.
- Detail page elements use the SAME `data-testid` on every record, with accessible labels:
  - `record-name` (shows the customer name), `status-select` (options New, Contacted, Follow-up, Closed), `notes-input` (textarea), `save-button`, `save-toast`, `back-link`.
  - A "Saved values" panel rendered from the persisted store, not from form state: `saved-status`, `saved-notes`, `saved-updated-at`.
  - List page: `customer-row-{id}` (these are record-specific and must never end up in a workflow).
- Save writes the whole customer array back to `localStorage["crm.customers"]` with a fresh `updatedAt` and shows `save-toast`.
- Test-only faults, honored only via query param (e.g. `#/customers/c2?fault=...`; read it from the hash query so it survives the SPA):
  - `fault=rename-save`: Save button's testid becomes `save-btn-v2` and its label changes.
  - `fault=remove-status`: status select is not rendered.
  - `fault=duplicate-save`: two elements share `data-testid="save-button"`.
  - When a fault is active show a visible "TEST FAULT ACTIVE" banner with a `restore-button` that removes the fault and re-renders. This is how Test 3 recovers.

## 5. Recorder

- Explicit Start Recording and Stop Recording in the side panel. While recording show an unmistakable red "REC" indicator in the panel (and a small fixed badge injected into the page).
- Capture-phase listeners. Record:
  - `change` on `select`, `input` and `textarea` as ONE step per final value (not per keystroke).
  - `click` only on buttons, `[role=button]`, submit inputs and links. Ignore clicks on plain form controls, the REC badge, and anything inside the extension UI.
- Steps are ordered. Schema:

```js
workflow = { id, name, createdAt, sourceRecordLabel, steps: [
  { id, order, action: "select"|"type"|"click",
    target: { testid, id, role, ariaLabel, labelText, tag },
    value,            // for select/type only
    sensitive,        // true => value not stored
    consequential,    // true for save/submit/delete-like clicks
    label }           // human-readable, e.g. 'Select "Follow-up" in Status'
] }
```

- Target strategy: prefer `data-testid`, then `id`, then `aria-label`, then label text + role. Store several if available.
- Reject record-specific targets: if the best identifier looks record-specific (contains the record id, e.g. `customer-row-c1`), do not add the step and show a visible warning in the panel. The workflow must never contain a customer id.
- Privacy: never record `type=password` fields or fields whose name/id/label/autocomplete matches `/pass|pwd|secret|token|card|cvv|ssn|otp/i`. Store `sensitive:true` with no value; replay pauses and asks the user to enter it.
- Stop Recording asks for a workflow name (default "Set status and note"), saves to `chrome.storage.local`, and shows the steps for inspection.

## 6. Replayer

- Replay runs on whichever record is currently open. The panel shows the current workflow and the target record's name (read from `record-name`).
- **Preflight:** before changing anything, resolve every step's target. If any fail, stop with zero changes and report the step.
- Per step: resolve with polling (100 ms interval, 5000 ms timeout), require exactly one match, visible and enabled.
  - 0 matches after timeout: status `failed`, reason "missing".
  - more than 1 match: status `failed`, reason "ambiguous (N matches)". Never pick one and never click a nearby element as a fallback.
  - also compare the recorded label/role hint with what is found; if it drifted, stop with reason "target changed".
- Applying values: for React-controlled inputs use the native value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement/HTMLTextAreaElement/HTMLSelectElement.prototype, "value").set`), then dispatch bubbling `input` and `change` events. Plain `el.value = x` does not work with React. After applying, read the control back and confirm it holds the value.
- Consequential steps (save/submit/delete): require explicit confirmation in the side panel before executing (60 s timeout, cancel stops the run).
- Idempotency: persist `{runId, completedStepIds}`. Retry resumes from the first non-success step and never re-executes a consequential step that already succeeded.
- Stream per-step results to the panel as they happen: `pending | running | success | failed | skipped`.
- Retry button after a stop, so the user can fix the page (e.g. click Restore) and resume.

## 7. Verifier (separate from replay, never trusts "click dispatched")

After the last step, wait up to 3 s for the store to change, then read `localStorage["crm.customers"]` and find the current record by the id in the URL hash. For each recorded select/type step compare expected vs observed. Also cross-check the `saved-status` and `saved-notes` panel. Also check that no other customer changed (snapshot before, compare after).

Per field report `success | failed | unverified` (unverified if the store cannot be read), showing expected and observed values. Overall result is success only if every field is success and there are no collateral changes. This verifier is specific to the demo CRM; state that in the README.

## 8. Side panel UI (responsive, clear, no decoration for its own sake)

- Header with current page/record name and a recording indicator.
- Record and Stop controls.
- Saved workflows list: select, inspect steps, replay, delete, reset demo data. JSON export/import only if time remains.
- Replay and Verify controls, current workflow and target record.
- Live timeline with per-step status icons and the label of each step.
- Clear error and recovery messages naming the failing step and reason, with a Retry button.
- Final verification summary table (field, expected, observed, status).

## 9. Milestones and time budget (minutes from start)

| Time | Work | Milestone |
|---|---|---|
| 0-15 | Inspect workspace, scaffold repo, manifest, minimal CRM, extension loads | M1 |
| 15-90 | SPIKE FIRST: record and replay one select, one type, one click on the CRM. Then full recorder, storage, messaging | M2 |
| 90-145 | Replay on a different record, independent verifier | M3, M4 |
| 145-175 | Missing/ambiguous/changed handling, confirm and retry, the three tests, UI polish | M5 |
| 175-205 | Full end-to-end run, fix critical bugs, deploy CRM to Vercel, publish GitHub repo | M6 |
| 205-240 | README, demo script, final verification, submission notes | M6 |

At minute 145, if record -> replay -> verify is not working end to end, stop adding anything and fix. If a feature threatens the deadline, cut in this order: LLM, JSON import/export, multiple websites, selector repair, nonessential polish. Never cut recording, replay, verification or safe-stop.

## 10. The three required tests (document actual observed results in `tests/TESTS.md`)

- **Test 1, successful replay:** record on Alice (c1), replay on Bob (c2), independently verify Bob's saved status and note.
- **Test 2, workflow reuse:** replay the SAME stored workflow (same workflow id, no re-recording) on Carol (c3) and verify. Show the workflow id and that step count and content are unchanged.
- **Test 3, interface change:** open a record with `fault=rename-save` (also try `remove-status` and `duplicate-save`). Replay must stop, name the failing step and reason, change nothing, and not report success. Click Restore, press Retry, and show it completes and verifies.

Also add unit tests (node:test + jsdom) for: selector resolution (found/missing/ambiguous), recorder redaction, record-specific target rejection, native-setter value application, and verifier pass/fail. If a real browser is available, add an automated end-to-end run of the three tests; otherwise provide a manual checklist and mark browser results unverified until I confirm them.

## 11. Git, deploy, publish

- Initialize git, commit at each milestone.
- Deploy `crm-demo` to Vercel (CLI if authenticated, otherwise give me exact dashboard steps). Add the deployed URL to the manifest matches.
- Publish a public GitHub repo with `gh` if authenticated, otherwise give me exact commands. Report URLs only if the commands succeeded.

## 12. Final deliverables

1. Working extension source tree and a valid MV3 manifest.
2. A functioning CRM demo.
3. Exact commands to install dependencies and start the CRM (`cd crm-demo && npm install && npm run dev`).
4. Exact steps to load the extension at `chrome://extensions` -> Developer mode -> Load unpacked.
5. Deployed CRM URL and public repo URL if they succeeded.
6. Three documented tests with actual results.
7. Concise README: the user and problem (e.g. an operations person repeating the same CRM update across many customers), setup, architecture, explicit scope, limitations.
8. A 60-90 second demo script (`DEMO_SCRIPT.md`) that shows: record on Alice, replay on Bob with verification, replay on Carol, a fault with a safe stop, Restore and Retry.
9. A final list of anything incomplete or unverified.

## Start now

Inspect the workspace, then immediately build the smallest thing that proves the highest-risk assumption: the extension can capture a small workflow on Customer A, save it, replay it against Customer B, and verify the resulting data. Then expand.
