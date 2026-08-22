import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import FieldBreakdown from '../components/FieldBreakdown.jsx';
import StepIndicator from '../components/StepIndicator.jsx';
import VerificationTrace from '../components/VerificationTrace.jsx';
import FollowUpCallout from '../components/FollowUpCallout.jsx';
import { citationLabel, citationEquipment } from '../citations.js';

const DECISION_ICON = {
  VERIFIED: '✓',
  NEED_MORE_EVIDENCE: '⚠',
  IMAGE_UNCLEAR: '🖼',
  INSUFFICIENT_IMAGE_EVIDENCE: '🖼',
  CONFLICT_HUMAN_REVIEW: '⚠',
  INSUFFICIENT_EVIDENCE: '?',
};

const SpeechRecognitionAPI =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// Human-readable label + icon + one-sentence, backend-accurate description
// per task_type. Falls back to the raw task_type string for anything not
// listed here, so a new service added purely as backend config still shows
// up (just less prettily) without a frontend change.
const SERVICE_INFO = {
  'ac-service': { icon: '❄️', label: 'AC Servicing', blurb: 'Checks gas pressure and outlet temperature against manufacturer reference specs.' },
  'ro-service': { icon: '💧', label: 'RO / Water Purifier', blurb: 'Checks output water quality (TDS) against EPA reference guidance.' },
  'fridge-service': { icon: '🧊', label: 'Refrigerator', blurb: 'Checks internal cabinet temperature against manufacturer reference guidance.' },
  'washer-service': { icon: '🌀', label: 'Washing Machine', blurb: 'Checks drainage, vibration, and error-code evidence.' },
};
const TASK_TYPE_LABELS = Object.fromEntries(Object.entries(SERVICE_INFO).map(([k, v]) => [k, v.label]));

// Defect/problem options shown per service in Step 1 of the job wizard.
// Frontend-only config (not round-tripped through the backend/checklist) —
// these are just what the technician is reporting as the reason for the
// visit, not a checklist field the verifier evaluates against evidence.
// Deliberately scoped per service so an AC defect never shows for an RO job.
const DEFECTS_BY_SERVICE = {
  'ac-service': ['Low cooling', 'Water leakage', 'Unusual noise', 'Not turning on', 'Gas leakage / low gas', 'Routine maintenance'],
  'ro-service': ['Low water flow', 'Bad taste / odor', 'Leakage', 'Filter change due', 'Not turning on', 'Routine maintenance'],
  'fridge-service': ['Not cooling', 'Excessive frost / ice buildup', 'Unusual noise', 'Water leakage', 'Door seal issue', 'Routine maintenance'],
  'washer-service': ['Not draining', 'Excessive vibration', 'Error code displayed', 'Not spinning', 'Water leakage', 'Routine maintenance'],
};

const DECISION_TO_STATUS = {
  VERIFIED: 'verified',
  NEED_MORE_EVIDENCE: 'need_more_evidence',
  IMAGE_UNCLEAR: 'image_unclear',
  INSUFFICIENT_IMAGE_EVIDENCE: 'insufficient_image_evidence',
  CONFLICT_HUMAN_REVIEW: 'conflict',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
};

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function TechnicianView() {
  const [searchParams] = useSearchParams();
  const [checklists, setChecklists] = useState([]);
  // Honors a ?service=ro-service style link (e.g. from the home page's
  // service cards) as the initial selection; falls back to AC otherwise.
  const [taskType, setTaskType] = useState(() => searchParams.get('service') || 'ac-service');
  const [defect, setDefect] = useState('');
  const [unitId, setUnitId] = useState('');
  const [machineModel, setMachineModel] = useState('');
  const [technician, setTechnician] = useState('');

  // Job-creation wizard, shown before a task exists. 0 = service+defect,
  // 1 = machine info, 2 = summary/confirm. Reset to 0 whenever taskType
  // changes so switching service mid-wizard doesn't carry over an
  // unrelated defect on the next step.
  const [wizardStep, setWizardStep] = useState(0);

  const [task, setTask] = useState(null);
  const [checklist, setChecklist] = useState(null); // the fields for `task`'s task_type
  const [creating, setCreating] = useState(false);

  const [claimText, setClaimText] = useState('');
  const [claimSubmitted, setClaimSubmitted] = useState(false);
  const [lastClaimRawText, setLastClaimRawText] = useState('');
  const [listening, setListening] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [submittingClaim, setSubmittingClaim] = useState(false);

  const [uploaded, setUploaded] = useState({});
  const [uploadingRole, setUploadingRole] = useState(null);

  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const threadEndRef = useRef(null);
  const evidenceSectionRef = useRef(null);
  const claimSectionRef = useRef(null);

  useEffect(() => {
    api
      .listChecklists()
      .then((rows) => {
        setChecklists(rows);
        if (rows.length > 0 && !rows.some((r) => r.task_type === taskType)) {
          setTaskType(rows[0].task_type);
        }
      })
      .catch(() => setChecklists([])); // selector just falls back to the AC default if this fails
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => clearInterval(recordingIntervalRef.current), []);

  function pushMessage(role, text) {
    setMessages((prev) => [...prev, { role, text, at: nowLabel() }]);
  }

  const evidenceFields = checklist ? checklist.filter((f) => f.type === 'photo' || f.type === 'document') : [];
  const requiredEvidenceFields = evidenceFields.filter((f) => f.required);
  const allRequiredEvidenceUploaded =
    requiredEvidenceFields.length > 0 && requiredEvidenceFields.every((f) => uploaded[f.key]);

  // Derived purely from real state — never a simulated/fake progress value.
  // Per-step, not a single cutoff: nothing stops a technician from running
  // verification before evidence is uploaded, so "done" must reflect what
  // actually happened at each step independently.
  const stepDone = [Boolean(task), claimSubmitted, allRequiredEvidenceUploaded, Boolean(verification), Boolean(verification)];
  const currentStepIndex = !task
    ? 0
    : !claimSubmitted
      ? 1
      : verification
        ? 4
        : allRequiredEvidenceUploaded
          ? 3
          : 2;

  const defectOptions = DEFECTS_BY_SERVICE[taskType] || [];

  async function handleCreateTask(e) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.createTask({
        task_type: taskType,
        unit_id: unitId,
        technician,
        defect,
        machine_model: machineModel,
      });
      setTask(created);
      setUploaded({});
      setClaimSubmitted(false);
      setVerification(null);
      const selected = checklists.find((c) => c.task_type === created.task_type);
      setChecklist(selected ? selected.fields : null);
      setMessages([]);
      pushMessage(
        'system',
        `New ${TASK_TYPE_LABELS[created.task_type] || created.task_type} job started for unit ${unitId || '(unspecified)'}${defect ? ` — ${defect}` : ''}. Speak or type your claim, then upload the required evidence.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function toggleListening() {
    if (!SpeechRecognitionAPI) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      }
      if (finalTranscript) {
        setClaimText((prev) => (prev ? `${prev} ${finalTranscript}` : finalTranscript).trim());
      }
    };
    recognition.onend = () => {
      setListening(false);
      clearInterval(recordingIntervalRef.current);
    };
    recognition.onerror = () => {
      setListening(false);
      clearInterval(recordingIntervalRef.current);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setRecordingSeconds(0);
    recordingIntervalRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
  }

  async function handleSubmitClaim(e) {
    e.preventDefault();
    if (!task || !claimText.trim()) return;
    setError(null);
    setSubmittingClaim(true);
    pushMessage('technician', claimText.trim());
    try {
      const claim = await api.submitClaim(task.id, claimText.trim());
      const fields = Object.entries(claim.extracted)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      pushMessage(
        'system',
        fields
          ? `Got it. Extracted: ${fields} (via ${claim.extraction_source}).`
          : `Heard you, but couldn't extract any structured fields from that — try including the machine ID and readings explicitly.`
      );
      setLastClaimRawText(claimText.trim());
      setClaimText('');
      setClaimSubmitted(true);
    } catch (err) {
      setError(err.message);
      pushMessage('system', `Couldn't record that claim: ${err.message}`);
    } finally {
      setSubmittingClaim(false);
    }
  }

  async function handleUploadEvidence(role, file) {
    if (!task || !file) return;
    setError(null);
    setUploadingRole(role);
    try {
      const evidence = await api.uploadEvidence(task.id, role, file);
      setUploaded((prev) => ({ ...prev, [role]: evidence }));
      const label = evidenceFields.find((f) => f.key === role)?.label || role;
      const extractedKeys = Object.keys(evidence.extracted || {});
      const unreadable = evidence.quality && evidence.quality.readable === false;
      pushMessage(
        'system',
        unreadable
          ? `Uploaded ${label}, but it looks unusable: ${(evidence.quality.issue || 'unclear').replace(/_/g, ' ')}. You may want to replace it before verifying.`
          : `Uploaded ${label} ✅${extractedKeys.length ? ` (read: ${extractedKeys.map((k) => `${k}=${evidence.extracted[k]}`).join(', ')})` : ''}`
      );
    } catch (err) {
      setError(err.message);
      pushMessage('system', `Upload failed for ${role}: ${err.message}`);
    } finally {
      setUploadingRole(null);
    }
  }

  function handleRemoveEvidence(role) {
    setUploaded((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });
  }

  async function handleVerify() {
    if (!task) return;
    setError(null);
    setVerifying(true);
    try {
      const result = await api.verify(task.id);
      setVerification(result);
      setTask((prev) => ({ ...prev, status: DECISION_TO_STATUS[result.decision] }));
      if (result.decision === 'VERIFIED') {
        pushMessage('system', `✅ VERIFIED — evidence score ${result.evidence_score}/100.`);
      } else if (result.decision === 'NEED_MORE_EVIDENCE') {
        pushMessage('system', `❓ ${result.follow_up_question}`);
      } else if (result.decision === 'IMAGE_UNCLEAR') {
        pushMessage('system', `🖼 IMAGE UNCLEAR — ${result.follow_up_question}`);
      } else if (result.decision === 'INSUFFICIENT_IMAGE_EVIDENCE') {
        pushMessage('system', `🖼 IMAGE NOT VERIFIED — ${result.follow_up_question}`);
      } else if (result.decision === 'INSUFFICIENT_EVIDENCE') {
        pushMessage('system', `📖 INSUFFICIENT EVIDENCE — ${result.follow_up_question}`);
      } else {
        const bad = result.fields.filter((f) => f.status === 'contradiction' || f.status === 'out_of_range');
        pushMessage('system', `🚩 CONFLICT — needs human review. ${bad.map((f) => f.message).join(' ')}`);
      }
    } catch (err) {
      // The backend enforces "a claim is required" itself (never just a
      // frontend gate) — if the button-disabled state below is ever
      // bypassed, this is the real backstop, and its message is already
      // technician-facing (see routes/verifications.js).
      setError(err.message);
      pushMessage('system', `Verification failed: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  }

  if (!task) {
    return (
      <div className="technician-start">
        <StepIndicator done={[false, false, false, false, false]} currentIndex={0} />
        <div className="card wizard-card">
          <h1>Start a job</h1>
          <div className="wizard-progress" aria-label="Job setup progress">
            {['Service & defect', 'Machine info', 'Summary'].map((label, i) => (
              <span key={label} className={`wizard-step-chip${i === wizardStep ? ' active' : i < wizardStep ? ' done' : ''}`}>
                {i < wizardStep ? '✓' : i + 1}. {label}
              </span>
            ))}
          </div>

          {wizardStep === 0 && (
            <div className="wizard-panel">
              <h2>What type of job are you going to perform?</h2>
              <div className="service-card-grid" data-tour="service-select" role="radiogroup" aria-label="Service type">
                {(checklists.length > 0 ? checklists.map((c) => c.task_type) : Object.keys(SERVICE_INFO)).map((t) => {
                  const info = SERVICE_INFO[t] || { icon: '🔧', label: t, blurb: '' };
                  return (
                    <button
                      type="button"
                      key={t}
                      role="radio"
                      aria-checked={taskType === t}
                      className={`service-card${taskType === t ? ' active' : ''}`}
                      onClick={() => {
                        setTaskType(t);
                        setDefect('');
                      }}
                    >
                      <span className="service-card-icon" aria-hidden="true">{info.icon}</span>
                      <span className="service-card-label">{info.label}</span>
                      <span className="service-card-blurb">{info.blurb}</span>
                    </button>
                  );
                })}
              </div>

              <h2>What is the defect / problem?</h2>
              <div className="defect-grid" role="radiogroup" aria-label="Defect">
                {defectOptions.map((d) => (
                  <button
                    type="button"
                    key={d}
                    role="radio"
                    aria-checked={defect === d}
                    className={`defect-chip${defect === d ? ' active' : ''}`}
                    onClick={() => setDefect(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="btn primary large"
                disabled={!taskType || !defect}
                onClick={() => setWizardStep(1)}
              >
                Continue
              </button>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="wizard-panel">
              <h2>Machine information</h2>
              <label>
                <span>Machine / unit ID <span className="required-badge">Required</span></span>
                <input value={unitId} onChange={(e) => setUnitId(e.target.value)} placeholder="e.g. 27" />
              </label>
              <label>
                <span>Machine name / model</span>
                <input value={machineModel} onChange={(e) => setMachineModel(e.target.value)} placeholder="e.g. Voltas Split AC 1.5T" />
              </label>
              <label>
                <span>Technician name <span className="required-badge">Required</span></span>
                <input value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder="e.g. Rakesh" />
              </label>
              <div className="wizard-nav">
                <button type="button" className="btn secondary" onClick={() => setWizardStep(0)}>
                  ← Back
                </button>
                <button
                  type="button"
                  className="btn primary large"
                  disabled={!unitId.trim() || !technician.trim()}
                  onClick={() => setWizardStep(2)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <form onSubmit={handleCreateTask} className="wizard-panel">
              <h2>Job summary</h2>
              <dl className="job-summary">
                <dt>Job type</dt>
                <dd>{SERVICE_INFO[taskType]?.icon} {TASK_TYPE_LABELS[taskType] || taskType}</dd>
                <dt>Defect</dt>
                <dd>{defect || '—'}</dd>
                <dt>Machine ID</dt>
                <dd>{unitId || '—'}</dd>
                <dt>Machine name / model</dt>
                <dd>{machineModel || '—'}</dd>
                <dt>Technician</dt>
                <dd>{technician || '—'}</dd>
              </dl>
              {error && <p className="error-text">{error}</p>}
              <div className="wizard-nav">
                <button type="button" className="btn secondary" onClick={() => setWizardStep(1)}>
                  ← Back
                </button>
                <button type="submit" className="btn primary large" disabled={creating}>
                  {creating ? 'Starting…' : 'Start Job'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="technician-in-progress">
      <StepIndicator done={stepDone} currentIndex={currentStepIndex} />
      <div className="technician-layout">
        <div className="card">
          <div className="task-header">
            <div>
              <h1>Job — Unit {task.unit_id || '—'}</h1>
              <p className="muted">
                {SERVICE_INFO[task.task_type]?.icon} {TASK_TYPE_LABELS[task.task_type] || task.task_type}
                {task.defect ? ` · ${task.defect}` : ''} · Technician: {task.technician || '—'} · Task ID: {task.id.slice(0, 8)}
              </p>
              {task.machine_model && <p className="muted small">Machine: {task.machine_model}</p>}
            </div>
            <StatusPill status={task.status} />
          </div>

          <section className="section" ref={claimSectionRef} data-tour="claim-section">
            <h2>1. State your claim <span className="required-badge">Required</span></h2>
            <p className="muted small">Tell RealityCheck what you did — task, machine ID, and any readings.</p>
            {!claimSubmitted && (
              <p className="follow-up">A claim is required before continuing to verification.</p>
            )}
            <form onSubmit={handleSubmitClaim} className="claim-form">
              <textarea
                value={claimText}
                onChange={(e) => setClaimText(e.target.value)}
                placeholder={'e.g. "Machine 27 maintenance complete. Pressure is 4.2 bar. Internal temperature is 8 degrees Celsius."'}
                rows={3}
                disabled={listening}
              />
              <div className="claim-actions">
                {SpeechRecognitionAPI ? (
                  <button
                    type="button"
                    className={`btn ${listening ? 'danger recording-btn' : 'secondary'}`}
                    onClick={toggleListening}
                  >
                    {listening ? `🔴 Recording… ${formatDuration(recordingSeconds)}` : '🎙 Record claim'}
                  </button>
                ) : (
                  <span className="muted small">Speech recognition not supported in this browser — type your claim.</span>
                )}
                <button type="submit" className="btn primary" disabled={submittingClaim || listening || !claimText.trim()}>
                  {submittingClaim ? 'Analyzing claim…' : 'Submit claim'}
                </button>
              </div>
              <p className="claim-helper muted small">Speak naturally. RealityCheck extracts relevant fields automatically.</p>
            </form>
          </section>

          <section className="section" ref={evidenceSectionRef} data-tour="evidence-section">
            <h2>2. Provide evidence</h2>
            <div className="photo-grid">
              {evidenceFields.map(({ key, label, type, required }) => {
                const item = uploaded[key];
                const unclear = item?.quality && item.quality.readable === false;
                return (
                  <div key={key} className={`evidence-card${item ? (unclear ? ' evidence-card-unclear' : ' evidence-card-done') : ''}`}>
                    <div className="evidence-card-top">
                      <span className="evidence-card-label">{label}</span>
                      <span className={`evidence-req-badge ${required ? 'required' : 'optional'}`}>
                        {required ? 'Required' : 'Optional'}
                      </span>
                    </div>
                    {item ? (
                      <div className="evidence-card-uploaded">
                        <span className={unclear ? 'upload-check upload-check-unclear' : 'upload-check'}>
                          {unclear ? `⚠ Unusable: ${(item.quality.issue || 'unclear').replace(/_/g, ' ')}` : '✓ Uploaded'}
                        </span>
                        <button type="button" className="btn tiny secondary" onClick={() => handleRemoveEvidence(key)}>
                          Replace
                        </button>
                      </div>
                    ) : (
                      <label className="evidence-upload-btn">
                        {uploadingRole === key ? 'Uploading…' : `Upload ${type === 'document' ? 'file' : 'photo'}`}
                        <input
                          type="file"
                          accept={type === 'document' ? 'application/pdf,image/*,.doc,.docx' : 'image/*'}
                          disabled={uploadingRole === key}
                          onChange={(e) => e.target.files[0] && handleUploadEvidence(key, e.target.files[0])}
                        />
                      </label>
                    )}
                    {!item && required && uploadingRole !== key && (
                      <span className="evidence-missing-note">⚠ Required evidence missing</span>
                    )}
                    {unclear && (
                      <span className="evidence-missing-note">Image is unclear or insufficient to verify — please re-upload a clearer photo.</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="section" data-tour="verify-section">
            <h2>3. Run verification</h2>
            <button
              className="btn primary large"
              onClick={handleVerify}
              disabled={verifying || !claimSubmitted}
              title={!claimSubmitted ? 'State Your Claim is required before continuing.' : undefined}
            >
              {verifying ? 'Verifying…' : 'Run Verification'}
            </button>
            {!claimSubmitted && <p className="muted small">Submit your claim above first — verification is blocked until then.</p>}
            {verification && (
              <div className={`status-card status-card-${verification.decision}`}>
                <div className="result-heading">
                  <span className={`result-icon result-icon-${verification.decision}`} aria-hidden="true">
                    {DECISION_ICON[verification.decision] || '•'}
                  </span>
                  <div>
                    <div className="result-label">{(DECISION_TO_STATUS[verification.decision] || '').replace(/_/g, ' ').toUpperCase()}</div>
                    <span className="score">Evidence score: {verification.evidence_score}/100</span>
                  </div>
                </div>

                {verification.decision === 'NEED_MORE_EVIDENCE' && verification.follow_up_question && (
                  <FollowUpCallout
                    question={verification.follow_up_question}
                    fields={verification.fields}
                    onProvideEvidence={() => evidenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    onUpdateClaim={() => {
                      claimSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  />
                )}
                {(verification.decision === 'IMAGE_UNCLEAR' || verification.decision === 'INSUFFICIENT_IMAGE_EVIDENCE') && verification.follow_up_question && (
                  <FollowUpCallout
                    question={verification.follow_up_question}
                    fields={verification.fields}
                    onProvideEvidence={() => evidenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    onUpdateClaim={() => {
                      claimSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  />
                )}
                {verification.decision !== 'NEED_MORE_EVIDENCE' && verification.decision !== 'IMAGE_UNCLEAR' && verification.decision !== 'INSUFFICIENT_IMAGE_EVIDENCE' && verification.follow_up_question && (
                  <p className="follow-up">
                    {verification.decision === 'INSUFFICIENT_EVIDENCE' ? 'Why: ' : 'Note: '}
                    {verification.follow_up_question}
                  </p>
                )}

                <FieldBreakdown fields={verification.fields} />
                {verification.citations && verification.citations.length > 0 && (
                  <div className="citations-block">
                    <h3>Sources used</h3>
                    <ul>
                      {verification.citations.map((c, i) => (
                        <li key={i} className={c.conflict ? 'citation-conflict' : undefined}>
                          {c.conflict && <span className="muted small">⚠️ Reference sources disagree — </span>}
                          📖 <strong>{citationLabel(c)}</strong>
                          {citationEquipment(c) && <span className="muted small"> · {citationEquipment(c)}</span>}
                          {typeof c.score === 'number' && <span className="muted small"> · match {Math.round(c.score * 100)}%</span>}
                          {c.url && (
                            <div>
                              <a href={c.url} target="_blank" rel="noreferrer" className="muted small">
                                {c.url}
                              </a>
                            </div>
                          )}
                          <div className="muted small">“{c.snippet}”</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <VerificationTrace
                  claimRawText={lastClaimRawText}
                  evidenceFields={evidenceFields}
                  uploaded={uploaded}
                  verification={verification}
                />
              </div>
            )}
          </section>
        </div>

        <div className="card thread-card">
          <h2>RealityCheck</h2>
          <div className="thread">
            {messages.map((m, i) => (
              <div key={i} className={`bubble bubble-${m.role}`}>
                <div className="bubble-text">{m.text}</div>
                <div className="bubble-time">{m.at}</div>
              </div>
            ))}
            <div ref={threadEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
