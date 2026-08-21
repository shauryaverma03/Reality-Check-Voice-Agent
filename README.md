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
> and [Roadmap](#roadmap--build-order) below — don't assume the API or UI exist yet.

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
- ⬜ Database schema + seed script
- ⬜ API routes (`/tasks`, `/tasks/:id/claim`, `/tasks/:id/evidence`, `/tasks/:id/verify`, `/tasks/:id/report`)
- ⬜ Extraction layer (voice claim → structured fields, photo → structured fields)
- ⬜ Frontend — Technician view
- ⬜ Frontend — Supervisor dashboard

## Run it locally (what works today)

You need [Node.js](https://nodejs.org) 18+ (tested on Node 25). No API key, no
database, no install step needed yet — the verifier and its eval harness have
zero dependencies.

```bash
cd backend
npm run eval
```

You should see all 20 cases pass:

```
RealityCheck verifier eval — 20 cases

  PASS 01  all fields present, consistent, in range -> VERIFIED, score 100  [VERIFIED, score 100]
  ...
20/20 passed (100%)
```

Once the API and frontend exist, this section will grow to cover
`npm install`, environment variables (`ANTHROPIC_API_KEY`, optional), seeding
the SQLite DB, and running both servers.

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

## Repo structure

```
Reality Check Voice Agent/
├── README.md
├── backend/
│   ├── package.json
│   └── src/
│       ├── verifier.js          # core decision logic
│       ├── verifier.eval.js     # hand-written eval harness (run with `npm run eval`)
│       ├── checklists.js        # ac-service checklist + tolerance ranges
│       ├── db/                  # (schema + seed script — not yet built)
│       ├── routes/              # (API routes — not yet built)
│       └── extraction/          # (voice/photo -> structured fields — not yet built)
└── frontend/                    # (React + Vite — not yet built)
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

1. ✅ Verifier + eval harness (get this fully passing first — done, 20/20)
2. ⬜ DB schema + seed script for the ac-service checklist
3. ⬜ API routes wired to the verifier and extraction layer
4. ⬜ Frontend: Technician view, then Supervisor dashboard, wired to the real API
5. ⬜ Cut-for-24-hours / still-to-do failure log (below — filled in as we go)

## Cut for 24 hours / still to do

*(This section will be finalized honestly at the end, per the hackathon's
required failure log. Scope decisions already made per the build spec:)*

- Multi-language beyond Hindi-English code-mixing — not built if it slows
  things down.
- Real auth — hardcoded demo users, no login flow.
- No job queue — verification runs synchronously; fine at hackathon scale.
- Only one procedure doc / checklist (`ac-service`) is supported — not
  arbitrary procedure docs.
- Offline caching is basic try/catch, not a durable local queue.
- **Not yet built:** DB layer, API, extraction layer, both frontend views —
  see [Roadmap](#roadmap--build-order) above.

---

*Built for the Vocallabs Hackathon Drive, Multimodal Track.*
