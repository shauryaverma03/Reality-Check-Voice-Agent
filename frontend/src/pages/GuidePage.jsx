import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { TourContext } from '../App.jsx';

const FIELD_TYPE_LABEL = {
  id: 'ID — must match exactly (after trimming/case) across every source',
  number: 'Number — checked against a tolerance range, not an exact value',
  photo: 'Photo — needs an evidence item uploaded for this role',
  document: 'Document — needs a file uploaded for this role (job card, invoice, etc.)',
  text: 'Text — free text, compared like an ID field',
};

const SERVICE_LABELS = {
  'ac-service': 'AC Servicing',
  'ro-service': 'RO / Water Purifier Servicing',
  'fridge-service': 'Refrigerator Servicing',
  'washer-service': 'Washing Machine Servicing',
};
const SERVICE_ORDER = ['ac-service', 'ro-service', 'fridge-service', 'washer-service'];

export default function GuidePage() {
  const [checklists, setChecklists] = useState([]);
  const [activeService, setActiveService] = useState('ac-service');
  const [error, setError] = useState(null);
  const { startTour } = useContext(TourContext);

  useEffect(() => {
    api
      .listChecklists()
      .then((rows) => {
        setChecklists(rows);
        if (rows.length > 0 && !rows.some((r) => r.task_type === activeService)) {
          setActiveService(rows[0].task_type);
        }
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeChecklist = checklists.find((c) => c.task_type === activeService);

  return (
    <div className="card guide">
      <div className="task-header">
        <h1>Guide</h1>
        <button type="button" className="btn secondary" onClick={startTour}>
          ▶ Replay the tour
        </button>
      </div>
      <p className="muted">
        Everything you need to run RealityCheck end to end — what RealityCheck actually is, what to do as a
        technician, what to look for as a supervisor, and how a verification decision actually gets made.
      </p>

      <section className="section">
        <h2>What is RealityCheck</h2>
        <p className="muted">
          A job-verification layer for field service work. A technician states what they did — by voice or text —
          and uploads evidence photos (and, for some services, documents). RealityCheck extracts structured fields
          from both, cross-checks them against each other and against the service's checklist, and where a field
          needs it, against retrieved reference knowledge (manufacturer manuals, spec sheets, standards documents).
          It never takes a technician's word alone, and it never invents a number or a source it didn't actually
          retrieve — a decision is either backed by real, checkable evidence, or RealityCheck says so and asks for
          more.
        </p>
      </section>

      <section className="section">
        <h2>Services supported today</h2>
        <div className="table-scroll">
          <table className="field-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>What's checked</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>AC Servicing</td>
                <td>Gas pressure and outlet temperature, plus serial and final-condition photos.</td>
              </tr>
              <tr>
                <td>RO / Water Purifier</td>
                <td>Output water quality (TDS), checked against EPA reference guidance where retrieved.</td>
              </tr>
              <tr>
                <td>Refrigerator</td>
                <td>Internal cabinet temperature, checked against manufacturer reference guidance where retrieved.</td>
              </tr>
              <tr>
                <td>Washing Machine</td>
                <td>Drainage and vibration checks, plus a serial photo and an error-code photo.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>For technicians</h2>
        <ol className="guide-steps">
          <li>
            <strong>Start a job.</strong> Pick the service type, enter the unit/machine ID and your name, then hit{' '}
            <em>Start Job</em>.
          </li>
          <li>
            <strong>Speak or type your claim.</strong> Say what you did, the machine ID, and your readings — e.g.{' '}
            <em>"Machine 27 ka maintenance complete kar diya, pressure 4.2 bar hai, temperature 82 degree hai."</em>{' '}
            Hindi-English mixing is fine. No mic support in your browser? Just type it in the box.
          </li>
          <li>
            <strong>Upload the required evidence</strong> — see below for what counts. Every required item must be
            provided before a job can be VERIFIED.
          </li>
          <li>
            <strong>Run Verification.</strong> RealityCheck checks everything you've submitted against the service's
            checklist. You'll get one of five outcomes (see <a href="#decisions">Understanding the decision</a>{' '}
            below).
          </li>
          <li>
            <strong>If asked a follow-up question,</strong> answer it directly — submit a corrected claim or upload
            the missing evidence, then run verification again. You can do this as many times as you need.
          </li>
        </ol>
      </section>

      <section className="section">
        <h2>What counts as evidence</h2>
        <p className="muted">
          Two kinds of evidence, and RealityCheck keeps them strictly separate:
        </p>
        <ul className="guide-steps">
          <li>
            <strong>Photo / document evidence</strong> — what the technician uploads for a specific job: a serial
            plate photo, a reading on a gauge, a completed job card. Attached to that one task only.
          </li>
          <li>
            <strong>Reference knowledge</strong> — manufacturer manuals, spec sheets, and standards documents a
            supervisor has indexed ahead of time (see the <Link to="/supervisor/knowledge">Knowledge base</Link>).
            It's never technician evidence and never attached to a task — it's retrieved at verification time to
            check whether a technician's reading is actually within spec.
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>How reference-knowledge retrieval works</h2>
        <p className="muted">
          For a checklist field that needs a reference (today: RO's TDS reading and the refrigerator's internal
          temperature), RealityCheck builds a search query out of the service type, the field name, the value the
          technician reported, and the claim text — then searches only that service's indexed documents using
          TF-IDF term matching (no embeddings API, no external vector database). If a passage scores above the match
          threshold, it's returned as a citation — the document title, the matching passage, and a link to the
          source where one exists. If nothing scores high enough, the field is marked{' '}
          <span className="status-pill status-insufficient_evidence">INSUFFICIENT EVIDENCE</span> rather than
          silently passing — RealityCheck will never claim to have checked something it couldn't actually find
          reference material for.
        </p>
      </section>

      <section className="section">
        <h2>How image evidence is actually checked</h2>
        <p className="muted">
          An uploaded photo is never assumed valid just because a file exists. Two separate checks run on it:
        </p>
        <ul className="guide-steps">
          <li>
            <strong>Is it usable?</strong> When AI is available, the vision model judges readability directly
            (blurry, dark, overexposed, too low-resolution, or not actually showing the equipment/reading). Without
            AI, a deterministic fallback checks the file's actual pixel dimensions and size — real structural
            signals, not a guess — and flags anything implausibly small. Either way, an unusable photo gets marked{' '}
            <span className="status-pill status-image_unclear">IMAGE UNCLEAR</span> instead of silently counting as
            valid evidence.
          </li>
          <li>
            <strong>Does it match the claim?</strong> Where AI reads a number or ID off a photo (a gauge, a
            nameplate), that value is compared against the technician's stated claim using the same cross-source
            check every other field already goes through — if they disagree beyond measurement noise, it's a
            contradiction, escalated as CONFLICT — HUMAN REVIEW with the claimed and observed values shown side by
            side, not silently averaged or ignored.
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>For supervisors</h2>
        <ol className="guide-steps">
          <li>
            <strong>Open the dashboard.</strong> Summary cards show total jobs and how many fall into each decision;
            the table below lists every job with its status and evidence score, newest first.
          </li>
          <li>
            <strong>Click into a job</strong> to see the full evidence trail: the raw voice claim and what was
            extracted from it, every evidence item and what was read off it, any reference citations retrieved, and
            a per-field verification breakdown.
          </li>
          <li>
            <strong>For CONFLICT_HUMAN_REVIEW jobs,</strong> the per-field table tells you exactly which field
            contradicted or fell out of range, and what the disagreeing sources said — that's what needs your
            judgment call, not a re-run.
          </li>
          <li>
            <strong>Maintain the knowledge base</strong> from the Knowledge base page — upload manufacturer manuals
            or spec sheets per service so RealityCheck has something real to check technician readings against.
          </li>
          <li>
            <strong>Show the agent-run log</strong> on a job's detail page if you want to see the raw steps
            RealityCheck took — every extraction, retrieval, and the verifier's own input/output, in order.
          </li>
        </ol>
      </section>

      <section className="section" id="decisions">
        <h2>Understanding the decision</h2>
        <div className="decision-grid">
          <div className="decision-card decision-verified">
            <span className="status-pill status-verified">VERIFIED</span>
            <p className="muted">Every required field is present and consistent, every number is in range, and any needed reference check succeeded. Comes with an evidence score out of 100.</p>
          </div>
          <div className="decision-card decision-need_more_evidence">
            <span className="status-pill status-need_more_evidence">NEED MORE EVIDENCE</span>
            <p className="muted">Something required is missing. RealityCheck asks about the first missing field, in checklist order — fix that one thing and re-verify.</p>
          </div>
          <div className="decision-card decision-image_unclear">
            <span className="status-pill status-image_unclear">IMAGE UNCLEAR</span>
            <p className="muted">A required photo was uploaded, but it's too blurry, dark, low-resolution, or off-subject to actually verify anything against. Different from missing — something was submitted, it just can't be trusted yet. Re-upload a clearer photo and re-verify.</p>
          </div>
          <div className="decision-card decision-conflict">
            <span className="status-pill status-conflict">CONFLICT — HUMAN REVIEW</span>
            <p className="muted">A reading is outside spec, or the claim and the evidence disagree by more than measurement noise (e.g. the technician says 120 PSI but the photo shows 180 PSI). This always needs a human to look, not another automatic retry.</p>
          </div>
          <div className="decision-card decision-insufficient_evidence">
            <span className="status-pill status-insufficient_evidence">INSUFFICIENT EVIDENCE</span>
            <p className="muted">A field needed a reference-knowledge check, but nothing relevant was found in the indexed documents for that service. Add a document that covers it and re-verify.</p>
          </div>
        </div>

        <h3>What a field's status means</h3>
        <div className="table-scroll">
          <table className="field-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="field-status field-status-ok">OK</span></td>
                <td>All sources agree, and any number is comfortably within its tolerance range.</td>
              </tr>
              <tr>
                <td><span className="field-status field-status-borderline">Borderline</span></td>
                <td>In range, but close to the edge (within ~8% of the range width) — still VERIFIED, but it nudges the evidence score down a little as a visible caution flag.</td>
              </tr>
              <tr>
                <td><span className="field-status field-status-missing">Missing</span></td>
                <td>No source reported this required field at all.</td>
              </tr>
              <tr>
                <td><span className="field-status field-status-contradiction">Contradiction</span></td>
                <td>Two sources disagree — for IDs, any difference; for numbers, a gap bigger than ~20% of the tolerance range's width (so a strict spec is judged more strictly than a loose one).</td>
              </tr>
              <tr>
                <td><span className="field-status field-status-out_of_range">Out of range</span></td>
                <td>Sources agree with each other, but the agreed value itself is outside the required tolerance range.</td>
              </tr>
              <tr>
                <td><span className="field-status field-status-insufficient_evidence">Insufficient evidence</span></td>
                <td>The value itself looks fine, but no indexed reference document backs it up — see above.</td>
              </tr>
              <tr>
                <td><span className="field-status field-status-unclear">Image unclear</span></td>
                <td>A photo was uploaded for this field, but it's flagged as unusable (blurry, dark, low-resolution, or off-subject) — evidence exists, but it isn't trustworthy.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Checklists, by service</h2>
        {error && <p className="error-text">Couldn't load live checklists ({error}) — is the backend running?</p>}
        {!error && checklists.length === 0 && <p className="muted">Loading…</p>}
        {checklists.length > 0 && (
          <>
            <div className="claim-actions">
              {SERVICE_ORDER.filter((t) => checklists.some((c) => c.task_type === t)).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn tiny ${activeService === t ? 'primary' : 'secondary'}`}
                  onClick={() => setActiveService(t)}
                >
                  {SERVICE_LABELS[t] || t}
                </button>
              ))}
            </div>
            {activeChecklist && (
              <div className="table-scroll">
                <table className="field-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Tolerance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeChecklist.fields.map((f) => (
                      <tr key={f.key}>
                        <td className="field-key">{f.key}</td>
                        <td>
                          {FIELD_TYPE_LABEL[f.type] || f.type}
                          {f.needsReference && <span className="citation-chip"> needs reference</span>}
                        </td>
                        <td>{f.required ? 'Yes' : 'No'}</td>
                        <td>{f.tolerance ? `${f.tolerance.min}–${f.tolerance.max} ${f.unit || ''}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <p className="muted small">
          Pulled live from <code>GET /api/v1/checklists</code> — if this ever looks stale, the backend isn't running
          or hasn't seeded yet.
        </p>
      </section>

      <section className="section">
        <h2>FAQ</h2>
        <dl className="faq">
          <dt>Do I need an API key to try this?</dt>
          <dd>
            No. Without <code>ANTHROPIC_API_KEY</code> set, voice claims are parsed by a heuristic regex fallback and
            photos are presence-only (no OCR) — the full loop, including all four decisions, still works.
          </dd>
          <dt>Why does RealityCheck ask for multiple photos?</dt>
          <dd>
            Each required photo checks something different — e.g. a nameplate photo cross-checks the machine ID,
            while a final-condition or error-code photo is evidence the job site was actually left in the state
            claimed. Any missing required item blocks VERIFIED.
          </dd>
          <dt>What if I made a mistake in my claim?</dt>
          <dd>Just submit a new claim with the correct reading and run verification again — RealityCheck always uses your most recent claim.</dd>
          <dt>What happens if the knowledge base has nothing on a reading?</dt>
          <dd>
            The field comes back INSUFFICIENT EVIDENCE rather than a false VERIFIED — a supervisor needs to index a
            document that actually covers it before that field can pass.
          </dd>
        </dl>
      </section>

      <div className="guide-footer">
        <Link className="btn primary" to="/technician">
          Try it as a Technician →
        </Link>
        <Link className="btn secondary" to="/supervisor">
          Open Supervisor Dashboard →
        </Link>
      </div>
    </div>
  );
}
