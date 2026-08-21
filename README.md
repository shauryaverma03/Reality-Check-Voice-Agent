# RealityCheck

**Vocallabs Hackathon Drive · Multimodal Track**

RealityCheck is a multimodal AI agent that verifies whether a real-world task was
actually completed by comparing a person's **voice claim** against **photo** and
**document** evidence — instead of just trusting their report. It doesn't ask
"did you finish?" It asks "prove it," then cross-checks voice, photos, and a
procedure checklist against each other, and only accepts the task as done when
the evidence is consistent.

**The persona:** an AMC (annual maintenance contract) technician servicing
split-ACs and RO purifiers for a local service franchise. Today he types "job
done" into a CRM and gets paid regardless of whether the work actually happened
correctly. RealityCheck closes that gap.

> ⚠️ **Status: work in progress.** This README reflects what's actually built
> right now, updated as each piece lands. See [What's built so far](#whats-built-so-far)
> and [Roadmap](#roadmap--build-order) below.
>
> As of now: **verifier, DB, API, and both frontend views are built and have
> been run end-to-end** (task creation → claim → photo evidence → verify →
> supervisor dashboard → task detail with full evidence trail and agent-run
> log), covering all three decisions (VERIFIED, NEED_MORE_EVIDENCE,
> CONFLICT_HUMAN_REVIEW). What's left is real STT wiring polish and the final
> failure-log writeup — see the roadmap.

---

## The demo scenario

1. Technician speaks a claim: task, machine/unit ID, and readings taken
   (e.g. *"Machine 27 ka maintenance complete kar diya, pressure 4.2 bar hai,
   temperature 82 degree hai"*).
2. Uploads two evidence photos: a serial-number/nameplate photo and a
   final-condition photo.
3. RealityCheck extracts structured facts from each modality and checks them
   against a procedure checklist with tolerance ranges (e.g. AC gas pressure
   3.8–4.5 bar, temperature 70–85°C).
4. Decision is always one of:
   - **VERIFIED** — everything present, consistent, in range. Comes with an
     evidence score out of 100.
   - **NEED_MORE_EVIDENCE** — something required is missing; RealityCheck asks
     one targeted follow-up question for exactly what's missing.
   - **CONFLICT_HUMAN_REVIEW** — a reading is outside spec, or two sources
     disagree beyond measurement noise (e.g. voice says machine 27, the
     nameplate photo reads 28) — the contradiction is stated explicitly.

## Why this isn't "voice + vision, called it a day"

The hackathon's originality rule requires two models *or* two modalities to
**genuinely co-operate** — not one model called twice, and not two APIs bolted
on for show. RealityCheck's answer: **one Claude API key, called two
structurally different ways** — a text/reasoning call (structuring the voice
claim, running contradiction logic, drafting follow-ups) and a vision call
(reading values and IDs off photos) — and the verifier only reaches a decision
when *both* feed it together. Remove either modality and nothing can be
verified.

It also satisfies two more of the rubric's originality constraints by design,
not as an afterthought:
- **Handle being wrong** — an explicit `evidence_score` plus a
  `CONFLICT_HUMAN_REVIEW` escalation path, not a silent guess.
- **Degrade gracefully** — the extraction layer falls back to a heuristic/regex
  parser when `ANTHROPIC_API_KEY` isn't set or a call fails, so the pipeline
  still runs end-to-end without a key.

The non-obvious hard part — and the part that's hand-rolled, not delegated to
an API or an agent framework — is turning a procedure checklist into
tolerance-aware, multi-source field comparisons: deciding whether a numeric gap
between two sources is measurement noise or a lie.

## Prior art (Hour-2 checkpoint)

Three closest existing tools, and how RealityCheck differs:

1. **[WizyVision — Proof of Service](https://wizyvision.com/proof-of-service)**
   — GPS/timestamp-embedded photos plus GenAI vision that extracts serial
   numbers or asset tags to confirm the photo matches the right equipment.
   Closest match on the vision side. **Difference:** single-modality —
   it verifies the photo is of the right *asset*, not whether the *reported
   readings* (pressure, temperature) are actually within spec, and there's no
   spoken claim to cross-check against.
2. **[OpsPhotoAnalyzer](https://www.opsanalitica.com/solutions/photo-analyzer)**
   — real-time AI scoring of field photos for compliance/authenticity/fraud.
   **Difference:** photo-only compliance scoring against a policy, not
   cross-modal contradiction detection between what a technician *said* and
   what the evidence *shows*.
3. **[Workforce Vision](https://www.workforcevisionai.com/)** — GPS
   geofencing, QR check-in, photo capture, "tamper-resistant evidence
   scoring." **Difference:** the evidence score there is about presence/location
   (were you there, on time, with a photo), not measurement correctness — it
   has no notion of a tolerance band or a numeric spec to verify against.

A related but distinct category is India's mandatory **geotagged-photo**
requirements for government/NGO fieldwork (e.g. via apps like GPS Map Camera) —
these solve *"was this photo actually taken at this site, now"* (anti-recycling
fraud), which is a real and adjacent problem, but orthogonal to RealityCheck's:
none of these tools ask whether the *content* of a claim (a specific pressure
or temperature reading) is internally consistent across voice, photo, and a
tolerance-banded spec. That three-way, tolerance-aware, cross-modal
contradiction check is what's novel here, not "photo evidence" or "GPS proof"
by themselves — both of which already exist as commodity features.

---

## What's built so far

- ✅ **The verifier** ([backend/src/verifier.js](backend/src/verifier.js)) — the
  core decision logic. Hand-rolled, no LangGraph/CrewAI, so the control flow is
  a single readable file.
- ✅ **The eval harness** ([backend/src/verifier.eval.js](backend/src/verifier.eval.js))
  — 20 hand-written test cases against the verifier logic, currently
  **20/20 passing**.
- ✅ **The default checklist** ([backend/src/checklists.js](backend/src/checklists.js))
  for `task_type: "ac-service"`.
- ✅ **Database** — SQLite via `better-sqlite3` ([backend/src/db](backend/src/db)),
  schema for all six tables, auto-seeded `ac-service` checklist.
- ✅ **RESTful API** ([backend/src/routes](backend/src/routes)) — resource-based,
  versioned under `/api/v1`: `tasks` as the top-level resource with `claims`,
  `evidence`, and `verifications` as proper REST sub-resources (POST to a
  collection creates a new member, e.g. `POST /tasks/:id/verifications`
  creates a new verification result rather than mutating one in place), plus
  a first-class `checklists` resource. Supports filtering (`?status=`,
  `?task_type=`) and pagination (`?limit=`, `?offset=`) on the tasks list. See
  [API surface](#api-surface) below. Every step is logged to `agent_runs`.
- ✅ **Extraction layer** ([backend/src/extraction/extract.js](backend/src/extraction/extract.js))
  — Claude API when `ANTHROPIC_API_KEY` is set, heuristic/regex fallback
  otherwise. Verified live: an invalid key correctly degrades to the fallback
  path instead of crashing the pipeline.
- ✅ **Frontend — Home page** ([frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx))
  — landing page explaining the pitch, the 3-step flow, the three decisions,
  and the persona, plus a live stats strip pulled from the real API (not
  hardcoded numbers).
- ✅ **Frontend — Guide** ([frontend/src/pages/GuidePage.jsx](frontend/src/pages/GuidePage.jsx))
  — in-app walkthrough for technicians and supervisors, a plain-language
  explanation of every decision and field status, and the live `ac-service`
  checklist pulled straight from `GET /api/v1/checklists/ac-service` (so it
  can never drift out of sync with what the verifier actually enforces).
- ✅ **Frontend — Technician view** ([frontend/src/pages/TechnicianView.jsx](frontend/src/pages/TechnicianView.jsx))
  — mic input (Web Speech API) with textarea fallback, photo upload, live
  chat-style follow-up thread, final status card. Run end-to-end in-browser
  for all three decisions.
- ✅ **Frontend — Supervisor dashboard** ([frontend/src/pages/SupervisorDashboard.jsx](frontend/src/pages/SupervisorDashboard.jsx),
  [TaskDetail.jsx](frontend/src/pages/TaskDetail.jsx)) — task queue with status
  pills and evidence scores, per-task evidence trail, per-field breakdown, and
  a collapsible agent-run log (literally the `agent_runs` table — the thing to
  show a judge who points at a file).
- ⬜ Real STT polish, deploy, final failure-log writeup — see [Roadmap](#roadmap--build-order).

## Run it locally

You need [Node.js](https://nodejs.org) 18+ (tested on Node 25) and npm.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # optional: add your ANTHROPIC_API_KEY, else it runs on the heuristic fallback
npm run eval            # sanity check — should print 20/20 passed
npm run dev              # starts the API on http://localhost:3001
```

The SQLite file and any uploaded photos are created under `backend/data/`
(gitignored) on first run — no manual setup needed. `npm run seed` re-seeds
the checklist by hand if you edit [checklists.js](backend/src/checklists.js).

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev   # starts the UI on http://localhost:5173
```

Open **http://localhost:5173** for the landing page, **/guide** for the
walkthrough, **/technician** to run the demo scenario (start a job → speak or
type a claim → upload two evidence photos → Run Verification), or
**/supervisor** to see the task queue and drill into a task's full evidence
trail.

> Without `ANTHROPIC_API_KEY` set, voice claims are parsed by the heuristic
> regex fallback (still handles the demo phrase correctly) and photo uploads
> are presence-only (no OCR) — the whole loop still runs end-to-end and every
> decision path (VERIFIED / NEED_MORE_EVIDENCE / CONFLICT_HUMAN_REVIEW) works;
> you just won't get cross-checked values *from* the photos without a real key.

---

## Verifier logic, in brief

Checklist fields have a `type`: `'id' | 'number' | 'photo' | 'text'`, and
`number` fields carry a `{ min, max }` tolerance range. Every value available
for a field — from the voice claim *and* from any evidence item's extracted
data — is treated as a **source**; a field can have multiple sources.

- **`id` fields** — normalize (trim, lowercase, collapse whitespace) and
  compare across sources; any disagreement = `CONTRADICTION`.
- **`number` fields** — if sources disagree by more than **20% of the field's
  own tolerance-range width**, that's a `CONTRADICTION` (not a flat percentage
  of the value — a few degrees matters more on a 15-degree-wide spec than on a
  wide one). A single consistent value outside the range is `OUT_OF_RANGE`.
  Values within **8% of a tolerance edge** are flagged `borderline` — still
  `VERIFIED`, but it visibly nudges the evidence score down.
- **`photo` fields** — presence/absence of an evidence item tagged with that
  role.
- **Decision priority:** any `CONTRADICTION`/`OUT_OF_RANGE` →
  `CONFLICT_HUMAN_REVIEW`. Else any missing required field →
  `NEED_MORE_EVIDENCE` (asks about the *first* missing field, in checklist
  order). Else → `VERIFIED`.
- **`evidence_score`** — % of required fields matched, penalized 15 pts per
  contradiction, 20 pts per out-of-range, 5 pts per borderline field, clamped
  to 0–100.

Re-run the eval harness after every change to this logic:

```bash
cd backend && npm run eval
```

---

## API surface

REST, versioned under `/api/v1`. `tasks` is the top-level resource; `claims`,
`evidence`, and `verifications` are its sub-resource collections — POSTing to
one creates a new member of that collection rather than mutating a single
field, so nothing is a hidden RPC action. `/report` is the one deliberate
exception: a read-only aggregate view for the dashboard, documented as such
rather than pretending to be a resource.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/tasks` | Create a task |
| GET | `/api/v1/tasks?status=&task_type=&limit=&offset=` | List tasks (filterable, paginated) |
| GET | `/api/v1/tasks/:id` | Get one task |
| PATCH | `/api/v1/tasks/:id` | Update `unit_id` / `technician` |
| GET / POST | `/api/v1/tasks/:id/claims` | List / submit voice claims |
| GET / POST | `/api/v1/tasks/:id/evidence` | List / upload evidence photos |
| GET / POST | `/api/v1/tasks/:id/verifications` | List past runs / run the verifier fresh |
| GET | `/api/v1/tasks/:id/report` | Combined task + claim + evidence + verification + agent-run log |
| GET | `/api/v1/checklists` | List all checklists |
| GET | `/api/v1/checklists/:taskType` | Get one checklist (e.g. `ac-service`) |
| GET | `/health` | Liveness + which extraction mode is active (unversioned, standard convention) |

`/uploads/*` serves stored evidence photos as static files (also unversioned
— it's file serving, not a resource endpoint).

---

## Repo structure

```
Reality Check Voice Agent/
├── README.md
├── backend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── verifier.js          # core decision logic
│       ├── verifier.eval.js     # hand-written eval harness (run with `npm run eval`)
│       ├── checklists.js        # ac-service checklist + tolerance ranges
│       ├── server.js            # Express app entrypoint
│       ├── db/
│       │   ├── schema.js        # CREATE TABLE statements
│       │   ├── index.js         # opens/creates/seeds the SQLite DB
│       │   └── seed.js          # idempotent checklist seeder
│       ├── routes/
│       │   ├── helpers.js       # shared task lookup / serializers / agent-run logging
│       │   ├── tasks.js         # tasks resource + mounts the 3 sub-routers below
│       │   ├── claims.js        # /tasks/:id/claims
│       │   ├── evidence.js      # /tasks/:id/evidence
│       │   ├── verifications.js # /tasks/:id/verifications
│       │   └── checklists.js    # /checklists resource
│       └── extraction/
│           └── extract.js       # voice/photo -> structured fields (Claude or heuristic)
└── frontend/
    ├── package.json
    ├── .env.example
    └── src/
        ├── App.jsx               # routes + nav
        ├── api.js                # fetch wrapper (REST resource client)
        ├── styles.css
        ├── pages/
        │   ├── HomePage.jsx          # landing page + live stats
        │   ├── GuidePage.jsx         # in-app walkthrough + live checklist
        │   ├── TechnicianView.jsx
        │   ├── SupervisorDashboard.jsx
        │   └── TaskDetail.jsx
        └── components/
            ├── StatusPill.jsx
            └── FieldBreakdown.jsx
```

## Tech stack

- **Backend:** Node/Express (ESM), SQLite (`better-sqlite3`) for zero-config
  local dev — schema written to be portable to Postgres/Supabase later.
- **Extraction:** Claude API if `ANTHROPIC_API_KEY` is set; otherwise a small
  heuristic/regex fallback, isolated in one module so swapping in real
  STT/vision later is a one-file change.
- **Frontend:** React + Vite, plain CSS. Technician view (mic input via the
  browser's `SpeechRecognition` API with a text fallback, photo upload, a
  chat-style follow-up thread, a status card) and a Supervisor dashboard (task
  queue with status pills and evidence scores, per-task evidence trail).

## Roadmap / build order

1. ✅ Verifier + eval harness (done, 20/20)
2. ✅ DB schema + seed script for the ac-service checklist
3. ✅ API routes wired to the verifier and extraction layer
4. ✅ Frontend: Technician view + Supervisor dashboard, wired to the real API
5. ⬜ Deploy (one URL beats a localhost demo); real-device mic test on a phone
6. ⬜ Final honest failure-log pass before code freeze (below is the running draft)

## Cut for 24 hours / still to do

*(Running draft — will be finalized honestly at code freeze, per the
hackathon's required failure log.)*

Deliberately not built, per the build spec's scope discipline:
- Multi-language beyond Hindi-English code-mixing.
- Real auth — no login flow; the technician/supervisor split is just two
  routes, not two accounts.
- A job queue — verification runs synchronously; fine at hackathon scale, not
  at 10,000 users (see the pitch prep's "what breaks at scale" answer).
- Arbitrary procedure docs — only the one seeded `ac-service` checklist is
  supported; `checklists.js` would need a doc-parsing step to generalize.
- Durable offline caching — evidence upload/claim submission fail loudly with
  an error message on a dropped request; there's no local retry queue.

Known rough edges from live testing:
- Photo extraction only reads real values with a working `ANTHROPIC_API_KEY`;
  without one it's presence-only, so photo-vs-voice contradictions (e.g. the
  nameplate reading 28 when voice said 27) can't be demoed on the fallback
  path — needs a real key in the room.
- Web Speech API mic input hasn't been tested on a physical phone yet, only
  desktop Chrome — worth a real-device check before the demo.
- `npm audit` flags moderate issues in `esbuild` (Vite's dev server) and
  `react-router` (an SSR/redirect CVE) — both are dev-only / SSR-only concerns
  that don't apply to this client-side SPA on localhost; left unpatched to
  avoid a breaking-change upgrade mid-hackathon.

---

*Built for the Vocallabs Hackathon Drive, Multimodal Track.*
