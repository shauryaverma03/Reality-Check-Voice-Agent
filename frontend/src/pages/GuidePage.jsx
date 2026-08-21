import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const FIELD_TYPE_LABEL = {
  id: 'ID — must match exactly (after trimming/case) across every source',
  number: 'Number — checked against a tolerance range, not an exact value',
  photo: 'Photo — just needs an evidence item uploaded for this role',
  text: 'Text — free text, compared like an ID field',
};

export default function GuidePage() {
  const [checklist, setChecklist] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getChecklist('ac-service')
      .then(setChecklist)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="card guide">
      <h1>Guide</h1>
      <p className="muted">
        Everything you need to run RealityCheck end to end — what to do as a technician, what to look for as a
        supervisor, and how the verification decision actually gets made.
      </p>

      <section className="section">
        <h2>For technicians</h2>
        <ol className="guide-steps">
          <li>
            <strong>Start a job.</strong> Enter the unit/machine ID and your name, then hit <em>Start Job</em>.
          </li>
          <li>
            <strong>Speak or type your claim.</strong> Say what you did, the machine ID, and your readings — e.g.{' '}
            <em>"Machine 27 ka maintenance complete kar diya, pressure 4.2 bar hai, temperature 82 degree hai."</em>{' '}
            Hindi-English mixing is fine. No mic support in your browser? Just type it in the box.
          </li>
          <li>
            <strong>Upload both evidence photos.</strong> A serial-number/nameplate photo, and a final-condition
            photo. Both are required — a job can't be verified without them.
          </li>
          <li>
            <strong>Run Verification.</strong> RealityCheck checks everything you've submitted against the
            checklist below. You'll get one of three outcomes (see <a href="#decisions">Understanding the decision</a>{' '}
            below).
          </li>
          <li>
            <strong>If asked a follow-up question,</strong> answer it directly — submit a corrected claim or upload
            the missing photo, then run verification again. You can do this as many times as you need.
          </li>
        </ol>
      </section>

      <section className="section">
        <h2>For supervisors</h2>
        <ol className="guide-steps">
          <li>
            <strong>Open the dashboard.</strong> Every job shows up with a status pill and its evidence score, newest
            first.
          </li>
          <li>
            <strong>Click into a job</strong> to see the full evidence trail: the raw voice claim and what was
            extracted from it, both photos and what was read off them, and a per-field verification breakdown.
          </li>
          <li>
            <strong>For CONFLICT_HUMAN_REVIEW jobs,</strong> the per-field table tells you exactly which field
            contradicted or fell out of range, and what the disagreeing sources said — that's what needs your
            judgment call, not a re-run.
          </li>
          <li>
            <strong>Show the agent-run log</strong> if you want to see the raw steps RealityCheck took — every
            extraction and the verifier's own input/output, in order. This is the same log a hackathon judge gets
            shown.
          </li>
        </ol>
      </section>

      <section className="section" id="decisions">
        <h2>Understanding the decision</h2>
        <div className="decision-grid">
          <div className="decision-card decision-verified">
            <span className="status-pill status-verified">VERIFIED</span>
            <p className="muted">Every required field is present and consistent, and every number is in range. Comes with an evidence score out of 100.</p>
          </div>
          <div className="decision-card decision-need_more_evidence">
            <span className="status-pill status-need_more_evidence">NEED MORE EVIDENCE</span>
            <p className="muted">Something required is missing. RealityCheck asks about the first missing field, in checklist order — fix that one thing and re-verify.</p>
          </div>
          <div className="decision-card decision-conflict">
            <span className="status-pill status-conflict">CONFLICT — HUMAN REVIEW</span>
            <p className="muted">A reading is outside spec, or two sources disagree by more than measurement noise. This always needs a human to look, not another automatic retry.</p>
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
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Today's checklist — <code>ac-service</code></h2>
        {error && <p className="error-text">Couldn't load the live checklist ({error}) — is the backend running?</p>}
        {!error && !checklist && <p className="muted">Loading…</p>}
        {checklist && (
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
                {checklist.fields.map((f) => (
                  <tr key={f.key}>
                    <td className="field-key">{f.key}</td>
                    <td>{FIELD_TYPE_LABEL[f.type] || f.type}</td>
                    <td>{f.required ? 'Yes' : 'No'}</td>
                    <td>{f.tolerance ? `${f.tolerance.min}–${f.tolerance.max} ${f.unit || ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Pulled live from <code>GET /api/v1/checklists/ac-service</code> — if this ever looks stale, the backend
          isn't running or hasn't seeded yet.
        </p>
      </section>

      <section className="section">
        <h2>FAQ</h2>
        <dl className="faq">
          <dt>Do I need an API key to try this?</dt>
          <dd>
            No. Without <code>ANTHROPIC_API_KEY</code> set, voice claims are parsed by a heuristic regex fallback and
            photos are presence-only (no OCR) — the full loop, including all three decisions, still works.
          </dd>
          <dt>Why does it ask for two photos instead of one?</dt>
          <dd>
            The nameplate photo cross-checks the machine ID; the final-condition photo is evidence the job site was
            actually left in a finished state. Either one missing blocks VERIFIED.
          </dd>
          <dt>What if I made a mistake in my claim?</dt>
          <dd>Just submit a new claim with the correct reading and run verification again — RealityCheck always uses your most recent claim.</dd>
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
