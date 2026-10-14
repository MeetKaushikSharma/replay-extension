# RePlay – Teach Once, Automate Safely

A Chrome MV3 extension that lets an operations user record a workflow on one CRM record, then safely replay it on multiple records — with independent verification and fault detection.

> **Requires Chrome 114+** (for `sidePanel` API)

---

## The Problem

Operations teams repeat the same data-entry workflow across dozens of CRM records every day — setting a status, writing a note, clicking Save. This is tedious and error-prone. RePlay lets you **teach it once, replay it safely** on every record, with automatic verification that the data was actually saved correctly.

## Quick Start

### 1. Run the Demo CRM

```bash
cd crm-demo
npm install
npm run dev
# → http://localhost:5173
```

### 2. Load the Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Pin the RePlay extension icon to your toolbar

### 3. Record a Workflow

1. Open `http://localhost:5173/#/customers/c1` (Alice Johnson)
2. Click the RePlay icon → side panel opens
3. Click **▶ Start Recording** (red REC badge appears)
4. Change Status to **Follow-up**
5. Type a note: `Call next week`
6. Click **Save**
7. Click **■ Stop Recording** → name it → click **Save Workflow**

### 4. Replay on Another Record

1. Navigate to `http://localhost:5173/#/customers/c2` (Bob Smith)
2. In the Workflows tab, click **▶ Select** next to your workflow
3. Switch to the **Replay** tab → click **▶ Replay**
4. Confirm the consequential Save step when prompted
5. Click **✓ Verify** to independently confirm Bob's data was saved

---

## Architecture

```
extension/
├── manifest.json          MV3, permissions: storage + sidePanel only
├── background.js          Service worker: opens panel, relays messages
├── content/
│   ├── selectors.js       Target resolution (testid → id → aria-label → label)
│   ├── recorder.js        Capture-phase event listeners, REC badge
│   ├── replayer.js        Preflight + step execution, React value setter
│   ├── verifier.js        Reads localStorage["crm.customers"] independently
│   └── index.js           Message router
└── sidepanel/
    ├── sidepanel.html     UI shell
    ├── sidepanel.css      Dark theme
    └── sidepanel.js       All UI logic, tab switching, timeline, verify table

crm-demo/                  React + Vite SPA (hash router, no library)
├── src/
│   ├── App.jsx            List + detail pages, all data-testids
│   ├── data.js            localStorage helpers, seed data
│   └── faults.js          Test-only fault injection via hash query param

tests/
├── selectors.test.js      node:test + jsdom, 17 unit tests
└── TESTS.md               Test documentation and results
```

### Message Flow

```
Side panel ──sendMessage──► Background SW ──tabs.sendMessage──► Content script
Content script ──sendMessage(_fromContent:true)──► Background SW ──sendMessage──► Side panel
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Replay runs in content script | Survives service worker sleeping; owns the DOM |
| Preflight before any action | Zero changes if any target is unresolvable |
| Native value setter for React | `el.value = x` doesn't trigger React state; native setter + `input`/`change` events does |
| Consequential step confirmation | User must explicitly confirm save/submit/delete clicks |
| Independent verifier | Reads `localStorage` directly — never trusts that "click was dispatched" |
| Idempotent run state | Persisted in `chrome.storage.local`; retry never re-executes successful consequential steps |

---

## Explicit Scope

**Supported:** The demo CRM at:
- `http://localhost:5173/*` (local dev)
- `https://crm-demo-mu-sandy.vercel.app/*` (production)

**Not supported:**
- Any other website
- Multi-tab or cross-origin workflows
- AI inference of any kind
- Remote code, hidden iframes, or eval
- `chrome://` or Web Store pages (blocked by Chrome)

The verifier is CRM-specific: it reads `localStorage["crm.customers"]` and cross-checks `[data-testid="saved-status"]` and `[data-testid="saved-notes"]`. Extending it to other apps would require a new verifier strategy.

---

## Test-Only Faults

Activate by appending `?fault=<name>` to the hash:

| Fault | Effect | Replay behavior |
|---|---|---|
| `rename-save` | Save button testid becomes `save-btn-v2` | Stops on Save step: "missing" |
| `remove-status` | Status select not rendered | Stops on Select step: "missing" |
| `duplicate-save` | Two elements share `data-testid="save-button"` | Stops on Save step: "ambiguous (2 matches)" |

A red "TEST FAULT ACTIVE" banner appears. A **Restore** button removes the fault.

---

## Limitations

- **Browser testing unverified**: No Playwright/Chromium available in this build environment. Unit tests (17/17) pass. Browser tests require manual execution — see `tests/TESTS.md`.
- **CRM-specific verifier**: The post-replay verification only works with this demo CRM's `localStorage` schema.
- **No persistent login**: Extension doesn't handle authentication flows.
- **Single-tab only**: Replay must happen on the active tab in the current window.
- **No undo**: Replay applies real data changes. Use the Reset Demo Data button to restore seed state.
- **JSON import/export**: Not implemented (cut to meet deadline).

---

## Running Tests

```bash
# Unit tests (node:test + jsdom)
npm install
node --test tests/selectors.test.js
```

---

## Deployment

### CRM Demo

**Live:** https://crm-demo-mu-sandy.vercel.app/

```bash
cd crm-demo
npx vercel --prod
```

The extension `manifest.json` already includes the deployed URL in `host_permissions` and `content_scripts.matches` — no further changes needed after deploy.

### GitHub

```bash
gh repo create replay-extension --public --source=. --push
```

---

## Demo CRM Seed Data

On first load, seeds to `localStorage["crm.customers"]`:
```json
[
  {"id":"c1","name":"Alice Johnson","status":"New","notes":"","updatedAt":null},
  {"id":"c2","name":"Bob Smith","status":"New","notes":"","updatedAt":null},
  {"id":"c3","name":"Carol Diaz","status":"New","notes":"","updatedAt":null}
]
```

Reset: click **↺ Reset Demo Data** in the extension side panel (Workflows tab) or the Reset button on the CRM list page.
